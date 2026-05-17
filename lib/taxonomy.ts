export type CategoryNavItem = {
  slug: string
  label: string
  aliases: string[]
}

export type ReleaseGenreNavItem = {
  slug: string
  label: string
  aliases: string[]
}

export const CATEGORY_NAV: CategoryNavItem[] = [
  { slug: 'festival', label: '페스티벌', aliases: ['festival', 'festivals', 'event', 'events', 'residency', 'residencies', '페스티벌', '행사', '레지던시'] },
  { slug: 'release', label: '릴리즈', aliases: ['release', 'releases', '릴리즈', '신보'] },
  { slug: 'news', label: '뉴스', aliases: ['news', '뉴스'] },
]

export const RELEASE_GENRE_NAV: ReleaseGenreNavItem[] = [
  { slug: 'house', label: 'House', aliases: ['house', '하우스'] },
  { slug: 'techno', label: 'Techno', aliases: ['techno', '테크노'] },
  {
    slug: 'edm',
    label: 'EDM',
    aliases: [
      'edm',
      'electronic dance music',
      'electronic',
      'dance',
      'trance',
      '트랜스',
      'drum and bass',
      'drum & bass',
      'drum-and-bass',
      'dnb',
      'd&b',
      'dubstep',
      '덥스텝',
      'ambient',
      '앰비언트',
    ],
  },
]

export function normalizeTaxonomySlug(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function matchesAliases(value: string | null | undefined, aliases: string[]): boolean {
  const normalized = normalizeTaxonomySlug(value)
  return aliases.some((alias) => normalizeTaxonomySlug(alias) === normalized)
}

export function findCategory(slug: string): CategoryNavItem | undefined {
  const normalized = normalizeTaxonomySlug(slug)
  return CATEGORY_NAV.find((item) =>
    item.slug === normalized || matchesAliases(normalized, item.aliases)
  )
}

export function findGenre(slug: string): ReleaseGenreNavItem | undefined {
  const normalized = normalizeTaxonomySlug(slug)
  return RELEASE_GENRE_NAV.find((item) =>
    item.slug === normalized || matchesAliases(normalized, item.aliases)
  )
}

export function matchesCategory(value: string | null | undefined, slug: string): boolean {
  const category = findCategory(slug)
  if (category) return matchesAliases(value, category.aliases)
  return normalizeTaxonomySlug(value) === normalizeTaxonomySlug(slug)
}

export function matchesGenre(value: string | null | undefined, slug: string): boolean {
  const genre = findGenre(slug)
  if (genre) return matchesAliases(value, genre.aliases)
  return normalizeTaxonomySlug(value) === normalizeTaxonomySlug(slug)
}

export function categoryLabel(slug: string): string {
  return findCategory(slug)?.label ?? slug
}

export function genreLabel(slug: string): string {
  return findGenre(slug)?.label ?? slug
}
