export type CategoryNavItem = {
  slug: string
  label: string
  aliases: string[]
}

export type GenreNavItem = {
  slug: string
  label: string
  aliases: string[]
}

export const CATEGORY_NAV: CategoryNavItem[] = [
  { slug: 'festival', label: '페스티벌', aliases: ['festival', 'festivals', '페스티벌'] },
  { slug: 'artist', label: '아티스트', aliases: ['artist', 'artists', '아티스트'] },
  { slug: 'release', label: '릴리즈', aliases: ['release', 'releases', '릴리즈', '신보'] },
  { slug: 'news', label: '뉴스', aliases: ['news', '뉴스'] },
  { slug: 'interview', label: '인터뷰', aliases: ['interview', 'interviews', '인터뷰'] },
]

export const GENRE_NAV: GenreNavItem[] = [
  { slug: 'house', label: 'House', aliases: ['house', '하우스'] },
  { slug: 'techno', label: 'Techno', aliases: ['techno', '테크노'] },
  { slug: 'trance', label: 'Trance', aliases: ['trance', '트랜스'] },
  { slug: 'drum-and-bass', label: 'Drum & Bass', aliases: ['drum and bass', 'drum & bass', 'drum-and-bass', 'dnb', 'd&b'] },
  { slug: 'dubstep', label: 'Dubstep', aliases: ['dubstep', '덥스텝'] },
  { slug: 'ambient', label: 'Ambient', aliases: ['ambient', '앰비언트'] },
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

export function findGenre(slug: string): GenreNavItem | undefined {
  const normalized = normalizeTaxonomySlug(slug)
  return GENRE_NAV.find((item) =>
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
