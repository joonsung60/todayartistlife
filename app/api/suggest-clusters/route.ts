import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { cleanArticleText } from '@/lib/article-extraction'

const SUGGEST_SYSTEM = `당신은 EDM 뉴스 에디터입니다. 최근 영문 EDM 뉴스 기사 목록을 받아 한국어 기사 1개로 재구성할 수 있는 후보만 제안하세요.

핵심 원칙:
- 카테고리 클러스터 금지: festival, synth, preview, release, new music, house, techno, club, lineup 같은 넓은 단어만 공유하는 묶음은 절대 제안하지 마세요.
- 반드시 같은 사건, 같은 릴리즈, 같은 행사, 같은 인물, 같은 제품 단위로만 묶으세요.
- 좋은 예: "Music On Festival 취소 사태", "EDC Las Vegas 2026 관련 소식", "Armin van Buuren 'A State of Trance 2026' 발매"
- 나쁜 예: "주요 페스티벌 소식", "신시사이저 뉴스", "preview 관련 EDM 뉴스"

반드시 아래 JSON 형식으로만 응답하세요. 그 외의 설명이나 마크다운 금지.

{
  "suggestions": [
    {
      "topic": "한국어 토픽 (40자 이내)",
      "keywords": ["english", "keyword", "list"],
      "articleIds": ["uuid", "uuid"],
      "reason": "같은 사건/릴리즈/행사/인물로 판단한 이유",
      "commonEntities": ["Music On Festival", "Amsterdam"]
    }
  ]
}

규칙:
- 3~5개의 그룹을 제안하되, 각 그룹은 최소 2개의 기사를 포함
- topic: 한국어, 구체적이고 명확하게 (예: "Music On Festival 취소 사태")
- keywords: 3~6개의 영문 키워드. 카테고리 단어 단독 금지
- articleIds: 반드시 제공된 목록의 UUID만 사용
- reason: 왜 하나의 기사로 묶을 수 있는지 설명
- commonEntities: 기사 제목/요약에서 반복되는 구체적 고유명사 또는 사건 문구
- 어느 그룹에도 명확히 속하지 않는 단일 기사는 제외`

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
}

type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'published'

const ALLOWED_STATUSES: SuggestionStatus[] = ['pending', 'approved', 'rejected', 'published']

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
])

function articleSnippet(article: RawArticle): string {
  return cleanArticleText(article.content ?? '', 600)
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
    .replace(/^(at|for|of|the|with)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isCategoryKeyword(keyword: string): boolean {
  return CATEGORY_KEYWORDS.has(normalizeText(keyword))
}

function isSpecificEntity(entity: string): boolean {
  const normalized = normalizeText(entity)
  if (!normalized || isCategoryKeyword(normalized)) {
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

function extractTitleEntities(title: string): string[] {
  const cleanedTitle = title
    .replace(/[“”‘’]/g, "'")
    .replace(/[^\w\s'&.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = cleanedTitle.split(/\s+/).filter(Boolean)
  const entities: string[] = []
  const knownEntityPatterns = [
    /\bA State of Trance 2026\b/i,
    /\bEDC Las Vegas(?: 2026)?\b/i,
    /\bMusic On Festival\b/i,
    /\bSuperbooth 2026\b/i,
  ]

  for (const pattern of knownEntityPatterns) {
    const match = cleanedTitle.match(pattern)
    if (match) {
      entities.push(normalizeEntity(match[0]))
    }
  }

  for (let size = 4; size >= 2; size--) {
    for (let index = 0; index <= words.length - size; index++) {
      const phrase = normalizeEntity(words.slice(index, index + size).join(' '))
      if (!isSpecificEntity(phrase)) {
        continue
      }
      const normalized = normalizeText(phrase)
      const categoryCount = normalized.split(' ').filter((token) => CATEGORY_KEYWORDS.has(token)).length
      if (categoryCount >= size - 1) {
        continue
      }
      entities.push(phrase)
    }
  }

  return Array.from(new Set(entities))
}

function articleSetKey(articleIds: string[]): string {
  return [...articleIds].sort().join('|')
}

function dedupeSuggestions(suggestions: SuggestionWithArticles[]): SuggestionWithArticles[] {
  const bestByArticles = new Map<string, SuggestionWithArticles>()

  for (const suggestion of suggestions) {
    const key = articleSetKey(suggestion.articleIds)
    const previous = bestByArticles.get(key)
    const entityLength = suggestion.commonEntities?.[0]?.length ?? 0
    const previousEntityLength = previous?.commonEntities?.[0]?.length ?? 0

    if (!previous || suggestion.cohesionScore! > previous.cohesionScore! || entityLength > previousEntityLength) {
      bestByArticles.set(key, suggestion)
    }
  }

  return Array.from(bestByArticles.values())
}

function removeSubsetSuggestions(suggestions: SuggestionWithArticles[]): SuggestionWithArticles[] {
  const selected: SuggestionWithArticles[] = []

  for (const suggestion of suggestions) {
    const ids = new Set(suggestion.articleIds)
    const isSubset = selected.some((existing) => {
      const existingIds = new Set(existing.articleIds)
      return suggestion.articleIds.every((id) => existingIds.has(id))
        && existing.articleIds.length > suggestion.articleIds.length
    })

    if (!isSubset && ids.size >= 2) {
      selected.push({ ...suggestion, articleIds: Array.from(ids) })
    }
  }

  return selected
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
      return article ? normalizeText(article.title).includes(normalizedEntity) : false
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
    : calculateCohesionScore(articleIds, commonEntities.length > 0 ? commonEntities : keywords, rawArticles)

  if (!topic || articleIds.length < 2 || cohesionScore < 60) {
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

function fallbackTopicForEntity(entity: string): string {
  const normalized = normalizeText(entity)
  const topicMap: Record<string, string> = {
    'a state of trance 2026': "Armin van Buuren 'A State of Trance 2026' 발매",
    'edc las vegas': 'EDC 라스베이거스 2026 관련 소식',
    'las vegas 2026': 'EDC 라스베이거스 2026 관련 소식',
    'music on festival': 'Music On Festival 취소 사태',
    'superbooth 2026': 'Superbooth 2026 신시사이저 신제품 공개',
  }

  return topicMap[normalized] ?? `${entity} 관련 소식`
}

function fallbackSuggestions(
  articles: RawArticle[],
  articleMeta: Map<string, { id: string; title: string; url: string }>
): SuggestionWithArticles[] {
  const groups = new Map<string, Map<string, RawArticle>>()

  for (const article of articles) {
    for (const entity of extractTitleEntities(article.title)) {
      const key = normalizeText(entity)
      const group = groups.get(key) ?? new Map<string, RawArticle>()
      group.set(article.id, article)
      groups.set(key, group)
    }
  }

  const suggestions = Array.from(groups.entries())
    .map(([entityKey, groupMap]) => {
      const group = Array.from(groupMap.values())
      const entity = extractTitleEntities(group[0].title)
        .find((candidate) => normalizeText(candidate) === entityKey) ?? entityKey
      const articleIds = group.slice(0, 8).map((article) => article.id)
      const cohesionScore = calculateCohesionScore(articleIds, [entity], articles)
      return {
        topic: fallbackTopicForEntity(entity),
        keywords: [entity],
        articleIds,
        reason: `"${entity}"가 여러 기사 제목에서 반복되어 같은 사건/행사/제품 후보로 판단했습니다.`,
        commonEntities: [entity],
        cohesionScore,
        articles: articleIds.map((id) => articleMeta.get(id)!).filter(Boolean),
      }
    })
    .filter((suggestion) => suggestion.articleIds.length >= 2 && suggestion.cohesionScore >= 60)

  return removeSubsetSuggestions(dedupeSuggestions(suggestions)
    .sort((a, b) => (b.cohesionScore ?? 0) - (a.cohesionScore ?? 0) || b.articleIds.length - a.articleIds.length)
  ).slice(0, 5)
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
    const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.min(body.limit, 100) : 50

    const { data: articles, error } = await supabase
      .from('raw_articles')
      .select('id, title, content, url')
      .eq('is_used', false)
      .order('published_at', { ascending: false })
      .limit(limit)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!articles || articles.length === 0) {
      return NextResponse.json({ suggestions: [], total: 0, message: '최근 미사용 기사가 없습니다.' })
    }

    const rawArticles = articles as RawArticle[]
    const articlesText = rawArticles
      .map((article) =>
        `[${article.id}]\n제목: ${article.title}\n요약: ${articleSnippet(article) || '(본문 없음)'}`
      )
      .join('\n---\n')

    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
    const ollamaRes = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3:14b',
        system: SUGGEST_SYSTEM,
        prompt: `다음 기사 목록(${articles.length}개)을 분석해 토픽 그룹을 제안하세요.\n\n${articlesText}`,
        format: 'json',
        stream: false,
        think: false,
      }),
    })

    if (!ollamaRes.ok) {
      return NextResponse.json(
        { error: `Ollama 응답 오류: ${ollamaRes.status}` },
        { status: 502 }
      )
    }

    const ollamaData = await ollamaRes.json()
    const responseText: string = ollamaData.response ?? ''

    let parsed: { suggestions?: Suggestion[] }
    try {
      parsed = parseSuggestions(responseText)
    } catch (err) {
      return NextResponse.json(
        { error: String(err), raw: responseText.slice(0, 500) },
        { status: 502 }
      )
    }

    const validIds = new Set(rawArticles.map((article) => article.id))
    const articleMeta = new Map(
      rawArticles.map((article) => [article.id, { id: article.id, title: article.title, url: article.url }])
    )

    const llmSuggestions = (parsed.suggestions ?? [])
      .map((suggestion) => normalizeSuggestion(suggestion, validIds, articleMeta, rawArticles))
      .filter((suggestion): suggestion is SuggestionWithArticles => suggestion !== null)
    const suggestions = llmSuggestions.length > 0
      ? llmSuggestions
      : fallbackSuggestions(rawArticles, articleMeta)

    const source = llmSuggestions.length > 0 ? 'llm' : 'fallback'

    if (suggestions.length === 0) {
      return NextResponse.json({
        suggestions: [],
        saved: 0,
        total: articles.length,
        source,
        llmSuggestionCount: parsed.suggestions?.length ?? 0,
      })
    }

    const insertPayload = suggestions.map((s) => ({
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
      return NextResponse.json(
        { error: `제안 저장 실패: ${insertError.message}` },
        { status: 500 }
      )
    }

    const persisted = await hydrateSuggestions((inserted ?? []) as DbSuggestedCluster[])

    return NextResponse.json({
      suggestions: persisted,
      saved: persisted.length,
      total: articles.length,
      source,
      llmSuggestionCount: parsed.suggestions?.length ?? 0,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
