import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type ArticleListItem = {
  id: string
  title: string
  content: string
  published: boolean
  published_at: string | null
  created_at: string
}

export default async function Home() {
  const { data, error } = await supabase
    .from('articles')
    .select('id, title, content, published, published_at, created_at')
    .order('created_at', { ascending: false })

  const articles = (data ?? []) as ArticleListItem[]

  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      <main className="max-w-3xl mx-auto px-6 py-12">
        <header className="flex items-baseline justify-between mb-10 pb-6 border-b border-zinc-200">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">EDM Star News</h1>
            <p className="text-sm text-zinc-500 mt-1">한국어 EDM 뉴스 종합</p>
          </div>
          <Link
            href="/admin"
            className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            어드민 →
          </Link>
        </header>

        {error && (
          <div className="p-4 border border-red-300 bg-red-50 rounded text-red-700 text-sm">
            기사를 불러오지 못했습니다: {error.message}
          </div>
        )}

        {!error && articles.length === 0 && (
          <p className="text-zinc-500">아직 생성된 기사가 없습니다.</p>
        )}

        <ul className="divide-y divide-zinc-200">
          {articles.map((article) => (
            <li key={article.id} className="py-6">
              <Link href={`/articles/${article.id}`} className="block group">
                <div className="flex items-center gap-2 mb-2 text-xs text-zinc-500">
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
                <h2 className="text-xl font-semibold leading-snug group-hover:underline">
                  {article.title}
                </h2>
                <p className="mt-2 text-sm text-zinc-600 line-clamp-2">
                  {article.content}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
