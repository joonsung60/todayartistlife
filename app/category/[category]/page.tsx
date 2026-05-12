import { notFound } from 'next/navigation'
import { ArticleList } from '@/components/ArticleList'
import { loadPublishedArticles, loadTaxonomyParams } from '@/lib/articles'
import { CATEGORY_NAV, categoryLabel, findCategory } from '@/lib/taxonomy'

export async function generateStaticParams() {
  const { categories } = await loadTaxonomyParams()
  const slugs = new Set([
    ...CATEGORY_NAV.map((item) => item.slug),
    ...categories,
  ])

  return Array.from(slugs).map((category) => ({ category }))
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>
}) {
  const { category } = await params
  const known = findCategory(category)
  const label = categoryLabel(category)
  const { articles, error } = await loadPublishedArticles({
    category,
    limit: 50,
  })

  if (!known && articles.length === 0) notFound()

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <header className="mb-6 border-b-2 border-zinc-900 pb-3">
        <p className="text-sm font-medium text-zinc-500">카테고리</p>
        <h1 className="mt-1 text-2xl font-bold">{label}</h1>
      </header>

      <ArticleList
        articles={articles}
        error={error}
        emptyMessage={`${label} 카테고리에 게시된 기사가 아직 없습니다.`}
      />
    </div>
  )
}
