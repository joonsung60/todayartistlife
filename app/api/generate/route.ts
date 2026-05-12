import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { cleanArticleText, extractArticleText } from '@/lib/article-extraction'
import { SYSTEM_PROMPT_A } from '@/lib/prompts'

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
}

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
  /\b(login|search|members login|become a member|advertise|submit music|contact us)\b/i,
  /\b(share|email|facebook|twitter|reddit|pinterest|whatsapp|telegram)\b/i,
  /\b(previous article|next article|related articles|more from author|comments are closed)\b/i,
  /\b(sign up|subscribe|tags|just released|claim this offer|read more)\b/i,
]

function compactSourceText(text: string): string {
  return cleanArticleText(text, 2500).replace(/\s+/g, ' ').trim()
}

async function fetchSourceMeta(sourceIds: Array<string | number | null>): Promise<Map<string, SourceMeta>> {
  const ids = Array.from(new Set(sourceIds.filter((id): id is string | number => id !== null)))
  const sourceMeta = new Map<string, SourceMeta>()

  if (ids.length === 0) {
    return sourceMeta
  }

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

function formatSourceDate(iso: string | null): string | null {
  if (!iso) {
    return null
  }

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  })
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
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<GeneratedArticle>
      if (typeof parsed.title === 'string' && typeof parsed.content === 'string') {
        return {
          title: parsed.title.trim(),
          content: parsed.content.trim(),
        }
      }
    } catch {
      // Fall through to the legacy parser for imperfect model output.
    }
  }

  const titleMatch = response.match(/^제목:\s*(.+)$/m)
  const contentMatch = response.match(/^내용:\s*([\s\S]+)$/m)
  if (!titleMatch || !contentMatch) {
    return null
  }

  return {
    title: titleMatch[1].trim(),
    content: contentMatch[1].trim(),
  }
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

  if (koreanRatio < 0.45) {
    return `한국어 비율이 낮습니다. koreanRatio=${koreanRatio.toFixed(2)}`
  }

  const noisePattern = RESPONSE_NOISE_PATTERNS.find((pattern) => pattern.test(combined))
  if (noisePattern) {
    return `원문 페이지 잡음이 포함됐습니다. pattern=${noisePattern.source}`
  }

  return null
}

async function generateKoreanArticle(articles: SourceArticle[]): Promise<GeneratedArticle> {
  const articlesText = articles
    .map((article, index) => {
      const publishedAt = formatSourceDate(article.publishedAt)
      return [
        `[소스 ${index + 1}]`,
        `매체: ${article.sourceName}`,
        publishedAt ? `발행일: ${publishedAt}` : null,
        `제목: ${article.title}`,
        `URL: ${article.source}`,
        `내용: ${compactSourceText(article.content)}`,
      ].filter(Boolean).join('\n')
    })
    .join('\n\n---\n\n')

  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  let lastError = '생성 실패'

  for (let attempt = 1; attempt <= 2; attempt++) {
    const retryGuidance = attempt > 1
      ? `\n이전 응답은 검증에 실패했습니다. 실패 이유: ${lastError}\n이번에는 영어 원문과 사이트 메뉴 문구를 절대 포함하지 말고, 자연스러운 한국어 기사만 작성하세요.\n`
      : ''

    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3:14b',
        system: SYSTEM_PROMPT_A,
        prompt: `아래 소스들을 참고해 한국어 뉴스 기사를 새로 작성하세요.

중요:
- 소스 내용을 그대로 복사하지 마세요.
- 영어 원문 문장, 사이트 메뉴, 태그, 공유 버튼, 관련 기사 목록은 출력하지 마세요.
- 모든 소스를 동등하게 참고하되, 어느 한 소스의 표현이나 판단을 검증 없이 확대하지 마세요.
- 영어 곡명, 아티스트명, 앨범명, 레이블명은 영어 원문 그대로 표기하고 한글 발음 표기를 붙이지 마세요.
- 단, 한국어명이 실제 한국에서 널리 쓰이는 아티스트나 행사명은 자연스럽게 한국어명을 병기할 수 있습니다. 임의로 한국어명을 만들어 붙이지 마세요.
- '오늘', '어제', '최근', '며칠 전' 같은 상대적 날짜 표현을 쓰지 마세요.
- 날짜가 필요하면 소스의 발행일처럼 구체적인 년/월/일만 쓰고, 날짜가 불명확하면 생략하세요.
- 출력은 반드시 JSON 객체 하나만 허용됩니다.
- JSON 키는 "title", "content" 두 개만 사용하세요.
- title과 content 값은 한국어 기사체로 작성하세요.
${retryGuidance}

${articlesText}

응답 예:
{"title":"한국어 기사 제목","content":"한국어 기사 본문"}`,
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

    const validationError = validateKoreanArticle(generated)
    if (!validationError) {
      return generated
    }

    lastError = validationError
    console.warn(`기사 검증 실패 attempt=${attempt}:`, validationError)
  }

  throw new Error(lastError)
}

export async function POST(req: NextRequest) {
  const { clusterIds } = await req.json() as { clusterIds?: string[] }

  if (!Array.isArray(clusterIds) || clusterIds.length === 0) {
    return NextResponse.json({ success: false, error: 'clusterIds가 필요합니다.' }, { status: 400 })
  }

  const results = []

  for (const clusterId of clusterIds) {
    try {
      // 클러스터에 연결된 원문 기사들 가져오기
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

      // 본문이 없는 기사는 스크래핑
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

      // 한국어 종합 기사 생성
      const { title, content } = await generateKoreanArticle(usableArticles)

      // articles 테이블에 저장
      const { data, error } = await supabase
        .from('articles')
        .insert({
          title,
          content,
          cluster_id: clusterId,
          published: false,
        })
        .select()
        .single()

      if (error) throw error

      results.push({ success: true, clusterId, article: data })

    } catch (err) {
      results.push({ success: false, clusterId, error: String(err) })
    }
  }

  return NextResponse.json({ results })
}
