import { ArticleList, PopularList } from '@/components/ArticleList'
import { loadPublishedArticles } from '@/lib/articles'

export default async function Home() {
  const { articles, error } = await loadPublishedArticles({ limit: 20 })
  const popular = articles.slice(0, 5)

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-10">
        <section>
          <h2 className="text-xl font-bold mb-5 pb-2 border-b-2 border-zinc-900">
            최신 기사
          </h2>
          <ArticleList
            articles={articles}
            error={error}
            emptyMessage="아직 발행된 기사가 없습니다."
          />
        </section>

        <aside className="lg:sticky lg:top-6 self-start">
          <h2 className="text-lg font-bold mb-4 pb-2 border-b-2 border-zinc-900">
            인기 기사
          </h2>
          <PopularList articles={popular} />
        </aside>
      </div>
    </div>
  )
}
