import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { cleanArticleText } from '@/lib/article-extraction'

const SUGGEST_SYSTEM = `당신은 해외 팝, 케이팝, EDM, 힙합, 배우 등 글로벌 아티스트와 유명인들의 라이프, 가십, 신보 소식을 다루는 에디터입니다. 다국어로 된 뉴스 원문을 한 편 또는 여러 편 받아 한국어 기사로 작성할 만한 소재인지 판단합니다.

핵심 원칙:
- 아래 주제와 연결고리가 있으면 적극 승인하세요:
  * 아티스트/유명인의 신보, 공연, 캐스팅 소식
  * 인터뷰, 비하인드 스토리, 가십, 열애설
  * 패션, 뷰티, 라이프스타일
  * 음악/엔터테인먼트 업계 주요 동향
- 완전히 무관한 분야(순수 정치, 경제, 스포츠 경기 등)에만 거절하세요.
- 거절 시 반드시 이유를 reason 필드에 넣으세요.
- 모든 소스를 동등하게 취급하세요. 특정 매체의 등급이나 권위를 기준으로 거르지 마세요.
- 연도 단독(2025, 2026 등), 매체명, 사이트명, 인터뷰 형식 표현(catches up with 등)은 절대 승인 기준으로 사용하지 마세요.
- 여러 기사를 "음악산업의 변화", "최근 엔터테인먼트 동향"처럼 너무 넓은 테마로 요약한 추상 토픽은 절대 만들지 마세요.
- topic에는 가능한 한 구체적 고유명사(인물명, 작품명, 행사명 등)를 포함하세요.
- 좋은 예: "Taylor Swift의 'Eras Tour' 아시아 일정 추가", "Timothee Chalamet 새 영화 캐스팅 비하인드", "Kylie Jenner의 새로운 브랜드 론칭"
- 나쁜 예: "팝 음악계의 변화", "유명인들의 일상", "할리우드 배우들의 근황"

응답 작성 시:
- topic은 한국어로, 구체적이고 명확하게 작성하세요.
- keywords는 3~6개의 영문/국문 키워드로, 카테고 단어 단독 사용 금지.
- 응답 JSON 스키마는 별도로 강제되므로 그 형식을 그대로 따르세요.`

type Suggestion = {
  topic: string
  keywords: string[]
  articleIds: string[]
  reason?: string
  commonEntities?: string[]
  cohesionScore?: number
}

type SuggestionWithArticles = Suggestion & {
  articles: { id: string; title: string; url: string }[]
  matchedEntities?: string[]
}

type RawArticle = {
  id: string
  title: string
  content: string | null
  url: string
  source_id: string | number | null
  sourceName?: string
  published_at?: string | null
}

type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'published'

const ALLOWED_STATUSES: SuggestionStatus[] = ['pending', 'approved', 'rejected', 'published']
const MIN_COHESION_SCORE = 20
const DEFAULT_ANALYSIS_LIMIT = 200
const MAX_ANALYSIS_LIMIT = 200
const STAGE2_DEFAULT_COHESION = 50
const LLM_INPUT_MAX = 120
const LLM_BATCH_SIZE = 20

const SUGGEST_RESPONSE_FORMAT = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          keywords: {
            type: 'array',
            items: { type: 'string' },
          },
          articleIds: {
            type: 'array',
            items: { type: 'string' },
          },
          reason: { type: 'string' },
          commonEntities: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['topic', 'keywords', 'articleIds', 'reason', 'commonEntities'],
      },
    },
  },
  required: ['suggestions'],
}

type DbSuggestedCluster = {
  id: string
  topic: string
  keywords: string[] | null
  article_ids: string[] | null
  status: SuggestionStatus
  cluster_id: string | null
  created_at: string
}

type PersistedSuggestion = SuggestionWithArticles & {
  id: string
  status: SuggestionStatus
  clusterId: string | null
  articleId: string | null
  createdAt: string
}

const CATEGORY_KEYWORDS = new Set([
  'album', 'albums', 'club', 'clubs', 'dj', 'edm', 'festival', 'festivals',
  'house', 'intros', 'lineup', 'line-ups', 'music', 'new', 'new music',
  'premiere', 'preview', 'record', 'records', 'release', 'released', 'releases',
  'single', 'synth', 'synths', 'techno', 'track', 'tracks',
])

const STOPWORDS = new Set([
  'about', 'after', 'album', 'albums', 'also', 'and', 'are', 'artist', 'artists',
  'back', 'best', 'can', 'club', 'dance', 'deep', 'dj', 'edm', 'from', 'has', 'have',
  'home', 'house', 'into', 'label', 'live', 'magazine', 'menu', 'mix', 'music',
  'new', 'news', 'out', 'premiere', 'preview', 'records', 'release', 'released',
  'releases', 'review', 'show', 'site', 'single', 'so', 'techno', 'tech', 'the',
  'this', 'track', 'tracks', 'with', 'year', 'far', 'just', 'page', 'privacy',
  'policy', 'cookie', 'cookies', 'http', 'https', 'www', 'com', 'net', 'org',
])

const SOURCE_OR_SERIES_PATTERNS = [
  /\b909originals\b/i,
  /^ia mix(?:\s+\d+)?$/i,
  /^myrecordbag$/i,
  /\b(bandcamp daily|beatportal|attack magazine|inverted audio)\b/i,
  /\b(mixmag|dj mag|the quietus|crack magazine|ransom note|5 magazine)\b/i,
  /\b(create digital music|cdm|groove magazine|fazemag|tsugi)\b/i,
]

const LOW_SIGNAL_CLUSTER_PATTERNS = [
  /^(?:19|20)\d{2}$/i,
  /^(?:19|20)\d{2}\s+(?:related|news|review|in review)$/i,
  /\b(?:catches up with|chats to|talks to|interview with|in conversation with)\b/i,
  /\b(?:best electronic music|best albums|best tracks|top-selling tracks|top selling tracks|chart toppers)\b/i,
  /\bfestival line-ups you might\b/i,
  /음악\s*산업(?:의)?\s*(?:변화|도전|동향)/i,
  /음악\s*페스티벌(?:과|와)\s*라이브\s*공연/i,
  /전자\s*음악\s*씬\s*(?:동향|변화|흐름)/i,
  /클럽\s*문화(?:의)?\s*(?:변화|동향|흐름)/i,
]

async function attachSourceMeta(articles: RawArticle[]): Promise<RawArticle[]> {
  const sourceIds = Array.from(new Set(
    articles
      .map((article) => article.source_id)
      .filter((id): id is string | number => id !== null)
  ))

  if (sourceIds.length === 0) {
    return articles
  }

  const sourceMeta = new Map<string, { name: string }>()
  const { data } = await supabase
    .from('rss_sources')
    .select('id, name')
    .in('id', sourceIds)

  for (const source of (data ?? []) as { id: string | number; name: string | null }[]) {
    const name = source.name ?? '알 수 없는 소스'
    sourceMeta.set(String(source.id), { name })
  }

  return articles.map((article) => {
    const meta = article.source_id !== null ? sourceMeta.get(String(article.source_id)) : undefined
    return {
      ...article,
      sourceName: meta?.name,
    }
  })
}

function articleSnippet(article: RawArticle): string {
  return cleanArticleText(article.content ?? '', 500)
    .replace(/\s+/g, ' ')
    .trim()
}

function parseSuggestions(responseText: string): { suggestions?: Suggestion[] } {
  try {
    return JSON.parse(responseText)
  } catch {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('LLM 응답 JSON 파싱 실패')
    }
    return JSON.parse(jsonMatch[0])
  }
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeEntity(entity: string): string {
  return entity
    .replace(/^[-–—:|]\s*/i, '')
    .replace(/^(at|for|of|the|with)\s+/i, '')
    .replace(/\s+[-–—|]\s*(909originals|bandcamp daily|beatportal|attack magazine|inverted audio|mixmag|dj mag|cdm|create digital music)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isCategoryKeyword(keyword: string): boolean {
  return CATEGORY_KEYWORDS.has(normalizeText(keyword))
}

function isUrlOrDomainText(text: string): boolean {
  const lower = text.toLowerCase()
  const normalized = normalizeText(text)
  return /\bhttps?:\/\//.test(lower)
    || /\bwww\./.test(lower)
    || /\b[a-z0-9-]+\.(com|net|org|co|uk|de|fr|io|fm)\b/.test(lower)
    || /\b(https|http|www)\b/.test(normalized)
    || /\b(com|net|org|co|uk|de|fr|io|fm)\b/.test(normalized)
}

function isSourceOrSeriesEntity(text: string): boolean {
  const normalized = normalizeEntity(text)
  return SOURCE_OR_SERIES_PATTERNS.some((pattern) => pattern.test(normalized))
}

function isLowSignalClusterText(text: string): boolean {
  const normalized = normalizeText(text)
  return LOW_SIGNAL_CLUSTER_PATTERNS.some((pattern) => pattern.test(normalized))
}

function isSpecificEntity(entity: string): boolean {
  const normalized = normalizeText(entity)
  if (
    !normalized
    || isCategoryKeyword(normalized)
    || isUrlOrDomainText(entity)
    || isSourceOrSeriesEntity(entity)
    || isLowSignalClusterText(entity)
  ) {
    return false
  }
  if (/\b(of the year|the year|so far|year \d{4})\b/.test(normalized) || /[&-]$/.test(entity.trim())) {
    return false
  }

  const tokens = normalized.split(' ').filter(Boolean)
  if (tokens.length >= 2) {
    return tokens.some((token) => !STOPWORDS.has(token) && !CATEGORY_KEYWORDS.has(token) && !/^\d+$/.test(token))
  }

  const originalTokens = entity.split(/\s+/).filter(Boolean)
  const hasUppercaseSignal = originalTokens.some((token) => /[A-Z]/.test(token[0]) || /^[A-Z0-9]{2,}$/.test(token))
  return hasUppercaseSignal && normalized.length >= 4 && !STOPWORDS.has(normalized)
}

function calculateCohesionScore(articleIds: string[], commonEntities: string[], rawArticles: RawArticle[]): number {
  if (articleIds.length < 2 || commonEntities.length === 0) {
    return 0
  }

  const articleById = new Map(rawArticles.map((article) => [article.id, article]))
  const entityHits = commonEntities.reduce((total, entity) => {
    const normalizedEntity = normalizeText(entity)
    const hits = articleIds.filter((id) => {
      const article = articleById.get(id)
      if (!article) return false
      const searchableText = normalizeText(`${article.title} ${articleSnippet(article)}`)
      return searchableText.includes(normalizedEntity)
    }).length
    return total + hits / articleIds.length
  }, 0)
  const averageEntityCoverage = entityHits / commonEntities.length
  const sizeBonus = Math.min(articleIds.length, 5) * 4
  const categoryPenalty = commonEntities.every((entity) => isCategoryKeyword(entity)) ? 45 : 0

  return Math.max(0, Math.min(100, Math.round(averageEntityCoverage * 80 + sizeBonus - categoryPenalty)))
}

function normalizeSuggestion(
  suggestion: Partial<Suggestion>,
  validIds: Set<string>,
  articleMeta: Map<string, { id: string; title: string; url: string }>,
  rawArticles: RawArticle[],
  articleMatchMap: Map<string, string[]>
): SuggestionWithArticles | null {
  const articleIds = Array.from(new Set(
    (Array.isArray(suggestion.articleIds) ? suggestion.articleIds : [])
      .map((id) => String(id).trim())
      .filter((id) => validIds.has(id))
  ))
  const keywords = Array.from(new Set(
    (Array.isArray(suggestion.keywords) ? suggestion.keywords : [])
      .map((keyword) => String(keyword).trim())
      .filter((keyword) => keyword.length > 0)
      .filter((keyword) => !isCategoryKeyword(keyword))
      .filter((keyword) => !isUrlOrDomainText(keyword))
      .filter((keyword) => !isSourceOrSeriesEntity(keyword))
      .filter((keyword) => !isLowSignalClusterText(keyword))
      .slice(0, 6)
  ))
  const commonEntities = Array.from(new Set(
    (Array.isArray(suggestion.commonEntities) ? suggestion.commonEntities : [])
      .map((entity) => normalizeEntity(String(entity)))
      .filter(isSpecificEntity)
      .slice(0, 5)
  ))
  const topic = String(suggestion.topic ?? '').trim()
  const reason = String(suggestion.reason ?? '').trim()
  const cohesionScore = typeof suggestion.cohesionScore === 'number'
    ? Math.round(suggestion.cohesionScore)
    : Math.max(
      STAGE2_DEFAULT_COHESION,
      calculateCohesionScore(articleIds, commonEntities.length > 0 ? commonEntities : keywords, rawArticles)
    )

  if (
    !topic
    || isUrlOrDomainText(topic)
    || isSourceOrSeriesEntity(topic)
    || isLowSignalClusterText(topic)
    || articleIds.length < 1
    || cohesionScore < MIN_COHESION_SCORE
  ) {
    return null
  }

  if (keywords.length === 0 && commonEntities.length === 0) {
    return null
  }

  const matchedEntities = Array.from(new Set(
    articleIds.flatMap(id => articleMatchMap.get(id) || [])
  ))

  return {
    topic,
    keywords,
    articleIds,
    reason,
    commonEntities,
    cohesionScore,
    articles: articleIds.map((id) => articleMeta.get(id)!).filter(Boolean),
    matchedEntities,
  }
}

async function hydrateSuggestions(rows: DbSuggestedCluster[]): Promise<PersistedSuggestion[]> {
  if (rows.length === 0) return []

  const allIds = Array.from(new Set(rows.flatMap((row) => row.article_ids ?? [])))
  const articleMeta = new Map<string, { id: string; title: string; url: string; content: string | null }>()

  if (allIds.length > 0) {
    const { data: rawArticles } = await supabase
      .from('raw_articles')
      .select('id, title, url, content')
      .in('id', allIds)

    for (const article of (rawArticles ?? []) as { id: string; title: string; url: string; content: string | null }[]) {
      articleMeta.set(article.id, { id: article.id, title: article.title, url: article.url, content: article.content })
    }
  }

  const entities = loadTargetEntities()

  return rows.map((row) => {
    const articleIds = row.article_ids ?? []
    const commonEntities = row.keywords?.filter((keyword) => !isCategoryKeyword(keyword)) ?? []

    const matchedEntities = Array.from(new Set(
      articleIds.flatMap(id => {
        const meta = articleMeta.get(id)
        if (!meta) return []
        return getMatchedEntities(meta, entities)
      })
    ))

    return {
      id: row.id,
      topic: row.topic,
      keywords: row.keywords ?? [],
      articleIds,
      reason: commonEntities[0]
        ? `"${commonEntities[0]}"를 기준으로 저장된 제안입니다.`
        : undefined,
      commonEntities: commonEntities.length > 0 ? commonEntities : undefined,
      cohesionScore: commonEntities.length > 0
        ? calculateCohesionScore(articleIds, commonEntities, articleIds.map((id) => {
          const meta = articleMeta.get(id)
          return {
            id,
            title: meta?.title ?? '',
            content: meta?.content ?? null,
            url: meta?.url ?? '',
            source_id: null,
          }
        }))
        : undefined,
      articles: articleIds
        .map((id) => articleMeta.get(id))
        .filter((a): a is { id: string; title: string; url: string; content: string | null } => Boolean(a)),
      matchedEntities,
      status: row.status,
      clusterId: row.cluster_id,
      articleId: null,
      createdAt: row.created_at,
    }
  })
}

function normalizeTopicKey(topic: string): string {
  return topic.trim().toLowerCase()
}

type TopicBlockRule = {
  id: string
  pattern: string
  reason: string | null
}

function isMissingBlocklistTableError(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '42P01'
    || /topic_suggestion_blocklist/i.test(error.message ?? '')
    || /could not find the table/i.test(error.message ?? '')
  )
}

async function loadActiveBlockRules(): Promise<TopicBlockRule[]> {
  const { data, error } = await supabase
    .from('topic_suggestion_blocklist')
    .select('id, pattern, reason')
    .eq('enabled', true)
    .order('created_at', { ascending: false })

  if (error) {
    if (isMissingBlocklistTableError(error)) {
      console.warn('[suggest-clusters] topic_suggestion_blocklist 테이블이 없어 차단 규칙을 건너뜁니다.')
      return []
    }
    throw new Error(`토픽 차단 규칙 조회 실패: ${error.message}`)
  }

  return ((data ?? []) as TopicBlockRule[])
    .map((rule) => ({ ...rule, pattern: rule.pattern.trim() }))
    .filter((rule) => rule.pattern.length > 0)
}

function matchesBlockRule(suggestion: SuggestionWithArticles, rule: TopicBlockRule): boolean {
  const pattern = normalizeTopicKey(rule.pattern)
  if (!pattern) return false

  const searchable = [
    suggestion.topic,
    ...suggestion.keywords,
    ...(suggestion.commonEntities ?? []),
  ].join('\n').toLowerCase()

  return searchable.includes(pattern)
}

async function loadExistingTopicKeys(): Promise<Set<string>> {
  const existingTopicKeys = new Set<string>()

  const { data: existingSuggestionRows, error: existingSuggestionError } = await supabase
    .from('suggested_clusters')
    .select('topic')
    .in('status', ['pending', 'rejected'])

  if (existingSuggestionError) {
    throw new Error(`기존 제안 토픽 조회 실패: ${existingSuggestionError.message}`)
  }

  for (const row of (existingSuggestionRows ?? []) as { topic: string | null }[]) {
    if (row.topic) existingTopicKeys.add(normalizeTopicKey(row.topic))
  }

  const { data: publishedRows, error: publishedError } = await supabase
    .from('articles')
    .select('cluster_id')
    .eq('published', true)
    .not('cluster_id', 'is', null)

  if (publishedError) {
    throw new Error(`게시 완료 기사 조회 실패: ${publishedError.message}`)
  }

  const publishedClusterIds = Array.from(new Set(
    ((publishedRows ?? []) as { cluster_id: string | null }[])
      .map((row) => row.cluster_id)
      .filter((id): id is string => Boolean(id))
  ))

  if (publishedClusterIds.length > 0) {
    const { data: clusterRows, error: clusterError } = await supabase
      .from('article_clusters')
      .select('id, topic')
      .in('id', publishedClusterIds)

    if (clusterError) {
      throw new Error(`게시 완료 토픽 조회 실패: ${clusterError.message}`)
    }

    for (const row of (clusterRows ?? []) as { topic: string | null }[]) {
      if (row.topic) existingTopicKeys.add(normalizeTopicKey(row.topic))
    }
  }

  return existingTopicKeys
}

async function filterDuplicateSuggestions(
  suggestions: SuggestionWithArticles[]
): Promise<{ suggestions: SuggestionWithArticles[]; duplicateSkipCount: number }> {
  const existingTopicKeys = await loadExistingTopicKeys()
  const blockRules = await loadActiveBlockRules()
  const filtered: SuggestionWithArticles[] = []
  let duplicateSkipCount = 0

  for (const suggestion of suggestions) {
    const topicKey = normalizeTopicKey(suggestion.topic)
    if (existingTopicKeys.has(topicKey)) {
      console.log(`skipped (duplicate): ${suggestion.topic}`)
      duplicateSkipCount++
      continue
    }

    if (blockRules.some((rule) => matchesBlockRule(suggestion, rule))) {
      console.log(`skipped (blocked): ${suggestion.topic}`)
      continue
    }

    existingTopicKeys.add(topicKey)
    filtered.push(suggestion)
  }

  return { suggestions: filtered, duplicateSkipCount }
}

async function markRawArticlesSuggested(suggestions: SuggestionWithArticles[]): Promise<void> {
  const articleIds = Array.from(new Set(suggestions.flatMap((suggestion) => suggestion.articleIds)))
  if (articleIds.length === 0) return

  const { error } = await supabase
    .from('raw_articles')
    .update({
      suggestion_state: 'suggested',
      suggestion_last_checked_at: new Date().toISOString(),
    })
    .in('id', articleIds)

  if (error) {
    console.error('[suggest-clusters] raw_articles suggestion_state 업데이트 실패:', error.message)
  }
}

// ============ Entity Matching ============

type SimpleEntity = { name: string; korean_name: string; type: string; aliases?: string[] }

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function entityMatchTerms(entity: SimpleEntity): string[] {
  return [entity.name, ...(entity.aliases ?? [])].filter((term) => term.trim().length > 0)
}

function loadTargetEntities(): SimpleEntity[] {
  try {
    const artists = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'lib/entities/artists.json'), 'utf-8'))
    const celebs = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'lib/entities/celebrities.json'), 'utf-8'))
    return [...artists, ...celebs]
  } catch (err) {
    console.error('Failed to load target entities:', err)
    return []
  }
}

function getMatchedEntities(article: { title?: string | null, content?: string | null }, entities: SimpleEntity[]): string[] {
  const matched = new Set<string>()
  const title = article.title || ''
  const content = (article.content || '').slice(0, 1000)
  const fullText = `${title}\n${content}`
  const lowerText = fullText.toLowerCase()

  for (const ent of entities) {
    const hasNameMatch = entityMatchTerms(ent).some((term) => {
      const lowerTerm = term.toLowerCase()
      const termRegex = new RegExp(`\\b${escapeRegExp(lowerTerm)}\\b`, 'i')
      return termRegex.test(lowerText)
    })

    if (hasNameMatch || fullText.includes(ent.korean_name)) {
      matched.add(ent.name)
    }
  }
  return Array.from(matched)
}

function chunkArticles(articles: RawArticle[], size: number): RawArticle[][] {
  const chunks: RawArticle[][] = []
  for (let i = 0; i < articles.length; i += size) {
    chunks.push(articles.slice(i, i + size))
  }
  return chunks
}

function buildClusterPrompt(batch: RawArticle[]): string {
  const articlesText = batch
    .map((article) =>
      [
        `[${article.id}]`,
        article.sourceName ? `매체: ${article.sourceName}` : null,
        `제목: ${article.title}`,
        `본문: ${articleSnippet(article) || '(본문 없음)'}`,
      ].filter(Boolean).join('\n')
    )
    .join('\n---\n')

  return `다음 기사 목록(${batch.length}개)을 분석하세요.

이 기사들을 읽고 같은 사건/릴리즈/행사/인물을 다루는 기사끼리 묶어서 토픽을 제안하세요.
하나의 클러스터는 반드시 하나의 구체적 사건이어야 합니다.
서로 다른 별개의 사건을 다루는 기사는 절대 같은 클러스터로 묶지 마세요.
여러 기사를 "엔터테인먼트 동향", "아티스트 근황", "음악 산업" 같은 넓은 테마로 묶지 마세요.
topic에는 구체적 고유명사나 작품명/행사명/인물명을 포함하세요.
단독 기사도 가십/라이프 뉴스 기사로 쓸 만한 가치가 있으면 단독으로 제안하세요.

기사 목록:
${articlesText}`
}

export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get('status')

    let query = supabase
      .from('suggested_clusters')
      .select('*')
      .order('created_at', { ascending: false })

    if (status) {
      if (!ALLOWED_STATUSES.includes(status as SuggestionStatus)) {
        return NextResponse.json(
          { error: `유효하지 않은 status: ${status}` },
          { status: 400 }
        )
      }
      query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const suggestions = await hydrateSuggestions((data ?? []) as DbSuggestedCluster[])
    return NextResponse.json({ suggestions })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const limit = typeof body.limit === 'number' && body.limit > 0
      ? Math.min(body.limit, MAX_ANALYSIS_LIMIT)
      : DEFAULT_ANALYSIS_LIMIT

    const { data: articles, error } = await supabase
      .from('raw_articles')
      .select('id, title, content, url, source_id, published_at')
      .or('suggestion_state.is.null,suggestion_state.eq.new')
      .order('published_at', { ascending: false })
      .limit(limit)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!articles || articles.length === 0) {
      return NextResponse.json({ suggestions: [], total: 0, message: '최근 미사용 기사가 없습니다.' })
    }

    const rawArticles = await attachSourceMeta(articles as RawArticle[])
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
    const suggestModel = process.env.OLLAMA_SUGGEST_MODEL || process.env.OLLAMA_MODEL || 'qwen3:14b'
    const validIds = new Set(rawArticles.map((a) => a.id))
    const articleMeta = new Map(
      rawArticles.map((a) => [a.id, { id: a.id, title: a.title, url: a.url }])
    )

    const entities = loadTargetEntities()
    const articleMatchMap = new Map<string, string[]>()
    const withEntities: RawArticle[] = []

    for (const article of rawArticles) {
      const matched = getMatchedEntities(article, entities)
      if (matched.length > 0) {
        articleMatchMap.set(article.id, matched)
        withEntities.push(article)
      }
    }

    const llmInput = withEntities.slice(0, LLM_INPUT_MAX)

    console.log(
      `[stage1] 전체 ${rawArticles.length}개 → 엔터티 매칭 ${withEntities.length}개`
      + ` → LLM 투입 ${llmInput.length}개 (미매칭 제외)`
    )

    if (llmInput.length === 0) {
      return NextResponse.json({
        suggestions: [],
        saved: 0,
        total: articles.length,
        source: 'filter+llm',
        model: suggestModel,
        entityMatchedCount: withEntities.length,
        llmInputCount: 0,
      })
    }

    const batches = chunkArticles(llmInput, LLM_BATCH_SIZE)
    const normalized: SuggestionWithArticles[] = []
    let llmSuggestionCount = 0

    console.log(`[suggest-clusters] 배치 루프 시작: 총 ${batches.length}개 배치`)

    for (const [batchIndex, batch] of batches.entries()) {
      console.log(`[batch ${batchIndex}] 시작 (기사 ${batch.length}개)`)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 180000)

      let ollamaRes: Response
      try {
        ollamaRes = await fetch(`${ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: suggestModel,
            options: { num_ctx: 16384 },
            system: SUGGEST_SYSTEM,
            prompt: buildClusterPrompt(batch),
            format: SUGGEST_RESPONSE_FORMAT,
            stream: false,
          }),
          signal: controller.signal,
        })
      } catch (err: unknown) {
        clearTimeout(timeoutId)
        if (err instanceof Error && err.name === 'AbortError') {
          console.log(`[batch ${batchIndex}] 타임아웃 - 건너뜀`)
        } else {
          console.error(`[batch ${batchIndex}] fetch 에러 - 건너뜀:`, String(err))
        }
        continue
      }
      clearTimeout(timeoutId)

      if (!ollamaRes.ok) {
        console.error(`[batch ${batchIndex}] Ollama 응답 오류: ${ollamaRes.status} - 건너뜀`)
        continue
      }

      const ollamaData = await ollamaRes.json()
      const responseText: string = ollamaData.response ?? ''
      console.log(`[batch ${batchIndex}] LLM response (first 300 chars): ${responseText.slice(0, 300)}`)

      let parsed: { suggestions?: Suggestion[] }
      try {
        parsed = parseSuggestions(responseText)
      } catch (err) {
        console.error(`[batch ${batchIndex}] parseSuggestions 에러 - 건너뜀:`, String(err))
        continue
      }

      const suggestions = parsed.suggestions ?? []
      llmSuggestionCount += suggestions.length

      normalized.push(
        ...suggestions
          .map((s) => normalizeSuggestion(s, validIds, articleMeta, rawArticles, articleMatchMap))
          .filter((s): s is SuggestionWithArticles => s !== null)
      )
      console.log(`[batch ${batchIndex}] 종료: ${suggestions.length}개 제안 파싱 완료`)
    }

    console.log(
      `[suggest-clusters] 배치 루프 종료, LLM 제안: ${llmSuggestionCount}건,`
      + ` 정규화 통과: ${normalized.length}건`
    )

    if (normalized.length === 0) {
      console.log('[suggest-clusters] 저장 0건')
      return NextResponse.json({
        suggestions: [],
        saved: 0,
        total: articles.length,
        source: 'filter+llm',
        model: suggestModel,
        entityMatchedCount: withEntities.length,
        llmInputCount: llmInput.length,
        batchCount: batches.length,
        llmSuggestionCount,
        normalizedSuggestionCount: 0,
      })
    }

    const { suggestions: saveableSuggestions, duplicateSkipCount } =
      await filterDuplicateSuggestions(normalized)

    if (saveableSuggestions.length === 0) {
      console.log('[suggest-clusters] 저장 0건')
      return NextResponse.json({
        suggestions: [],
        saved: 0,
        total: articles.length,
        source: 'filter+llm',
        model: suggestModel,
        entityMatchedCount: withEntities.length,
        llmInputCount: llmInput.length,
        batchCount: batches.length,
        llmSuggestionCount,
        normalizedSuggestionCount: normalized.length,
        duplicateSkipCount,
      })
    }

    // 나중에 기사 생성 시 활용 가능하도록 keywords 배열에 매칭된 엔티티 이름 병합
    const insertPayload = saveableSuggestions.map((s) => ({
      topic: s.topic,
      keywords: Array.from(new Set([...s.keywords, ...(s.matchedEntities || [])])),
      article_ids: s.articleIds,
      status: 'pending' as const,
    }))

    const { data: inserted, error: insertError } = await supabase
      .from('suggested_clusters')
      .insert(insertPayload)
      .select()

    if (insertError) {
      return NextResponse.json({ error: `제안 저장 실패: ${insertError.message}` }, { status: 500 })
    }

    await markRawArticlesSuggested(saveableSuggestions)

    const persisted = await hydrateSuggestions((inserted ?? []) as DbSuggestedCluster[])
    console.log(`[suggest-clusters] 저장: ${persisted.length}건`)

    return NextResponse.json({
      suggestions: persisted,
      saved: persisted.length,
      total: articles.length,
      source: 'filter+llm',
      model: suggestModel,
      entityMatchedCount: withEntities.length,
      llmInputCount: llmInput.length,
      batchCount: batches.length,
      llmSuggestionCount,
      normalizedSuggestionCount: normalized.length,
      duplicateSkipCount,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
