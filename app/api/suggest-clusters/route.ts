import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { cleanArticleText } from '@/lib/article-extraction'

const SUGGEST_SYSTEM = `당신은 전세계 전자음악 씬 전반을 다루는 에디터입니다. 다국어(영어, 이탈리아어, 스페인어, 독일어, 프랑스어 등)로 된 뉴스 원문을 한 편 또는 여러 편 받아 언어에 무관하게 한국어 기사로 작성할 만한 소재인지 판단합니다.

핵심 원칙:
- 아래 주제 등 전자음악과 연결고리가 있으면 적극 승인하세요:
  * 아티스트/DJ/프로듀서 관련 소식
  * 릴리즈 (신곡, 앨범, EP, 리믹스)
  * 페스티벌, 클럽, 이벤트
  * 음악 장비, 신디사이저, 소프트웨어
  * 클럽 문화, 씬 소식, 업계 동향
  * 레이블, 스트리밍 플랫폼 관련 소식
- 거절 기준을 높이세요. 전자음악과 완전히 무관한 경우(예: 순수 팝/록 기사, 스포츠, 정치 등)에만 거절하세요.
- 거절 시 반드시 이유를 reason 필드에 넣으세요.
- 모든 소스를 동등하게 취급하세요. 특정 매체의 등급이나 권위를 기준으로 거르지 마세요.
- 연도 단독(2025, 2026 등), 매체명, 사이트명, 시리즈명, 인터뷰 형식 표현(catches up with, chats to, talks to 등), 연말 결산/차트/베스트 목록 문구는 절대 승인 기준으로 사용하지 마세요.
- 좋은 예: "Music On Festival 취소 사태", "EDC Las Vegas 2026 관련 소식", "Armin van Buuren 'A State of Trance 2026' 발매", "John Summit 신곡 'Light Years' 공개"

응답 작성 시:
- topic은 한국어로, 구체적이고 명확하게 작성하세요.
- keywords는 3~6개의 영문 키워드로, 카테고리 단어 단독 사용 금지.
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
}

type RawArticle = {
  id: string
  title: string
  content: string | null
  url: string
  source_id: string | number | null
  sourceName?: string
}

type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'published'

const ALLOWED_STATUSES: SuggestionStatus[] = ['pending', 'approved', 'rejected', 'published']
const MIN_COHESION_SCORE = 20
const DEFAULT_ANALYSIS_LIMIT = 200
const MAX_ANALYSIS_LIMIT = 200
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
  'album',
  'albums',
  'club',
  'clubs',
  'dj',
  'edm',
  'festival',
  'festivals',
  'house',
  'intros',
  'lineup',
  'line-ups',
  'music',
  'new',
  'new music',
  'premiere',
  'preview',
  'record',
  'records',
  'release',
  'released',
  'releases',
  'single',
  'synth',
  'synths',
  'techno',
  'track',
  'tracks',
])

const STOPWORDS = new Set([
  'about',
  'after',
  'album',
  'albums',
  'also',
  'and',
  'are',
  'artist',
  'artists',
  'back',
  'best',
  'can',
  'club',
  'dance',
  'deep',
  'dj',
  'edm',
  'from',
  'has',
  'have',
  'home',
  'house',
  'into',
  'label',
  'live',
  'magazine',
  'menu',
  'mix',
  'music',
  'new',
  'news',
  'out',
  'premiere',
  'preview',
  'records',
  'release',
  'released',
  'releases',
  'review',
  'show',
  'site',
  'single',
  'so',
  'techno',
  'tech',
  'the',
  'this',
  'track',
  'tracks',
  'with',
  'year',
  'far',
  'just',
  'page',
	  'privacy',
	  'policy',
	  'cookie',
	  'cookies',
	  'http',
	  'https',
	  'www',
	  'com',
	  'net',
	  'org',
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
    sourceMeta.set(String(source.id), {
      name,
    })
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
      if (!article) {
        return false
      }
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
  rawArticles: RawArticle[]
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
    : articleIds.length === 1
      ? STAGE2_DEFAULT_COHESION
      : calculateCohesionScore(articleIds, commonEntities.length > 0 ? commonEntities : keywords, rawArticles)

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

  return {
    topic,
    keywords,
    articleIds,
    reason,
    commonEntities,
    cohesionScore,
    articles: articleIds.map((id) => articleMeta.get(id)!).filter(Boolean),
  }
}

async function hydrateSuggestions(rows: DbSuggestedCluster[]): Promise<PersistedSuggestion[]> {
  if (rows.length === 0) return []

  const allIds = Array.from(new Set(rows.flatMap((row) => row.article_ids ?? [])))
  const articleMeta = new Map<string, { id: string; title: string; url: string }>()

  if (allIds.length > 0) {
    const { data: rawArticles } = await supabase
      .from('raw_articles')
      .select('id, title, url')
      .in('id', allIds)

    for (const article of (rawArticles ?? []) as { id: string; title: string; url: string }[]) {
      articleMeta.set(article.id, { id: article.id, title: article.title, url: article.url })
    }
  }

  return rows.map((row) => {
    const articleIds = row.article_ids ?? []
    const commonEntities = row.keywords?.filter((keyword) => !isCategoryKeyword(keyword)) ?? []
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
	            content: null,
	            url: meta?.url ?? '',
	            source_id: null,
	          }
	        }))
        : undefined,
      articles: articleIds
        .map((id) => articleMeta.get(id))
        .filter((a): a is { id: string; title: string; url: string } => Boolean(a)),
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
    .map((rule) => ({
      ...rule,
      pattern: rule.pattern.trim(),
    }))
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

// ============ Entity dictionary (2-stage 후보 생성용) ============

type EntityEntry = {
  canonical: string
  surfaces: string[]
  weight: number
}

type EntityDataset = {
  artists_top500_relevance_2024_2025?: Array<{ name?: string; aliases?: string[] }>
  major_edm_festivals_worldwide?: Array<{ name?: string }>
  edm_labels_key_artists?: Array<{ name?: string }>
  club_venues?: Array<{ name?: string; aliases?: string[] }>
  equipment_software_brands?: Array<{ name?: string; aliases?: string[] }>
}

const ENTITY_DICT_CANDIDATE_PATHS = [
  'lib/edm-entities.json',
]

const ENTITY_HAYSTACK_CONTENT_LIMIT = 500
const STAGE2_DEFAULT_COHESION = 50
const LLM_INPUT_MAX = 60
const NO_ENTITY_RATIO_MAX = 0.3

function loadEntityDictionary(): EntityEntry[] | null {
  for (const rel of ENTITY_DICT_CANDIDATE_PATHS) {
    const abs = path.join(process.cwd(), rel)
    try {
      const raw = fs.readFileSync(abs, 'utf-8')
      const data = JSON.parse(raw) as EntityDataset
      const entries: EntityEntry[] = []
      for (const artist of data.artists_top500_relevance_2024_2025 ?? []) {
        const name = artist?.name
        if (!name) continue
        const surfaces = [name, ...(artist.aliases ?? [])]
          .map((s) => (typeof s === 'string' ? s.toLowerCase() : ''))
          .filter((s) => s.length >= 2)
        if (surfaces.length === 0) continue
        entries.push({ canonical: name, surfaces, weight: 1.0 })
      }
      for (const festival of data.major_edm_festivals_worldwide ?? []) {
        const name = festival?.name
        if (!name || name.length < 2) continue
        entries.push({ canonical: name, surfaces: [name.toLowerCase()], weight: 1.0 })
      }
      for (const label of data.edm_labels_key_artists ?? []) {
        const name = label?.name
        if (!name || name.length < 2) continue
        entries.push({ canonical: name, surfaces: [name.toLowerCase()], weight: 0.6 })
      }
      for (const club of data.club_venues ?? []) {
        const name = club?.name
        if (!name) continue
        const surfaces = [name, ...(club.aliases ?? [])]
          .map((s) => (typeof s === 'string' ? s.toLowerCase() : ''))
          .filter((s) => s.length >= 2)
        if (surfaces.length === 0) continue
        entries.push({ canonical: name, surfaces, weight: 0.8 })
      }
      for (const brand of data.equipment_software_brands ?? []) {
        const name = brand?.name
        if (!name) continue
        const surfaces = [name, ...(brand.aliases ?? [])]
          .map((s) => (typeof s === 'string' ? s.toLowerCase() : ''))
          .filter((s) => s.length >= 2)
        if (surfaces.length === 0) continue
        entries.push({ canonical: name, surfaces, weight: 0.6 })
      }
      console.log(`[suggest-clusters] entity dict loaded from ${rel}: ${entries.length} entries`)
      return entries
    } catch {
      // 다음 후보 경로 시도
    }
  }
  return null
}

function findSurfaceInText(text: string, surface: string): boolean {
  if (!surface || surface.length < 2) return false
  let from = 0
  while (true) {
    const i = text.indexOf(surface, from)
    if (i < 0) return false
    const before = i === 0 ? ' ' : text[i - 1]
    const after = i + surface.length >= text.length ? ' ' : text[i + surface.length]
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true
    from = i + 1
  }
}

function buildEntityIndex(
  articles: RawArticle[],
  dict: EntityEntry[],
): { articleEntities: Map<string, Set<string>>; entityArticles: Map<string, Set<string>> } {
  const articleEntities = new Map<string, Set<string>>()
  const entityArticles = new Map<string, Set<string>>()
  for (const article of articles) {
    const haystack = `${article.title ?? ''}\n${(article.content ?? '').slice(0, ENTITY_HAYSTACK_CONTENT_LIMIT)}`.toLowerCase()
    const matched = new Set<string>()
    for (const entry of dict) {
      for (const surface of entry.surfaces) {
        if (findSurfaceInText(haystack, surface)) {
          matched.add(entry.canonical)
          break
        }
      }
    }
    articleEntities.set(article.id, matched)
    for (const canonical of matched) {
      if (!entityArticles.has(canonical)) entityArticles.set(canonical, new Set())
      entityArticles.get(canonical)!.add(article.id)
    }
  }
  return { articleEntities, entityArticles }
}

async function runLlmOnlyPath(
  rawArticles: RawArticle[],
  totalCount: number,
  suggestModel: string,
  ollamaUrl: string,
  validIds: Set<string>,
  articleMeta: Map<string, { id: string; title: string; url: string }>,
): Promise<NextResponse> {
  const articlesText = rawArticles
    .map((article) =>
      [
        `[${article.id}]`,
        article.sourceName ? `매체: ${article.sourceName}` : null,
        `제목: ${article.title}`,
        `요약: ${articleSnippet(article) || '(본문 없음)'}`,
      ].filter(Boolean).join('\n')
    )
    .join('\n---\n')

  const ollamaRes = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: suggestModel,
      system: SUGGEST_SYSTEM,
      prompt: `다음 기사 목록(${rawArticles.length}개)을 분석해 토픽 그룹을 제안하세요.\n\n${articlesText}`,
      format: SUGGEST_RESPONSE_FORMAT,
      stream: false,
    }),
  })

  if (!ollamaRes.ok) {
    return NextResponse.json({ error: `Ollama 응답 오류: ${ollamaRes.status}` }, { status: 502 })
  }

  const ollamaData = await ollamaRes.json()
  const responseText: string = ollamaData.response ?? ''

  let parsed: { suggestions?: Suggestion[] }
  try {
    parsed = parseSuggestions(responseText)
  } catch (err) {
    return NextResponse.json({ error: String(err), raw: responseText.slice(0, 500) }, { status: 502 })
  }

  const llmSuggestions = (parsed.suggestions ?? [])
    .map((suggestion) => normalizeSuggestion(suggestion, validIds, articleMeta, rawArticles))
    .filter((suggestion): suggestion is SuggestionWithArticles => suggestion !== null)

  if (llmSuggestions.length === 0) {
    return NextResponse.json({
      suggestions: [],
      saved: 0,
      total: totalCount,
      source: 'llm',
      model: suggestModel,
      llmSuggestionCount: parsed.suggestions?.length ?? 0,
      normalizedSuggestionCount: 0,
      rawResponsePreview: responseText.slice(0, 500),
    })
  }

  const { suggestions: saveableSuggestions, duplicateSkipCount } =
    await filterDuplicateSuggestions(llmSuggestions)

  if (saveableSuggestions.length === 0) {
    return NextResponse.json({
      suggestions: [],
      saved: 0,
      total: totalCount,
      source: 'llm',
      model: suggestModel,
      llmSuggestionCount: parsed.suggestions?.length ?? 0,
      normalizedSuggestionCount: llmSuggestions.length,
      duplicateSkipCount,
      rawResponsePreview: responseText.slice(0, 500),
    })
  }

  const insertPayload = saveableSuggestions.map((s) => ({
    topic: s.topic,
    keywords: s.keywords,
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
  return NextResponse.json({
    suggestions: persisted,
    saved: persisted.length,
    total: totalCount,
    source: 'llm',
    model: suggestModel,
    llmSuggestionCount: parsed.suggestions?.length ?? 0,
    normalizedSuggestionCount: llmSuggestions.length,
    duplicateSkipCount,
  })
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

    const dict = loadEntityDictionary()
    if (!dict) {
      console.error('[suggest-clusters] entity dictionary 로드 실패 — 단일 LLM 경로로 fallback')
      return await runLlmOnlyPath(rawArticles, articles.length, suggestModel, ollamaUrl, validIds, articleMeta)
    }

    // ───── Stage 1: 엔터티 매칭으로 LLM 투입 기사 필터링 ─────
    const { articleEntities } = buildEntityIndex(rawArticles, dict)
    const withEntities: RawArticle[] = []
    const withoutEntities: RawArticle[] = []
    for (const article of rawArticles) {
      const matched = articleEntities.get(article.id)
      if (matched && matched.size > 0) {
        withEntities.push(article)
      } else {
        withoutEntities.push(article)
      }
    }

    const prioritySelected = withEntities.slice(0, LLM_INPUT_MAX)
    const remainingSlots = LLM_INPUT_MAX - prioritySelected.length
    const noEntityMaxByRatio = Math.floor(LLM_INPUT_MAX * NO_ENTITY_RATIO_MAX)
    const noEntitySelected = withoutEntities.slice(0, Math.min(remainingSlots, noEntityMaxByRatio))
    const llmInput = [...prioritySelected, ...noEntitySelected]

    console.log(
      `[stage1] 전체 ${rawArticles.length}개 → 엔터티 매칭 ${withEntities.length}개`
      + ` / 미매칭 ${withoutEntities.length}개 → LLM 투입 ${llmInput.length}개`
    )

    if (llmInput.length === 0) {
      return NextResponse.json({
        suggestions: [],
        saved: 0,
        total: articles.length,
        source: 'filter+llm',
        model: suggestModel,
        entityMatchedCount: withEntities.length,
        noEntityCount: withoutEntities.length,
        llmInputCount: 0,
      })
    }

    // ───── Stage 2: LLM이 클러스터링 + 토픽 제안 ─────
    const articlesText = llmInput
      .map((article) =>
        [
          `[${article.id}]`,
          article.sourceName ? `매체: ${article.sourceName}` : null,
          `제목: ${article.title}`,
          `본문: ${articleSnippet(article) || '(본문 없음)'}`,
        ].filter(Boolean).join('\n')
      )
      .join('\n---\n')

    const clusterPrompt = `다음 기사 목록(${llmInput.length}개)을 분석하세요.

이 기사들을 읽고 같은 사건/릴리즈/행사/인물을 다루는 기사끼리 묶어서 토픽을 제안하세요.
하나의 클러스터는 반드시 하나의 구체적 사건이어야 합니다.
서로 다른 별개의 사건을 다루는 기사는 절대 같은 클러스터로 묶지 마세요.
단독 기사도 한국어 EDM 기사로 쓸 만한 가치가 있으면 단독으로 제안하세요.

기사 목록:
${articlesText}`

    const ollamaRes = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: suggestModel,
        system: SUGGEST_SYSTEM,
        prompt: clusterPrompt,
        format: SUGGEST_RESPONSE_FORMAT,
        stream: false,
      }),
    })

    if (!ollamaRes.ok) {
      return NextResponse.json({ error: `Ollama 응답 오류: ${ollamaRes.status}` }, { status: 502 })
    }

    const ollamaData = await ollamaRes.json()
    const responseText: string = ollamaData.response ?? ''

    let parsed: { suggestions?: Suggestion[] }
    try {
      parsed = parseSuggestions(responseText)
    } catch (err) {
      return NextResponse.json({ error: String(err), raw: responseText.slice(0, 500) }, { status: 502 })
    }

    const llmInputValidIds = new Set(llmInput.map((a) => a.id))
    const normalized = (parsed.suggestions ?? [])
      .map((s) => normalizeSuggestion(s, llmInputValidIds, articleMeta, llmInput))
      .filter((s): s is SuggestionWithArticles => s !== null)

    console.log(
      `[suggest-clusters] LLM 제안: ${parsed.suggestions?.length ?? 0}건,`
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
        noEntityCount: withoutEntities.length,
        llmInputCount: llmInput.length,
        llmSuggestionCount: parsed.suggestions?.length ?? 0,
        normalizedSuggestionCount: 0,
        rawResponsePreview: responseText.slice(0, 500),
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
        noEntityCount: withoutEntities.length,
        llmInputCount: llmInput.length,
        llmSuggestionCount: parsed.suggestions?.length ?? 0,
        normalizedSuggestionCount: normalized.length,
        duplicateSkipCount,
      })
    }

    const insertPayload = saveableSuggestions.map((s) => ({
      topic: s.topic,
      keywords: s.keywords,
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
      noEntityCount: withoutEntities.length,
      llmInputCount: llmInput.length,
      llmSuggestionCount: parsed.suggestions?.length ?? 0,
      normalizedSuggestionCount: normalized.length,
      duplicateSkipCount,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
