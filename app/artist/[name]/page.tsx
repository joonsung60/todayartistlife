import fs from 'fs'
import path from 'path'
import { notFound } from 'next/navigation'
import { ArticleList } from '@/components/ArticleList'
import { ArtistProfile, type ArtistProfileData } from './ArtistProfile'
import { isUsableImageUrl, loadClusterImageUrl, type ArticleListItem } from '@/lib/articles'
import { supabase } from '@/lib/supabase'

type RelatedArtist = {
  name: string
  common_tags?: string[] | null
}

type Entity = {
  id: string
  name: string
  korean_name: string
  type: string
  profile_image_url: string | null
  bio: string | null
  bio_source: string | null
  genres: string[] | null
  active_period: string[] | null
  related_artists: RelatedArtist[] | null
  external_links: Record<string, string> | null
  awards: unknown
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

const ENTITY_SELECT =
  'id, name, korean_name, type, profile_image_url, bio, bio_source, genres, active_period, related_artists, external_links, awards'

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
    .select(ENTITY_SELECT)

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

// awards 컬럼은 jsonb 라 형태가 유동적이다. 화면에 표시 가능한 문자열 배열로 정규화한다.
function normalizeAwards(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === 'string' ? item : typeof item?.name === 'string' ? item.name : ''
      )
      .filter((item): item is string => item.length > 0)
  }
  return []
}

function toProfile(entity: Entity): ArtistProfileData {
  return {
    name: entity.name,
    koreanName: entity.korean_name,
    type: entity.type,
    profileImageUrl: entity.profile_image_url,
    bio: entity.bio,
    genres: (entity.genres ?? []).filter(Boolean),
    activePeriod: (entity.active_period ?? []).filter(Boolean),
    externalLinks: entity.external_links ?? {},
    awards: normalizeAwards(entity.awards),
    relatedArtists: (entity.related_artists ?? [])
      .filter((r) => r && typeof r.name === 'string')
      .map((r) => ({ name: r.name, commonTags: (r.common_tags ?? []).filter(Boolean) })),
  }
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
      <ArtistProfile profile={toProfile(entity)} />

      <section>
        <h2 className="mb-4 border-b-2 border-zinc-900 pb-2 text-lg font-bold">
          관련 기사
        </h2>
        <ArticleList
          articles={articles}
          error={error}
          emptyMessage={`${entity.korean_name} 관련 게시 기사가 아직 없습니다.`}
        />
      </section>
    </div>
  )
}
