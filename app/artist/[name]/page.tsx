import fs from 'fs'
import path from 'path'
import { notFound } from 'next/navigation'
import { ArticleList } from '@/components/ArticleList'
import { isUsableImageUrl, loadClusterImageUrl, type ArticleListItem } from '@/lib/articles'
import { supabase } from '@/lib/supabase'

type Entity = {
  id: string
  name: string
  korean_name: string
  type: string
}

type ArticleRow = {
  id: string
  slug: string | null
  title: string
  content: string
  published_at: string | null
  cluster_id: string | null
  image_url: string | null
  category: string | null
  genre: string | null
}

function entitySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function generateStaticParams() {
  let entities: { name: string }[] = []
  
  const artistsPath = path.join(process.cwd(), 'lib/entities/artists.json')
  const celebritiesPath = path.join(process.cwd(), 'lib/entities/celebrities.json')
  
  if (fs.existsSync(artistsPath)) {
    try {
      const data = fs.readFileSync(artistsPath, 'utf8')
      entities = entities.concat(JSON.parse(data))
    } catch (e) {
      console.warn('Failed to parse artists.json', e)
    }
  }
  
  if (fs.existsSync(celebritiesPath)) {
    try {
      const data = fs.readFileSync(celebritiesPath, 'utf8')
      entities = entities.concat(JSON.parse(data))
    } catch (e) {
      console.warn('Failed to parse celebrities.json', e)
    }
  }

  const slugs = Array.from(new Set(entities.map(e => entitySlug(e.name))))

  return slugs.map(slug => ({
    name: slug,
  }))
}

async function loadEntity(slug: string): Promise<Entity | null> {
  const { data, error } = await supabase
    .from('entities')
    .select('id, name, korean_name, type')

  if (error) throw new Error(error.message)

  return ((data ?? []) as Entity[]).find((entity) => entitySlug(entity.name) === slug) ?? null
}

async function loadEntityArticles(entityId: string): Promise<{
  articles: ArticleListItem[]
  error: string | null
}> {
  const { data: relations, error: relationError } = await supabase
    .from('article_entities')
    .select('article_id')
    .eq('entity_id', entityId)

  if (relationError) {
    return { articles: [], error: relationError.message }
  }

  const articleIds = Array.from(new Set(
    ((relations ?? []) as { article_id: string }[]).map((relation) => relation.article_id)
  ))

  if (articleIds.length === 0) {
    return { articles: [], error: null }
  }

  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, title, content, published_at, cluster_id, image_url, category, genre')
    .in('id', articleIds)
    .eq('published', true)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(20)

  if (error) {
    return { articles: [], error: error.message }
  }

  const rows = (data ?? []) as ArticleRow[]
  const articles = await Promise.all(
    rows.map(async (row) => {
      const articleImageUrl = isUsableImageUrl(row.image_url) ? row.image_url : null
      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        content: row.content,
        published_at: row.published_at,
        cluster_id: row.cluster_id,
        article_image_url: articleImageUrl,
        imageUrl: articleImageUrl ?? await loadClusterImageUrl(row.cluster_id),
        category: row.category,
        genre: row.genre,
      }
    })
  )

  return { articles, error: null }
}

export default async function ArtistPage({
  params,
}: {
  params: Promise<{ name: string }>
}) {
  const { name } = await params
  const entity = await loadEntity(name)

  if (!entity) notFound()

  const { articles, error } = await loadEntityArticles(entity.id)

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 border-b-2 border-zinc-900 pb-3">
        <p className="text-sm font-medium text-zinc-500">{entity.type}</p>
        <h1 className="mt-1 text-2xl font-bold">{entity.korean_name}</h1>
      </header>

      <ArticleList
        articles={articles}
        error={error}
        emptyMessage={`${entity.korean_name} 관련 게시 기사가 아직 없습니다.`}
      />
    </div>
  )
}
