import { createClient } from "@supabase/supabase-js";
import { ArtistDirectory, type ArtistEntity } from "./ArtistDirectory";

function createSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}

async function loadArtists(): Promise<{
  artists: ArtistEntity[];
  error: string | null;
}> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("entities")
    .select("name, korean_name, profile_image_url")
    .eq("type", "artist")
    .order("korean_name", { ascending: true, nullsFirst: false });

  if (error) {
    return { artists: [], error: error.message };
  }

  return {
    artists: ((data ?? []) as ArtistEntity[]).sort((a, b) =>
      (a.korean_name || a.name).localeCompare(b.korean_name || b.name, "ko")
    ),
    error: null,
  };
}

export default async function ArtistCategoryPage() {
  const { artists, error } = await loadArtists();

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-6 md:py-12 lg:px-8">
      <header className="mb-8 border-b-2 border-black pb-4">
        <p
          className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500"
          style={{ fontFamily: "var(--font-display), sans-serif" }}
        >
          Artist
        </p>
        <h1 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">
          아티스트
        </h1>
      </header>

      {error ? (
        <p className="border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          아티스트를 불러오지 못했습니다. {error}
        </p>
      ) : (
        <ArtistDirectory artists={artists} />
      )}
    </div>
  );
}
