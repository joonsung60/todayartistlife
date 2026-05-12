import { supabase } from '@/lib/supabase'
import {
  matchesCategory,
  matchesGenre,
  normalizeTaxonomySlug,
} from '@/lib/taxonomy'

export type ArticleListItem = {
  id: string
  slug: string | null
  title: string
  content: string
  published_at: string | null
  cluster_id: string | null
  imageUrl: string | null
  category: string | null
  genre: string | null
}

type ArticleRow = {
  id: string
  slug: string | null
  title: string
  content: string
  published_at: string | null
  cluster_id: string | null
  category: string | null
  genre: string | null
}

type ClusterArticleRow = {
  cluster_id: string
  raw_article_id: string
}

type RawArticleImageRow = {
  id: string
  image_url: string | null
}

type LoadArticlesOptions = {
  limit?: number
  category?: string
  genre?: string
}

export async function loadPublishedArticles(
  options: LoadArticlesOptions = {}
): Promise<{ articles: ArticleListItem[]; error: string | null }> {
  const limit = options.limit ?? 50
  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, title, content, published_at, cluster_id, category, genre')
    .eq('published', true)
    .order('published_at', { ascending: false })
    .limit(200)

  if (error) {
    return { articles: [], error: error.message }
  }

  const rows = ((data ?? []) as ArticleRow[])
    .filter((row) => !options.category || matchesCategory(row.category, options.category))
    .filter((row) => !options.genre || matchesGenre(row.genre, options.genre))
    .slice(0, limit)

  const imageByCluster = await loadImagesByCluster(rows)

  const articles: ArticleListItem[] = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    content: row.content,
    published_at: row.published_at,
    cluster_id: row.cluster_id,
    imageUrl: row.cluster_id ? imageByCluster.get(row.cluster_id) ?? null : null,
    category: row.category,
    genre: row.genre,
  }))

  return { articles, error: null }
}

export async function loadTaxonomyParams(): Promise<{
  categories: string[]
  genres: string[]
}> {
  const { data } = await supabase
    .from('articles')
    .select('category, genre')
    .eq('published', true)

  const categories = new Set<string>()
  const genres = new Set<string>()

  for (const row of (data ?? []) as Pick<ArticleRow, 'category' | 'genre'>[]) {
    const category = normalizeTaxonomySlug(row.category)
    const genre = normalizeTaxonomySlug(row.genre)
    if (category) categories.add(category)
    if (genre) genres.add(genre)
  }

  return {
    categories: Array.from(categories),
    genres: Array.from(genres),
  }
}

async function loadImagesByCluster(rows: ArticleRow[]): Promise<Map<string, string>> {
  const clusterIds = Array.from(
    new Set(rows.map((row) => row.cluster_id).filter((id): id is string => Boolean(id)))
  )
  const imageByCluster = new Map<string, string>()

  if (clusterIds.length === 0) return imageByCluster

  const { data: caData } = await supabase
    .from('cluster_articles')
    .select('cluster_id, raw_article_id')
    .in('cluster_id', clusterIds)

  const clusterArticles = (caData ?? []) as ClusterArticleRow[]
  const rawIds = Array.from(
    new Set(clusterArticles.map((ca) => ca.raw_article_id).filter(Boolean))
  )

  if (rawIds.length === 0) return imageByCluster

  const { data: rawData } = await supabase
    .from('raw_articles')
    .select('id, image_url')
    .in('id', rawIds)
    .not('image_url', 'is', null)

  const imageByRawId = new Map<string, string>()
  for (const row of (rawData ?? []) as RawArticleImageRow[]) {
    if (row.image_url) imageByRawId.set(row.id, row.image_url)
  }

  for (const ca of clusterArticles) {
    if (imageByCluster.has(ca.cluster_id)) continue
    const img = imageByRawId.get(ca.raw_article_id)
    if (img) imageByCluster.set(ca.cluster_id, img)
  }

  return imageByCluster
}
