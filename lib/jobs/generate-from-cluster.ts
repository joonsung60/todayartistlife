import fs from 'node:fs'
import path from 'node:path'
import { supabase } from '@/lib/supabase'
import { cleanArticleText, extractArticleText } from '@/lib/article-extraction'
import { findCategory } from '@/lib/taxonomy'
import { SYSTEM_PROMPT_A } from '@/lib/prompts'

type SimpleEntity = { name: string; korean_name: string; type: string; aliases?: string[] }

function loadEntities(): SimpleEntity[] {
  try {
    const artists = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'lib/entities/artists.json'), 'utf-8'))
    return artists
  } catch (err) {
    console.error('Failed to load entities:', err)
    return []
  }
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function entityMatchTerms(entity: SimpleEntity): string[] {
  return [entity.name, ...(entity.aliases ?? [])].filter((term) => term.trim().length > 0)
}

// 짧거나(<=3글자) 흔한 영어 단어일 수 있는 한 단어 이름(V, CL, Rose, Drake, Rain 등)은
// 일반 word boundary 매칭만으로는 무관한 기사에서 오탐이 발생한다.
function isAmbiguousTerm(term: string): boolean {
  return term.length <= 3 || /^[A-Za-z]+$/.test(term)
}

// 모호한 term은 원문(대소문자 보존)에서 대문자로 시작하고 앞뒤가 글자/숫자가 아닌
// (공백·문장부호·문자열 경계) 위치에 나타날 때만 매칭한다.
function matchesProperNounTerm(text: string, term: string): boolean {
  const regex = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, 'giu')
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (/[A-Z]/.test(match[0][0])) {
      return true
    }
  }
  return false
}

function matchesEntityTerm(text: string, lowerText: string, term: string): boolean {
  if (isAmbiguousTerm(term)) {
    return matchesProperNounTerm(text, term)
  }
  const termRegex = new RegExp(`\\b${escapeRegExp(term.toLowerCase())}\\b`, 'i')
  return termRegex.test(lowerText)
}

function getMatchedEntities(fullText: string, entities: SimpleEntity[]): SimpleEntity[] {
  const lowerText = fullText.toLowerCase()
  return entities.filter(ent => {
    const hasNameMatch = entityMatchTerms(ent).some((term) =>
      matchesEntityTerm(fullText, lowerText, term)
    )
    return hasNameMatch || fullText.includes(ent.korean_name)
  })
}

// 사후 교정을 위한 함수 (optional)
function applyDisplayNameMapping(text: string, matchedEntities: SimpleEntity[]): string {
  let result = text
  const replacements = matchedEntities
    .filter(e => e.name !== e.korean_name)
    .flatMap((entity) => entityMatchTerms(entity).map((term) => ({
      term,
      koreanName: entity.korean_name,
    })))
    .sort((a, b) => b.term.length - a.term.length)

  for (const { term, koreanName } of replacements) {
    const regex = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi')
    result = result.replace(regex, (match, offset: number) => {
      if (result[offset - 1] === '(') return match
      return koreanName
    })
  }
  return result
}

type SourceArticle = {
  title: string
  content: string
  source: string
  sourceName: string
  publishedAt: string | null
}

type GeneratedArticle = {
  title: string
  content: string
  slug: string
  category: string
  entities: string[]
}

const SLUG_MAX_LENGTH = 60
const DEFAULT_CATEGORY = 'news'

type ClusterArticleRow = {
  raw_article_id: string
}

type RawArticleRow = {
  id: string
  title: string | null
  content: string | null
  url: string
  published_at: string | null
  source_id: string | number | null
}

type SourceMeta = {
  name: string
}

const RESPONSE_NOISE_PATTERNS = [
  /\b(login|search|members login|become a member|advertise|contact us)\b/i,
  /\b(share|email|facebook|twitter|reddit|pinterest|whatsapp|telegram)\b/i,
  /\b(previous article|next article|related articles|more from author|comments are closed)\b/i,
  /\b(sign up|subscribe|claim this offer|read more)\b/i,
]

function compactSourceText(text: string): string {
  return cleanArticleText(text, 2500).replace(/\s+/g, ' ').trim()
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return '원문 매체'
  }
}

function cleanSourceUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return url
  }
}

function sourceNameForAttribution(article: RawArticleRow, sourceMeta: Map<string, SourceMeta>): string {
  if (article.source_id !== null) {
    const sourceName = sourceMeta.get(String(article.source_id))?.name?.trim()
    if (sourceName) {
      return sourceName
    }
  }

  return domainFromUrl(article.url)
}

function appendSingleSourceAttribution(
  content: string,
  rawArticles: RawArticleRow[],
  sourceMeta: Map<string, SourceMeta>
): string {
  if (rawArticles.length !== 1) {
    return content
  }

  const [article] = rawArticles
  const sourceName = sourceNameForAttribution(article, sourceMeta)
  const sourceUrl = cleanSourceUrl(article.url)
  return `${content.trim()}\n\n*이 기사는 ${sourceName}의 원문을 바탕으로 재구성되었습니다. [원문 보기](${sourceUrl})*`
}

async function fetchSourceMeta(sourceIds: Array<string | number | null>): Promise<Map<string, SourceMeta>> {
  const ids = Array.from(new Set(sourceIds.filter((id): id is string | number => id !== null)))
  const sourceMeta = new Map<string, SourceMeta>()

  if (ids.length === 0) return sourceMeta

  const { data } = await supabase
    .from('rss_sources')
    .select('id, name')
    .in('id', ids)

  for (const source of (data ?? []) as { id: string | number; name: string | null }[]) {
    sourceMeta.set(String(source.id), {
      name: source.name ?? '알 수 없는 소스',
    })
  }

  return sourceMeta
}

function formatSourceDate(iso: string | null): string {
  const date = iso ? new Date(iso) : new Date()
  if (Number.isNaN(date.getTime())) {
    const fallback = new Date()
    return `${fallback.getUTCMonth() + 1}월 ${fallback.getUTCDate()}일`
  }
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`
}

async function fetchArticleContent(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    const html = await res.text()
    return extractArticleText(html, 3000)
  } catch {
    return ''
  }
}

function parseGeneratedArticle(response: string): GeneratedArticle | null {
  const cleaned = response
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<GeneratedArticle>
      if (typeof parsed.title === 'string' && typeof parsed.content === 'string') {
        return {
          title: parsed.title.trim(),
          content: parsed.content.trim(),
          slug: typeof parsed.slug === 'string' ? parsed.slug.trim() : '',
          category: typeof parsed.category === 'string' ? parsed.category.trim() : '',
          entities: Array.isArray(parsed.entities)
            ? parsed.entities
              .filter((entity): entity is string => typeof entity === 'string')
              .map((entity) => entity.trim())
              .filter(Boolean)
            : [],
        }
      }
    } catch {
      // Fall through
    }
  }

  const titleMatch = cleaned.match(/^제목:\s*(.+)$/m)
  const contentMatch = cleaned.match(/^내용:\s*([\s\S]+?)(?=\n(?:슬러그|카테고리):|$)/m)
  if (!titleMatch || !contentMatch) {
    return null
  }
  const slugMatch = cleaned.match(/^슬러그:\s*(.+)$/m)
  const categoryMatch = cleaned.match(/^카테고리:\s*(.+)$/m)

  return {
    title: titleMatch[1].trim(),
    content: contentMatch[1].trim(),
    slug: slugMatch?.[1].trim() ?? '',
    category: categoryMatch?.[1].trim() ?? '',
    entities: [],
  }
}

function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '')
}

function normalizeCategory(raw: string): string {
  const category = findCategory(raw)
  return category?.slug ?? DEFAULT_CATEGORY
}

async function ensureUniqueSlug(base: string): Promise<string> {
  const safeBase = base || `article-${Date.now().toString(36)}`
  let candidate = safeBase
  for (let suffix = 2; suffix < 100; suffix++) {
    const { data } = await supabase
      .from('articles')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle()
    if (!data) return candidate
    candidate = `${safeBase}-${suffix}`
  }
  return `${safeBase}-${Date.now().toString(36)}`
}

function validateKoreanArticle(article: GeneratedArticle): string | null {
  const combined = `${article.title}\n${article.content}`
  const koreanChars = combined.match(/[가-힣]/g)?.length ?? 0
  const latinChars = combined.match(/[a-z]/gi)?.length ?? 0
  const letterCount = koreanChars + latinChars
  const koreanRatio = letterCount > 0 ? koreanChars / letterCount : 0

  if (article.title.length < 8 || article.content.length < 120) {
    return '생성된 기사 제목 또는 본문이 너무 짧습니다.'
  }

  if (koreanRatio < 0.3) {
    return `한국어 비율이 낮습니다. koreanRatio=${koreanRatio.toFixed(2)}`
  }

  const noisePattern = RESPONSE_NOISE_PATTERNS.find((pattern) => pattern.test(combined))
  if (noisePattern) {
    return `원문 페이지 잡음이 포함됐습니다. pattern=${noisePattern.source}`
  }

  return null
}

async function generateKoreanArticle(articles: SourceArticle[], matchedEntities: SimpleEntity[]): Promise<GeneratedArticle> {
  const articlesText = articles
    .map((article, index) => {
      const publishedAt = formatSourceDate(article.publishedAt)
      return [
        `[소스 ${index + 1}]`,
        `매체: ${article.sourceName}`,
        `발행일: ${publishedAt}`,
        `제목: ${article.title}`,
        `URL: ${article.source}`,
        `내용: ${compactSourceText(article.content)}`,
      ].filter(Boolean).join('\n')
    })
    .join('\n\n---\n\n')

  const entityRules = matchedEntities.length > 0
    ? matchedEntities.map(e => `- ${e.name} → ${e.korean_name}`).join('\n')
    : '(매칭된 사전 정의 인물 없음)'

  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  const ollamaModel = process.env.OLLAMA_GENERATE_MODEL || process.env.OLLAMA_MODEL || 'qwen3:14b'
  let lastError = '생성 실패'

  for (let attempt = 1; attempt <= 2; attempt++) {
    const retryGuidance = attempt > 1
      ? `\n[주의]\n이전 응답은 검증에 실패했습니다. 실패 이유: ${lastError}\n형식과 원칙을 엄격히 지켜서 다시 작성하세요.\n`
      : ''

    const userPrompt = `[고유명사 표기 규칙]
아래 목록은 이번 기사에 등장하는 인물들의 지정된 한국어 표기입니다.
${entityRules}

[소스 기사]
${articlesText}${retryGuidance}`

    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        system: SYSTEM_PROMPT_A,
        prompt: userPrompt,
        stream: false,
        think: false,
      }),
    })

    const data = await res.json()
    console.log('Ollama 응답:', JSON.stringify(data).slice(0, 500))

    if (!data.response || typeof data.response !== 'string') {
      lastError = `Ollama 응답 없음: ${JSON.stringify(data).slice(0, 300)}`
      continue
    }

    const generated = parseGeneratedArticle(data.response)
    if (!generated) {
      lastError = 'Ollama 응답을 기사 JSON으로 파싱하지 못했습니다.'
      continue
    }

    console.log('[entities] LLM returned:', generated.entities)

    const validationError = validateKoreanArticle(generated)
    if (!validationError) {
      return generated
    }

    lastError = validationError
    console.warn(`기사 검증 실패 attempt=${attempt}:`, validationError)
  }

  throw new Error(lastError)
}

export type ClusterGenerationResult =
  | { success: true; clusterId: string; article: Record<string, unknown> }
  | { success: false; clusterId: string; error: string }

export async function generateFromCluster(clusterIds: string[]): Promise<ClusterGenerationResult[]> {
  if (!Array.isArray(clusterIds) || clusterIds.length === 0) {
    throw new Error('clusterIds가 필요합니다.')
  }

  const allEntities = loadEntities()
  const results: ClusterGenerationResult[] = []

  for (const clusterId of clusterIds) {
    try {
      const { data: clusterArticles, error: clusterError } = await supabase
        .from('cluster_articles')
        .select('raw_article_id')
        .eq('cluster_id', clusterId)

      if (clusterError) throw clusterError

      const rawArticleIds = ((clusterArticles ?? []) as ClusterArticleRow[])
        .map((clusterArticle) => clusterArticle.raw_article_id)

      if (rawArticleIds.length === 0) {
        throw new Error('클러스터에 연결된 원문 기사가 없습니다.')
      }

      const { data: rawArticles, error: rawError } = await supabase
        .from('raw_articles')
        .select('id, title, content, url, published_at, source_id')
        .in('id', rawArticleIds)

      if (rawError) throw rawError
      if (!rawArticles || rawArticles.length === 0) {
        throw new Error('원문 기사를 찾지 못했습니다.')
      }

      const typedRawArticles = rawArticles as RawArticleRow[]
      const sourceMeta = await fetchSourceMeta(typedRawArticles.map((article) => article.source_id))

      const articlesWithContent = await Promise.all(
        typedRawArticles.map(async (article) => {
          const content = article.content || await fetchArticleContent(article.url)
          const meta = article.source_id !== null ? sourceMeta.get(String(article.source_id)) : undefined
          return {
            title: article.title || '제목 없음',
            content: cleanArticleText(content, 3000),
            source: article.url,
            sourceName: meta?.name ?? '알 수 없는 소스',
            publishedAt: article.published_at,
          }
        })
      )
      const usableArticles = articlesWithContent.filter((article) => article.content.length >= 80)

      if (usableArticles.length === 0) {
        throw new Error('생성에 사용할 수 있는 원문 본문이 없습니다.')
      }

      // 엔티티 매칭
      const fullContentForMatching = usableArticles.map(a => `${a.title}\n${a.content}`).join('\n')
      const matchedEntities = getMatchedEntities(fullContentForMatching, allEntities)

      const rawGenerated = await generateKoreanArticle(usableArticles, matchedEntities)

      const generated = {
        ...rawGenerated,
        title: applyDisplayNameMapping(rawGenerated.title, matchedEntities),
        content: applyDisplayNameMapping(rawGenerated.content, matchedEntities),
      }
      const fallbackMatchedEntities = getMatchedEntities(`${generated.title}\n${generated.content}`, allEntities)
      const entityNames = generated.entities.length > 0
        ? Array.from(new Set(generated.entities))
        : fallbackMatchedEntities.map((e) => e.name)

      const slug = await ensureUniqueSlug(normalizeSlug(generated.slug))
      const category = normalizeCategory(generated.category)
      const content = appendSingleSourceAttribution(generated.content, typedRawArticles, sourceMeta)

      const { data, error } = await supabase
        .from('articles')
        .insert({
          title: generated.title,
          content,
          cluster_id: clusterId,
          published: false,
          slug,
          category,
        })
        .select()
        .single()

      if (error) throw error

      if (entityNames.length > 0 && data?.id) {
        try {
          const { data: dbEntities, error: entError } = await supabase
            .from('entities')
            .select('id, name, korean_name')
            .in('name', entityNames)

          if (entError) {
            console.error('Failed to fetch entities:', entError.message)
          }

          const matchedDbEntities = dbEntities ?? []
          const foundNames = new Set(matchedDbEntities.map((entity) => entity.name))
          const missingNames = entityNames.filter((name) => !foundNames.has(name))

          for (const missingName of missingNames) {
            const { data: aliasEntities, error: aliasError } = await supabase
              .from('entities')
              .select('id, name, korean_name')
              .filter('aliases', 'cs', `{"${missingName.replaceAll('"', '\\"')}"}`)

            if (aliasError) {
              console.error(`Failed to fetch entities by alias (${missingName}):`, aliasError.message)
              continue
            }

            matchedDbEntities.push(...(aliasEntities ?? []))
          }

          const uniqueDbEntities = Array.from(
            new Map(matchedDbEntities.map((entity) => [entity.id, entity])).values()
          )
          const generatedText = `${generated.title}\n${generated.content}`
          const verifiedDbEntities = uniqueDbEntities.filter((entity) =>
            generatedText.includes(entity.korean_name)
          )

          if (verifiedDbEntities.length > 0) {
            const articleEntities = verifiedDbEntities.map((ent) => ({
              article_id: data.id,
              entity_id: ent.id,
            }))

            const { error: relError } = await supabase
              .from('article_entities')
              .upsert(articleEntities, { onConflict: 'article_id,entity_id', ignoreDuplicates: true })

            if (relError) {
              console.error('Failed to insert article_entities:', relError.message)
            }
          }
        } catch (entErr) {
          console.error('Error in article_entities linking:', entErr)
        }
      }

      // 원문 기사 이미지(R2 저장본)를 article_images에 연결 (실패해도 기사 생성에 영향 없음)
      if (data?.id) {
        try {
          const { data: imgRawArticles, error: imgRawError } = await supabase
            .from('raw_articles')
            .select('image_url')
            .in('id', rawArticleIds)
            .not('image_url', 'is', null)

          if (imgRawError) {
            console.error('Failed to fetch raw_articles for images:', imgRawError.message)
          }

          const imageUrls = Array.from(
            new Set(
              ((imgRawArticles ?? []) as { image_url: string | null }[])
                .map((row) => row.image_url)
                .filter((url): url is string => Boolean(url))
            )
          )

          if (imageUrls.length > 0) {
            const { data: images, error: imgError } = await supabase
              .from('images')
              .select('id, public_url')
              .in('source_url', imageUrls)

            if (imgError) {
              console.error('Failed to fetch images:', imgError.message)
            }

            const imageIdByUrl = new Map(
              ((images ?? []) as { id: string; public_url: string }[]).map((img) => [img.public_url, img.id])
            )
            // raw_articles의 image_url 순서를 보존해 첫 번째를 썸네일로 지정
            const orderedImageIds = imageUrls
              .map((url) => imageIdByUrl.get(url))
              .filter((id): id is string => Boolean(id))

            if (orderedImageIds.length > 0) {
              const articleImages = orderedImageIds.map((imageId, index) => ({
                article_id: data.id,
                image_id: imageId,
                position: index,
                is_thumbnail: index === 0,
              }))

              const { error: linkError } = await supabase
                .from('article_images')
                .upsert(articleImages, { onConflict: 'article_id,image_id', ignoreDuplicates: true })

              if (linkError) {
                console.error('Failed to insert article_images:', linkError.message)
              }
            }
          }
        } catch (imgErr) {
          console.error('Error in article_images linking:', imgErr)
        }
      }

      results.push({ success: true, clusterId, article: data })

    } catch (err) {
      results.push({ success: false, clusterId, error: String(err) })
    }
  }

  return results
}
