"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type ArtistEntity = {
  name: string;
  korean_name: string | null;
  profile_image_url: string | null;
};

function artistSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeSearchText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function initial(displayName: string) {
  const trimmed = displayName.trim();
  return trimmed ? Array.from(trimmed)[0].toUpperCase() : "?";
}

export function ArtistDirectory({ artists }: { artists: ArtistEntity[] }) {
  const [query, setQuery] = useState("");
  const term = normalizeSearchText(query);

  const filteredArtists = useMemo(() => {
    if (!term) return artists;

    return artists.filter((artist) => {
      const koreanName = normalizeSearchText(artist.korean_name);
      const englishName = normalizeSearchText(artist.name);
      return koreanName.includes(term) || englishName.includes(term);
    });
  }, [artists, term]);

  return (
    <div>
      <label className="block">
        <span className="sr-only">아티스트 검색</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="아티스트 이름 검색"
          className="w-full border-2 border-black bg-white px-4 py-3 text-base font-medium outline-none transition-colors placeholder:text-gray-400 focus:border-[#0052D4]"
          autoComplete="off"
        />
      </label>

      <div className="mt-4 flex items-center justify-between border-b border-gray-200 pb-3 text-xs font-bold uppercase tracking-[0.16em] text-gray-500">
        <span>Artists</span>
        <span>{filteredArtists.length}</span>
      </div>

      {filteredArtists.length === 0 ? (
        <p className="py-10 text-sm font-medium text-gray-500">
          검색 결과가 없습니다.
        </p>
      ) : (
        <ul className="mt-8 grid grid-cols-3 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {filteredArtists.map((artist) => {
            const displayName = artist.korean_name || artist.name;

            return (
              <li key={artist.name}>
                <Link
                  href={`/artist/${artistSlug(artist.name)}`}
                  className="group flex flex-col items-center text-center"
                >
                  {artist.profile_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={artist.profile_image_url}
                      alt={displayName}
                      loading="lazy"
                      className="aspect-square w-full max-w-[140px] rounded-full border border-gray-200 object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex aspect-square w-full max-w-[140px] items-center justify-center rounded-full border border-gray-200 bg-gray-200 transition-transform group-hover:scale-105">
                      <span className="text-3xl font-black text-gray-500">
                        {initial(displayName)}
                      </span>
                    </div>
                  )}
                  <h2 className="mt-3 text-sm font-black leading-tight tracking-tight group-hover:text-[#0052D4] sm:text-base">
                    {displayName}
                  </h2>
                  <p
                    className="mt-1 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-400"
                    style={{ fontFamily: "var(--font-display), sans-serif" }}
                  >
                    {artist.name}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
