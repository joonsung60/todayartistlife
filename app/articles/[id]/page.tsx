import Link from 'next/link'
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type ArticleDetail = {
  id: string
  title: string
  content: string
  published: boolean
  published_at: string | null
  created_at: string
  cluster_id: string | null
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const { data, error } = await supabase
    .from('articles')
    .select('id, title, content, published, published_at, created_at, cluster_id')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    return (
      <div className="min-h-full bg-zinc-50 text-zinc-900">
        <main className="max-w-3xl mx-auto px-6 py-12">
          <BackLink />
          <div className="mt-6 p-4 border border-red-300 bg-red-50 rounded text-red-700 text-sm">
            기사를 불러오지 못했습니다: {error.message}
          </div>
        </main>
      </div>
    )
  }

  if (!data) notFound()

  const article = data as ArticleDetail

  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      <main className="max-w-3xl mx-auto px-6 py-12">
        <BackLink />

        <article className="mt-6">
          <div className="flex items-center gap-2 mb-3 text-xs text-zinc-500">
            {article.published_at ? (
              <time>발행 {formatDate(article.published_at)}</time>
            ) : (
              <time>생성 {formatDate(article.created_at)}</time>
            )}
            {!article.published && (
              <span className="px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-600">
                초안
              </span>
            )}
          </div>

          <h1 className="text-3xl font-bold leading-tight tracking-tight mb-8">
            {article.title}
          </h1>

          <div className="text-base leading-relaxed text-zinc-800 space-y-4">
            {splitKoreanSentences(article.content).map((sentence, idx) => (
              <p key={idx}>{sentence}</p>
            ))}
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

function splitKoreanSentences(text: string): string[] {
  if (!text?.trim()) return []
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
