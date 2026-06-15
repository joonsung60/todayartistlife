import { supabase } from '@/lib/supabase'
import {
  matchesCategory,
  normalizeTaxonomySlug,
} from '@/lib/taxonomy'

export type ArticleListItem = {
  id: string
  slug: string | null
  title: string
  content: string
  published_at: string | null
  cluster_id: string | null
  article_image_url: string | null
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
  image_url: string | null
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
    .select('id, slug, title, content, published_at, cluster_id, image_url, category, genre')
    .eq('published', true)
    .order('published_at', { ascending: false })
    .limit(200)

  if (error) {
    return { articles: [], error: error.message }
  }

  const rows = ((data ?? []) as ArticleRow[])
    .filter((row) => !options.category || matchesCategory(row.category, options.category))
    .slice(0, limit)

  const imageByCluster = await loadImagesByCluster(rows)

  const articles: ArticleListItem[] = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    content: row.content,
    published_at: row.published_at,
    cluster_id: row.cluster_id,
    article_image_url: isUsableImageUrl(row.image_url) ? row.image_url : null,
    imageUrl: isUsableImageUrl(row.image_url)
      ? row.image_url
      : row.cluster_id
        ? imageByCluster.get(row.cluster_id) ?? null
        : null,
    category: row.category,
    genre: row.genre,
  }))

  return { articles, error: null }
}

// 현재 기사와 같은 엔티티를 공유하는 published 기사(최신순). 없으면 최신 기사로 폴백.
export async function loadRelatedArticles(
  articleId: string,
  options: { limit?: number } = {}
): Promise<{ articles: ArticleListItem[]; error: string | null }> {
  const limit = options.limit ?? 4

  // 현재 기사의 엔티티 id
  const { data: ownRelations } = await supabase
    .from('article_entities')
    .select('entity_id')
    .eq('article_id', articleId)

  const entityIds = Array.from(
    new Set(((ownRelations ?? []) as { entity_id: string }[]).map((row) => row.entity_id))
  )

  let candidateIds: string[] = []

  if (entityIds.length > 0) {
    const { data: sharedRelations } = await supabase
      .from('article_entities')
      .select('article_id')
      .in('entity_id', entityIds)

    candidateIds = Array.from(
      new Set(
        ((sharedRelations ?? []) as { article_id: string }[])
          .map((row) => row.article_id)
          .filter((id) => id !== articleId)
      )
    )
  }

  let rows: ArticleRow[] = []

  if (candidateIds.length > 0) {
    const { data, error } = await supabase
      .from('articles')
      .select('id, slug, title, content, published_at, cluster_id, image_url, category, genre')
      .in('id', candidateIds)
      .eq('published', true)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(limit)

    if (error) {
      return { articles: [], error: error.message }
    }
    rows = (data ?? []) as ArticleRow[]
  }

  // 엔티티 매칭 기사가 없으면 최신 기사로 폴백 (현재 기사 제외)
  if (rows.length === 0) {
    const { data, error } = await supabase
      .from('articles')
      .select('id, slug, title, content, published_at, cluster_id, image_url, category, genre')
      .eq('published', true)
      .neq('id', articleId)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(limit)

    if (error) {
      return { articles: [], error: error.message }
    }
    rows = (data ?? []) as ArticleRow[]
  }

  const imageByCluster = await loadImagesByCluster(rows)

  const articles: ArticleListItem[] = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    content: row.content,
    published_at: row.published_at,
    cluster_id: row.cluster_id,
    article_image_url: isUsableImageUrl(row.image_url) ? row.image_url : null,
    imageUrl: isUsableImageUrl(row.image_url)
      ? row.image_url
      : row.cluster_id
        ? imageByCluster.get(row.cluster_id) ?? null
        : null,
    category: row.category,
    genre: row.genre,
  }))

  return { articles, error: null }
}

export async function loadKpopArticles(
  options: { limit?: number } = {}
): Promise<{ articles: ArticleListItem[]; error: string | null }> {
  const limit = options.limit ?? 50

  // is_korean = true 인 아티스트 엔티티
  const { data: entityData, error: entityError } = await supabase
    .from('entities')
    .select('id')
    .eq('is_korean', true)

  if (entityError) {
    return { articles: [], error: entityError.message }
  }

  const entityIds = ((entityData ?? []) as { id: string }[]).map((row) => row.id)
  if (entityIds.length === 0) {
    return { articles: [], error: null }
  }

  // 해당 엔티티와 연관된 기사 id
  const { data: relationData, error: relationError } = await supabase
    .from('article_entities')
    .select('article_id')
    .in('entity_id', entityIds)

  if (relationError) {
    return { articles: [], error: relationError.message }
  }

  const articleIds = Array.from(
    new Set(((relationData ?? []) as { article_id: string }[]).map((row) => row.article_id))
  )
  if (articleIds.length === 0) {
    return { articles: [], error: null }
  }

  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, title, content, published_at, cluster_id, image_url, category, genre')
    .in('id', articleIds)
    .eq('published', true)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) {
    return { articles: [], error: error.message }
  }

  const rows = (data ?? []) as ArticleRow[]
  const imageByCluster = await loadImagesByCluster(rows)

  const articles: ArticleListItem[] = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    content: row.content,
    published_at: row.published_at,
    cluster_id: row.cluster_id,
    article_image_url: isUsableImageUrl(row.image_url) ? row.image_url : null,
    imageUrl: isUsableImageUrl(row.image_url)
      ? row.image_url
      : row.cluster_id
        ? imageByCluster.get(row.cluster_id) ?? null
        : null,
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

export async function loadClusterImageUrl(clusterId: string | null): Promise<string | null> {
  if (!clusterId) return null

  const { data: caData } = await supabase
    .from('cluster_articles')
    .select('raw_article_id')
    .eq('cluster_id', clusterId)

  const rawIds = ((caData ?? []) as { raw_article_id: string }[])
    .map((row) => row.raw_article_id)
    .filter(Boolean)
  if (rawIds.length === 0) return null

  const { data: rawData } = await supabase
    .from('raw_articles')
    .select('image_url')
    .in('id', rawIds)
    .not('image_url', 'is', null)

  return firstUsableImageUrl((rawData ?? []) as { image_url: string | null }[])
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
    if (isUsableImageUrl(row.image_url)) imageByRawId.set(row.id, row.image_url)
  }

  for (const ca of clusterArticles) {
    if (imageByCluster.has(ca.cluster_id)) continue
    const img = imageByRawId.get(ca.raw_article_id)
    if (img) imageByCluster.set(ca.cluster_id, img)
  }

  return imageByCluster
}

function firstUsableImageUrl(rows: { image_url: string | null }[]): string | null {
  return rows.find((row) => isUsableImageUrl(row.image_url))?.image_url ?? null
}

export function isUsableImageUrl(url: string | null): url is string {
  if (!url) return false
  if (!/^https?:\/\//i.test(url)) return false

  const lower = url.toLowerCase()
  // static.ra.co often rejects hotlinked image requests with Cloudflare 403.
  if (lower.includes('static.ra.co/images/')) return false

  return true
}
