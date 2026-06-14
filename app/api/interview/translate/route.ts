import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { cleanArticleText, extractArticleText } from '@/lib/article-extraction'
import displayNames from '@/lib/display-names.json'
import { SYSTEM_PROMPT_B } from '@/lib/prompts'
import Anthropic from '@anthropic-ai/sdk'

const displayNameRules = Object.entries(displayNames as Record<string, string>)
  .filter(([en, ko]) => en !== ko)
  .map(([en, ko]) => `- ${en} → ${ko}`)
  .join('\n')

const displayNameReplacements = Object.entries(displayNames as Record<string, string>)
  .filter(([en, ko]) => en !== ko)
  .sort((a, b) => b[0].length - a[0].length)

function applyDisplayNameMapping(text: string): string {
  let result = text
  for (const [en, ko] of displayNameReplacements) {
    result = result.replaceAll(en, ko)
  }
  return result
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

function formatSourceDate(iso: string | null): string {
  if (!iso) {
    return '날짜 불명'
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return '날짜 불명'
  }
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  })
}

function collapseLineBreaksInsideQuotes(text: string): string {
  // 유니코드 곡선 따옴표 \u201C \u201D (모델 실제 출력)
  let result = text.replace(/\u201C([^\u201D]*)\u201D/g, (_, inner) => {
    const fixed = inner.replace(/\n+/g, ' ').replace(/ {2,}/g, ' ').trim()
    return `\u201C${fixed}\u201D`
  })
  // ASCII 따옴표
  result = result.replace(/"([^"]*)"/g, (_, inner) => {
    const fixed = inner.replace(/\n+/g, ' ').replace(/ {2,}/g, ' ').trim()
    return `"${fixed}"`
  })
  return result
}

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API,
})

async function fetchArticleContent(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    const html = await res.text()
    return extractArticleText(html, 20000)
  } catch {
    return ''
  }
}

function cleanInterviewSourceText(text: string): string {
  const PARA_MARKER = '§PARA§'

  const exactNoise = [
    'advertisement', 'advertisements', 'comments', 'leave a comment', 'add comment', 'related articles',
    'read more', 'subscribe', 'newsletter', 'login', 'search', 'share', 'email', 'facebook', 'twitter',
    'reddit', 'pinterest', 'whatsapp', 'telegram', 'tags', 'previous article', 'next article',
    'more from author', 'comments are closed', 'sign up', 'contact us', 'submit music',
    'become a member', 'members login', 'share this article', 'leave a reply',
    '사진 출처', 'photo credit'
  ]

  const ecommercePatterns = [
    /shop secure/i,
    /secure (purchase|shopping|checkout)/i,
    /world'?s largest/i,
    /fast (shipping|delivery)/i,
    /all major brands/i,
    /full (product )?line.?up/i,
    /lowest prices?/i,
    /online store/i,
    /add to (cart|basket)/i,
    /in stock/i,
  ]

  const lines = text.split('\n')
  const processedLines: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    const lower = trimmed.toLowerCase()

    // 빈 줄은 단락 구분 마커로 치환 (이후 \n\n으로 복원)
    if (!lower) {
      processedLines.push(PARA_MARKER)
      continue
    }

    if (exactNoise.includes(lower)) continue

    // 사이트명 제거 (CDM 등)
    if (lower.includes(' - cdm create digital music')) continue

    // 사진 크레딧 제거
    if (/^(photo|image)(graphy)?\s*(credit|by)?:?/i.test(lower)) continue
    if (/^사진\s*출처:?/i.test(lower)) continue
    if (/^photos? courtesy/i.test(lower)) continue
    if (/^pictured?:/i.test(lower)) continue
    if (lower.startsWith('credits:')) continue

    // 태그/카테고리/글쓴이 정보 제거
    if (/^tags?:/i.test(lower) || /^categories?:/i.test(lower)) continue
    if (/^[a-z\s]+ \- [a-z]{3,}\s\d{1,2},\s\d{4}$/i.test(trimmed)) continue
    if (/^by\s+[a-z\s]+$/i.test(trimmed)) continue

    // e-commerce 광고/쇼핑몰 카피 제거
    if (ecommercePatterns.some((pattern) => pattern.test(trimmed))) continue

    // 노이즈 단어가 포함된 짧은 줄 제거
    if (trimmed.length < 50) {
      if (exactNoise.some((noise) => lower.includes(noise))) {
        continue
      }

      const words = trimmed.split(/\s+/)
      if (words.length > 2 && words.length < 10) {
        if (!/[.?!:,]/.test(trimmed)) {
          continue
        }
      }
    }

    processedLines.push(line)
  }

  // 연속된 마커 합치고 선두/말미 마커 제거
  const collapsed: string[] = []
  for (const item of processedLines) {
    if (item === PARA_MARKER) {
      if (collapsed.length === 0) continue
      if (collapsed[collapsed.length - 1] === PARA_MARKER) continue
    }
    collapsed.push(item)
  }
  while (collapsed.length > 0 && collapsed[collapsed.length - 1] === PARA_MARKER) {
    collapsed.pop()
  }

  // 마커는 빈 줄로 복원 → join('\n') 결과에서 \n\n로 단락 구분 살아남음
  return collapsed
    .map((item) => (item === PARA_MARKER ? '' : item))
    .join('\n')
}

const SLUG_MAX_LENGTH = 60
function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '')
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

export async function POST(req: NextRequest) {
  const { raw_article_id } = await req.json()

  if (!raw_article_id) {
    return NextResponse.json({ success: false, error: 'raw_article_id가 필요합니다.' }, { status: 400 })
  }

  try {
    const { data: article, error } = await supabase
      .from('raw_articles')
      .select('id, title, content, url, published_at, source_id, image_url')
      .eq('id', raw_article_id)
      .single()

    if (error || !article) {
      throw new Error('원문 기사를 찾을 수 없습니다.')
    }

    let content = article.content || ''

    // 4800자 이상이면 수집 단계에서 잘렸을 가능성이 높음 → 재fetch
    if (!content || content.length >= 4800) {
      const fresh = await fetchArticleContent(article.url)
      if (fresh && fresh.length > content.length) {
        content = fresh
        // DB 업데이트
        await supabase
          .from('raw_articles')
          .update({ content: fresh })
          .eq('id', raw_article_id)
      }
    }

    content = cleanArticleText(content, 20000)
    content = cleanInterviewSourceText(content)

    // 단일 줄바꿈은 공백으로(원문이 줄 단위로 wrap된 경우), 단락 구분용 \n\n은 유지
    content = content
      .replace(/\n{2,}/g, '§PARA§')
      .replace(/\n/g, ' ')
      .replace(/§PARA§/g, '\n\n')
      .trim()

    if (!content || content.length < 500) {
      throw new Error('인터뷰 본문을 추출할 수 없습니다.')
    }

    let sourceName = domainFromUrl(article.url)
    if (article.source_id) {
      const { data: source } = await supabase
        .from('rss_sources')
        .select('name')
        .eq('id', article.source_id)
        .single()
      if (source?.name) {
        sourceName = source.name.trim()
      }
    }

    const publishedAtStr = formatSourceDate(article.published_at)

    const displayNameSection = displayNameRules 
      ? `\n[displayNameRules]\n아래 목록은 이번 요청에서 사용할 수 있는 고유명사 표기 허용 목록입니다.\n${displayNameRules}\n` 
      : ''

    const promptText = `다음 인터뷰 원문을 한국어로 번역하세요.
${displayNameSection}
[원문 정보]
매체: ${sourceName}
발행일: ${publishedAtStr}
제목: ${article.title || '제목 없음'}
URL: ${article.url}

[원문 본문]
${content}
`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: SYSTEM_PROMPT_B,
      messages: [{ role: 'user', content: promptText }],
    })

    const firstBlock = message.content[0]
    if (!firstBlock || firstBlock.type !== 'text') {
      throw new Error('Claude API 응답이 없습니다.')
    }

    let translatedContent = firstBlock.text.trim()
    if (!translatedContent) {
      throw new Error('Claude API 번역 내용이 비어 있습니다.')
    }

    console.log('[interview] 후처리 전 줄바꿈 패턴:',
      translatedContent.slice(0, 500).replace(/\n/g, '↵').replace(/\r/g, '↩'))

    // Step 1: 인용문 안의 줄바꿈을 공백으로 먼저 정리
    translatedContent = collapseLineBreaksInsideQuotes(translatedContent)

    // Step 1.5: 단일 \n만 \n\n으로 올리기 (이미 \n\n인 건 건드리지 않음)
    translatedContent = translatedContent
      .replace(/\n{3,}/g, '\n\n')
      .replace(/(?<!\n)\n(?!\n)/g, '\n\n')

    // Step 2: 단락 구분(\n\n)은 유지, 단락 내 단일 \n은 공백으로
    translatedContent = translatedContent
      .replace(/\n{2,}/g, '§PARA§')
      .replace(/\n/g, ' ')
      .replace(/§PARA§/g, '\n\n')
      .trim()

    // 모델이 첫 줄에 출력한 한국어 제목 파싱
    const contentLines = translatedContent.split('\n\n')
    let generatedTitle = ''
    if (contentLines.length > 1) {
      const firstChunk = contentLines[0].trim()
      if (firstChunk.length <= 150 && !firstChunk.startsWith('\u201C') && !firstChunk.startsWith('"')) {
        generatedTitle = firstChunk.replace(/^[#*_\s]+|[#*_\s]+$/g, '').trim()
        translatedContent = contentLines.slice(1).join('\n\n').trim()
      }
    }

    const title = generatedTitle
      ? applyDisplayNameMapping(generatedTitle)
      : article.title
        ? applyDisplayNameMapping(article.title)
        : '제목 없음'

    const slugBase = article.title
      ? normalizeSlug(article.title)
      : 'interview'

    const slug = await ensureUniqueSlug(slugBase)

    const cleanUrl = cleanSourceUrl(article.url)
    const disclaimer = `\n\n*이 인터뷰는 ${publishedAtStr}에 ${sourceName}에 게시된 원문을 한국어로 번역한 것입니다. [원문 보기](${cleanUrl})*`
    
    translatedContent = applyDisplayNameMapping(translatedContent).trimEnd() + '\n\n' + disclaimer.trimStart()

    const { data: savedArticle, error: insertError } = await supabase
      .from('articles')
      .insert({
        title,
        content: translatedContent,
        slug,
        category: '인터뷰',
        genre: 'edm',
        published: false,
        image_url: article.image_url
      })
      .select()
      .single()

    if (insertError) throw insertError

    return NextResponse.json({ success: true, article: savedArticle })

  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
