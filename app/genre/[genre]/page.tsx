import { notFound } from 'next/navigation'
import { ArticleList } from '@/components/ArticleList'
import { loadPublishedArticles } from '@/lib/articles'
import { RELEASE_GENRE_NAV, findGenre, genreLabel } from '@/lib/taxonomy'

export async function generateStaticParams() {
  const slugs = new Set([
    ...RELEASE_GENRE_NAV.map((item) => item.slug),
  ])

  return Array.from(slugs).map((genre) => ({ genre }))
}

export default async function GenrePage({
  params,
}: {
  params: Promise<{ genre: string }>
}) {
  const { genre } = await params
  const known = findGenre(genre)
  const label = genreLabel(genre)
  const { articles, error } = await loadPublishedArticles({
    genre,
    limit: 50,
  })

  if (!known) notFound()

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <header className="mb-6 border-b-2 border-zinc-900 pb-3">
        <p className="text-sm font-medium text-zinc-500">장르</p>
        <h1 className="mt-1 text-2xl font-bold">{label}</h1>
      </header>

      <ArticleList
        articles={articles}
        error={error}
        emptyMessage={`${label} 장르에 게시된 기사가 아직 없습니다.`}
      />
    </div>
  )
}
