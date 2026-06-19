import type { ReactNode } from 'react'

export type ArtistProfileData = {
  name: string
  koreanName: string | null
  type: string
  profileImageUrl: string | null
  bio: string | null
  genres: string[]
  activePeriod: string[]
  externalLinks: Record<string, string>
  awards: string[]
  relatedArtists: { name: string; commonTags: string[] }[]
}

// 외부 링크 표시용 메타데이터. key 는 external_links jsonb 의 키와 일치한다.
const LINK_META: Record<string, { label: string; icon: ReactNode }> = {
  spotify: { label: 'Spotify', icon: <PlatformDot className="bg-[#1DB954]" /> },
  apple_music: { label: 'Apple Music', icon: <PlatformDot className="bg-[#FA243C]" /> },
  youtube: { label: 'YouTube', icon: <PlatformDot className="bg-[#FF0000]" /> },
  instagram: { label: 'Instagram', icon: <PlatformDot className="bg-[#E1306C]" /> },
  twitter: { label: 'X (Twitter)', icon: <PlatformDot className="bg-black" /> },
  tiktok: { label: 'TikTok', icon: <PlatformDot className="bg-black" /> },
  facebook: { label: 'Facebook', icon: <PlatformDot className="bg-[#1877F2]" /> },
  soundcloud: { label: 'SoundCloud', icon: <PlatformDot className="bg-[#FF5500]" /> },
  homepage: { label: 'Official', icon: <PlatformDot className="bg-zinc-700" /> },
}

function PlatformDot({ className }: { className: string }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${className}`} aria-hidden />
}

function initial(displayName: string) {
  const trimmed = displayName.trim()
  return trimmed ? Array.from(trimmed)[0].toUpperCase() : '?'
}

export function ArtistProfile({ profile }: { profile: ArtistProfileData }) {
  const displayName = profile.koreanName || profile.name
  const links = Object.entries(profile.externalLinks).filter(
    ([, url]) => typeof url === 'string' && url.length > 0
  )

  return (
    <section className="mb-10">
      <div className="flex flex-col gap-6 border-b-2 border-zinc-900 pb-8 sm:flex-row sm:items-start">
        {/* 프로필 이미지 */}
        {profile.profileImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.profileImageUrl}
            alt={displayName}
            style={{ objectPosition: 'top center' }}
            className="h-32 w-32 flex-shrink-0 rounded-full border border-zinc-200 object-cover sm:h-40 sm:w-40"
          />
        ) : (
          <div className="flex h-32 w-32 flex-shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-zinc-200 sm:h-40 sm:w-40">
            <span className="text-4xl font-black text-zinc-500">{initial(displayName)}</span>
          </div>
        )}

        {/* 기본 정보 */}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            {profile.type}
          </p>
          <h1 className="mt-1 text-3xl font-black leading-tight">{displayName}</h1>
          {profile.koreanName && profile.koreanName !== profile.name && (
            <p className="mt-1 text-sm font-medium text-zinc-500">{profile.name}</p>
          )}

          {profile.activePeriod.length > 0 && (
            <p className="mt-3 text-sm text-zinc-600">
              <span className="font-bold text-zinc-900">활동 시대</span>{' '}
              {profile.activePeriod.join(', ')}
            </p>
          )}

          {profile.genres.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {profile.genres.map((genre) => (
                <li
                  key={genre}
                  className="rounded-full border border-zinc-300 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-700"
                >
                  {genre}
                </li>
              ))}
            </ul>
          )}

          {links.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {links.map(([key, url]) => {
                const meta = LINK_META[key] ?? {
                  label: key,
                  icon: <PlatformDot className="bg-zinc-400" />,
                }
                return (
                  <li key={key}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-bold text-zinc-800 transition-colors hover:border-zinc-900 hover:bg-zinc-900 hover:text-white"
                    >
                      {meta.icon}
                      {meta.label}
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* 바이오 */}
      {profile.bio && (
        <div className="mt-6">
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-zinc-700">
            {profile.bio}
          </p>
        </div>
      )}

      {/* 수상 이력 */}
      {profile.awards.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-zinc-500">
            수상 이력
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700">
            {profile.awards.map((award, i) => (
              <li key={i}>{award}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 관련 아티스트 */}
      {profile.relatedArtists.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-zinc-500">
            관련 아티스트
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {profile.relatedArtists.map((related) => (
              <li
                key={related.name}
                className="rounded-lg border border-zinc-200 p-3 transition-colors hover:border-zinc-900"
              >
                <p className="truncate text-sm font-bold text-zinc-900">{related.name}</p>
                {related.commonTags.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1">
                    {related.commonTags.map((tag) => (
                      <li
                        key={tag}
                        className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600"
                      >
                        {tag}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
