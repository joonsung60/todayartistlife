// 기사 slug 생성 공통 유틸.
// app/api/generate, app/api/interview/translate,
// app/api/image-sources/[id]/generate, lib/jobs/generate-from-cluster
// 네 곳에 중복돼 있던 로직을 이 파일로 통합한다.
//
// ensureUniqueSlug(DB 중복 회피)는 각 라우트의 supabase 클라이언트에
// 의존하므로 호출부에 남겨두고, 순수 문자열 가공 로직만 여기서 제공한다.

export const SLUG_MAX_LENGTH = 60

// 임의 문자열을 소문자 + 하이픈 기반 slug 형태로 정규화한다.
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// maxLength 초과 시 단어 중간이 아니라 마지막 하이픈(-) 위치에서 자른다.
// maxLength 안에 하이픈이 없으면(단일 장문 토큰) 어쩔 수 없이 하드 컷한다.
export function limitSlugLength(slug: string, maxLength = SLUG_MAX_LENGTH): string {
  if (slug.length <= maxLength) {
    return slug.replace(/-+$/, '')
  }

  const truncated = slug.slice(0, maxLength)
  const lastHyphen = truncated.lastIndexOf('-')
  const cut = lastHyphen > 0 ? truncated.slice(0, lastHyphen) : truncated
  return cut.replace(/-+$/, '')
}

// raw slug 를 정규화하고 최대 길이 제약을 적용한다.
// primary 가 비면 fallback 으로 대체한다.
export function normalizeSlug(raw: string, fallback = ''): string {
  const primary = slugify(raw)
  if (primary) {
    return limitSlugLength(primary)
  }

  return limitSlugLength(slugify(fallback))
}
