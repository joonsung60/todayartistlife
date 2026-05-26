export type CategoryNavItem = {
  slug: string
  label: string
  aliases: string[]
}

export const CATEGORY_NAV: CategoryNavItem[] = [
  { slug: 'news', label: '뉴스', aliases: ['news', '뉴스', '기사'] },
  { slug: 'event', label: '공연', aliases: ['event', 'events', 'festival', 'festivals', '공연', '콘서트', '페스티벌', '내한'] },
  { slug: 'artist', label: '아티스트', aliases: ['artist', 'artists', '아티스트'] },
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

export function matchesCategory(value: string | null | undefined, slug: string): boolean {
  const category = findCategory(slug)
  if (category) return matchesAliases(value, category.aliases)
  return normalizeTaxonomySlug(value) === normalizeTaxonomySlug(slug)
}

export function categoryLabel(slug: string): string {
  return findCategory(slug)?.label ?? slug
}
