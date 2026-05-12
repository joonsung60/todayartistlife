import Link from 'next/link'
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ARTICLE_SELECT =
  'id, title, content, published, published_at, created_at, updated_at, cluster_id, slug, category, genre'

export async function generateStaticParams() {
  const { data } = await supabase
    .from('articles')
    .select('id, slug')
    .eq('published', true)
  return (data ?? []).map((row: { id: string; slug: string | null }) => ({
    slug: row.slug ?? row.id,
  }))
}

type ArticleDetail = {
  id: string
  title: string
  content: string
  published: boolean
  published_at: string | null
  created_at: string
  updated_at: string | null
  cluster_id: string | null
  slug: string | null
  category: string | null
  genre: string | null
}

async function loadArticle(key: string): Promise<{
  data: ArticleDetail | null
  errorMessage: string | null
}> {
  const bySlug = await supabase
    .from('articles')
    .select(ARTICLE_SELECT)
    .eq('slug', key)
    .maybeSingle()
  if (bySlug.error) return { data: null, errorMessage: bySlug.error.message }
  if (bySlug.data) return { data: bySlug.data as ArticleDetail, errorMessage: null }

  if (UUID_PATTERN.test(key)) {
    const byId = await supabase
      .from('articles')
      .select(ARTICLE_SELECT)
      .eq('id', key)
      .maybeSingle()
    if (byId.error) return { data: null, errorMessage: byId.error.message }
    return { data: (byId.data as ArticleDetail | null) ?? null, errorMessage: null }
  }

  return { data: null, errorMessage: null }
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { data, errorMessage } = await loadArticle(slug)

  if (errorMessage) {
    return (
      <div className="min-h-full bg-zinc-50 text-zinc-900">
        <main className="max-w-3xl mx-auto px-6 py-12">
          <BackLink />
          <div className="mt-6 p-4 border border-red-300 bg-red-50 rounded text-red-700 text-sm">
            기사를 불러오지 못했습니다: {errorMessage}
          </div>
        </main>
      </div>
    )
  }

  if (!data) notFound()

  const article = data
  const showUpdated =
    article.published_at &&
    article.updated_at &&
    article.updated_at !== article.published_at

  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      <main className="max-w-3xl mx-auto px-6 py-12">
        <BackLink />

        <article className="mt-6">
          <div className="flex flex-wrap items-center gap-2 mb-3 text-xs text-zinc-500">
            {article.published_at ? (
              <time>발행 {formatDate(article.published_at)}</time>
            ) : (
              <time>생성 {formatDate(article.created_at)}</time>
            )}
            {showUpdated && article.updated_at && (
              <span className="text-zinc-400">
                · 수정됨 {formatDate(article.updated_at)}
              </span>
            )}
            {!article.published && (
              <span className="px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-600">
                초안
              </span>
            )}
          </div>

          <CategoryBadges category={article.category} genre={article.genre} />

          <h1 className="text-3xl font-bold leading-tight tracking-tight mb-8">
            {article.title}
          </h1>

          <div className="text-base leading-relaxed text-zinc-800 space-y-4">
            {splitArticleBlocks(article.content).map((block, idx) => {
              if (block.type === 'image') {
                return (
                  <figure key={idx} className="my-6">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={block.src}
                      alt={block.alt}
                      className="w-full rounded object-cover"
                    />
                    {block.alt && (
                      <figcaption className="mt-2 text-sm text-zinc-500">
                        {block.alt}
                      </figcaption>
                    )}
                  </figure>
                )
              }

              return <p key={idx}>{block.text}</p>
            })}
          </div>
        </article>
      </main>
    </div>
  )
}

function BackLink() {
  return (
    <Link
      href="/"
      className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
    >
      ← 목록으로
    </Link>
  )
}

function CategoryBadges({
  category,
  genre,
}: {
  category?: string | null
  genre?: string | null
}) {
  if (!category && !genre) return null
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
      {category && (
        <span className="px-2 py-0.5 rounded bg-zinc-900 text-white font-medium">
          {category}
        </span>
      )}
      {genre && (
        <span className="px-2 py-0.5 rounded border border-zinc-300 text-zinc-700">
          {genre}
        </span>
      )}
    </div>
  )
}

type ArticleBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'image'; alt: string; src: string }

function splitArticleBlocks(text: string): ArticleBlock[] {
  if (!text?.trim()) return []

  const imagePattern = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g
  const blocks: ArticleBlock[] = []
  let cursor = 0

  for (const match of text.matchAll(imagePattern)) {
    const index = match.index ?? 0
    const before = text.slice(cursor, index)
    blocks.push(...splitKoreanSentences(before).map((sentence) => ({
      type: 'paragraph' as const,
      text: sentence,
    })))
    blocks.push({ type: 'image', alt: match[1].trim(), src: match[2].trim() })
    cursor = index + match[0].length
  }

  blocks.push(...splitKoreanSentences(text.slice(cursor)).map((sentence) => ({
    type: 'paragraph' as const,
    text: sentence,
  })))

  return blocks
}

function splitKoreanSentences(text: string): string[] {
  return text
    .split(/(?<=[다요까네죠][.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
