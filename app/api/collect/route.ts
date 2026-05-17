import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { extractArticleText, extractArticleTitle, extractEmbedUrl, extractImageUrl, isUrlLikeTitle, titleFromUrl } from '@/lib/article-extraction'
import Parser from 'rss-parser'

const parser = new Parser()
const RSS_TIMEOUT_MS = 12000
const REQUEST_HEADERS = {
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  'User-Agent': 'Mozilla/5.0 EDM Star News RSS Collector',
}

type RssSource = {
  id: string
  name: string
  url: string
}

type CollectFailure = {
  source: string
  url: string
  error: string
}

function parsePublishedAt(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }

  const normalized = value
    .replace(/\bBST\b/g, '+0100')
    .replace(/\bGMT\b/g, '+0000')
    .replace(/\bUTC\b/g, '+0000')
  const date = new Date(normalized)

  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function fetchFeed(url: string) {
  const res = await fetch(url, {
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(RSS_TIMEOUT_MS),
  })
  const text = await res.text()

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 120).replace(/\s+/g, ' ')}`)
  }

  return parser.parseString(text)
}

async function fetchArticleContent(url: string): Promise<{ content: string; imageUrl: string | null; title: string | null; embedUrl: string | null }> {
  try {
    const res = await fetch(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(10000) })
    const html = await res.text()

    const title = extractArticleTitle(html, url)
    const imageUrl = extractImageUrl(html)
    const content = extractArticleText(html, 5000)
    const embedUrl = extractEmbedUrl(html)

    return { content, imageUrl, title, embedUrl }
  } catch {
    return { content: '', imageUrl: null, title: titleFromUrl(url), embedUrl: null }
  }
}

// RSS 자동 수집
async function collectFromRSS(): Promise<{ collected: number; failures: CollectFailure[] }> {
  const { data: sources } = await supabase
    .from('rss_sources')
    .select('*')
    .eq('is_active', true)

  if (!sources) {
    console.log('소스 없음')
    return { collected: 0, failures: [] }
  }

  console.log(`소스 ${sources.length}개 발견`)
  let collected = 0
  const failures: CollectFailure[] = []

  for (const source of sources as RssSource[]) {
    try {
      console.log(`파싱 시도: ${source.name} - ${source.url}`)
      const feed = await fetchFeed(source.url)
      console.log(`파싱 성공: ${source.name} - ${feed.items.length}개 아이템`)

      for (const item of feed.items.slice(0, 10)) {
        if (!item.link) continue

        const { data: existing } = await supabase
          .from('raw_articles')
          .select('id')
          .eq('url', item.link)
          .single()

        if (existing) continue

        const { content, imageUrl, title: extractedTitle, embedUrl } = await fetchArticleContent(item.link)
        const feedTitle = typeof item.title === 'string' ? item.title.trim() : ''
        const title = feedTitle && !isUrlLikeTitle(feedTitle)
          ? feedTitle
          : extractedTitle ?? titleFromUrl(item.link) ?? '제목 없음'

        await supabase.from('raw_articles').insert({
          source_id: source.id,
          title,
          content,
          url: item.link,
          image_url: imageUrl,
          embed_url: embedUrl,
          author: item.creator || null,
          published_at: parsePublishedAt(item.pubDate || item.isoDate),
        })

        collected++
      }

      await supabase
        .from('rss_sources')
        .update({ last_fetched_at: new Date().toISOString() })
        .eq('id', source.id)

    } catch (err) {
      console.error(`RSS 실패: ${source.name}`, err)
      failures.push({ source: source.name, url: source.url, error: String(err) })
    }
  }

  return { collected, failures }
}

// URL 직접 추가
async function collectFromUrls(urls: string[]): Promise<number> {
  let collected = 0

  for (const url of urls) {
    try {
      const { data: existing } = await supabase
        .from('raw_articles')
        .select('id')
        .eq('url', url)
        .single()

      if (existing) continue

      const { content, imageUrl, title, embedUrl } = await fetchArticleContent(url)

      await supabase.from('raw_articles').insert({
        source_id: null,
        title: title ?? titleFromUrl(url) ?? '제목 없음',
        content,
        url,
        image_url: imageUrl,
        embed_url: embedUrl,
        published_at: new Date().toISOString(),
      })

      collected++
    } catch (err) {
      console.error(`URL 추가 실패: ${url}`, err)
    }
  }

  return collected
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { urls } = body

    console.log('수집 시작:', urls ? `URL ${urls.length}개` : 'RSS 모드')

    const result = urls && urls.length > 0
      ? { collected: await collectFromUrls(urls), failures: [] }
      : await collectFromRSS()

    console.log('수집 완료:', result.collected)
    return NextResponse.json({ success: true, collected: result.collected, failures: result.failures })
  } catch (err) {
    console.error('collect API 에러:', err)
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
