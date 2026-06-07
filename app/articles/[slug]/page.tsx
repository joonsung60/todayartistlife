import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { isUsableImageUrl, loadClusterImageUrl } from "@/lib/articles";

// ── 원본 유지 — 데이터/유틸 ───────────────────────────

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARTICLE_SELECT =
  "id, title, content, published, published_at, created_at, updated_at, cluster_id, image_url, slug, category, genre";

export async function generateStaticParams() {
  const { data } = await supabase
    .from("articles")
    .select("id, slug")
    .eq("published", true);
  return (data ?? []).map((row: { id: string; slug: string | null }) => ({
    slug: row.slug ?? row.id,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await loadArticle(slug);

  if (!data) {
    return {
      title: "기사 없음 | EDM Star News",
      description: "한국어 EDM 뉴스 종합",
    };
  }

  const description = createMetaDescription(data.content);
  const imageUrl = isUsableImageUrl(data.image_url)
    ? data.image_url
    : (await loadClusterImageUrl(data.cluster_id)) ??
      extractFirstMarkdownImage(data.content);

  return {
    title: `${data.title} | EDM Star News`,
    description,
    openGraph: {
      title: data.title,
      description,
      type: "article",
      publishedTime: data.published_at ?? data.created_at,
      modifiedTime: data.updated_at ?? undefined,
      images: imageUrl ? [{ url: imageUrl }] : undefined,
    },
  };
}

type ArticleDetail = {
  id: string;
  title: string;
  content: string;
  published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string | null;
  cluster_id: string | null;
  image_url: string | null;
  slug: string | null;
  category: string | null;
  genre: string | null;
};

async function loadArticle(key: string): Promise<{
  data: ArticleDetail | null;
  errorMessage: string | null;
}> {
  const bySlug = await supabase
    .from("articles")
    .select(ARTICLE_SELECT)
    .eq("slug", key)
    .maybeSingle();
  if (bySlug.error) return { data: null, errorMessage: bySlug.error.message };
  if (bySlug.data)
    return { data: bySlug.data as ArticleDetail, errorMessage: null };

  if (UUID_PATTERN.test(key)) {
    const byId = await supabase
      .from("articles")
      .select(ARTICLE_SELECT)
      .eq("id", key)
      .maybeSingle();
    if (byId.error) return { data: null, errorMessage: byId.error.message };
    return {
      data: (byId.data as ArticleDetail | null) ?? null,
      errorMessage: null,
    };
  }

  return { data: null, errorMessage: null };
}

// ── 아티스트/셀럽 태그 ────────────────────────────────

type ArticleEntity = {
  name: string;
  korean_name: string;
  type: string;
};

async function loadArticleEntities(articleId: string): Promise<ArticleEntity[]> {
  const { data } = await supabase
    .from("article_entities")
    .select("entity:entities(name, korean_name, type)")
    .eq("article_id", articleId);

  // to-one FK 임베드는 런타임에서 단일 객체로 반환되지만 select-string 추론은 배열로 잡으므로 unknown 경유 캐스트
  return ((data ?? []) as unknown as { entity: ArticleEntity | null }[])
    .map((row) => row.entity)
    .filter((e): e is ArticleEntity => Boolean(e));
}

// ── 기사 연결 이미지 (article_images → images) ─────────

type ArticleImage = {
  public_url: string;
  alt_text: string | null;
  is_thumbnail: boolean;
};

async function loadArticleImages(articleId: string): Promise<ArticleImage[]> {
  const { data } = await supabase
    .from("article_images")
    .select("is_thumbnail, image:images(public_url, alt_text)")
    .eq("article_id", articleId)
    .order("position", { ascending: true });

  // to-one FK 임베드는 런타임에서 단일 객체지만 select-string 추론은 배열로 잡으므로 unknown 경유 캐스트
  return ((data ?? []) as unknown as {
    is_thumbnail: boolean | null;
    image: { public_url: string; alt_text: string | null } | null;
  }[])
    .map((row) =>
      row.image
        ? {
            public_url: row.image.public_url,
            alt_text: row.image.alt_text,
            is_thumbnail: Boolean(row.is_thumbnail),
          }
        : null
    )
    .filter((img): img is ArticleImage => Boolean(img));
}

// name을 영문 소문자 + 공백→하이픈으로 변환해 /artist/[name] 경로 생성
function artistHref(name: string): string {
  return `/artist/${name.trim().toLowerCase().replace(/\s+/g, "-")}`;
}

// 아래 헬퍼들은 원본에서 변경 없음
type ArticleBlock =
  | { type: "paragraph"; text: string }
  | { type: "image"; alt: string; src: string };

function splitArticleBlocks(
  text: string,
  leadingImageUrl?: string | null
): ArticleBlock[] {
  if (!text?.trim()) return [];

  const imagePattern = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
  const blocks: ArticleBlock[] = [];
  const normalizedLeadingImageUrl = leadingImageUrl?.trim();

  if (
    normalizedLeadingImageUrl &&
    !text.includes(normalizedLeadingImageUrl)
  ) {
    blocks.push({ type: "image", alt: "", src: normalizedLeadingImageUrl });
  }

  let cursor = 0;
  for (const match of text.matchAll(imagePattern)) {
    const index = match.index ?? 0;
    const before = text.slice(cursor, index);
    blocks.push(
      ...before.split('\n\n').map((s) => s.trim()).filter(Boolean).map((sentence) => ({
        type: "paragraph" as const,
        text: sentence,
      }))
    );
    blocks.push({
      type: "image",
      alt: match[1].trim(),
      src: match[2].trim(),
    });
    cursor = index + match[0].length;
  }

  blocks.push(
    ...text.slice(cursor).split('\n\n').map((s) => s.trim()).filter(Boolean).map((sentence) => ({
      type: "paragraph" as const,
      text: sentence,
    }))
  );

  return blocks;
}

function createMetaDescription(content: string): string {
  const normalized = content
    .replace(/!\[[^\]]*\]\(https?:\/\/[^)\s]+\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= 155) return normalized || "한국어 EDM 뉴스 종합";
  return `${normalized.slice(0, 152).replace(/\s+\S*$/, "")}...`;
}

function extractFirstMarkdownImage(content: string): string | null {
  const match = content.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/);
  return match?.[1] ?? null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ── 카테고리 배지 색상 ────────────────────────────────

const CATEGORY_BADGE: Record<string, string> = {
  페스티벌: "bg-orange-500",
  릴리즈: "bg-emerald-600",
  뉴스: "bg-blue-600",
};

function badgeCls(category?: string | null): string {
  return category ? (CATEGORY_BADGE[category] ?? "bg-gray-800") : "bg-gray-800";
}

// ── 페이지 ────────────────────────────────────────────

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { data, errorMessage } = await loadArticle(slug);

  if (errorMessage) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
        <BackLink />
        <div className="mt-6 p-4 border border-red-200 bg-red-50 text-red-700 text-sm">
          기사를 불러오지 못했습니다: {errorMessage}
        </div>
      </div>
    );
  }

  if (!data) notFound();

  if (data.slug && slug !== data.slug) {
    permanentRedirect(`/articles/${data.slug}/`);
  }

  const article = data;
  const entities = await loadArticleEntities(article.id);
  const articleImages = await loadArticleImages(article.id);

  const thumbnailImage =
    articleImages.find((img) => img.is_thumbnail) ?? null;
  const fallbackImageUrl = isUsableImageUrl(article.image_url)
    ? article.image_url
    : (await loadClusterImageUrl(article.cluster_id)) ??
      extractFirstMarkdownImage(article.content);
  // article_images 썸네일을 우선 hero로 사용하고, 없으면 기존 폴백 로직
  const heroImageUrl = thumbnailImage?.public_url ?? fallbackImageUrl;

  // 하단 갤러리: 썸네일과 본문에 이미 박힌 이미지를 제외한 나머지
  const galleryImages = articleImages.filter(
    (img) =>
      img !== thumbnailImage &&
      img.public_url !== heroImageUrl &&
      !article.content.includes(img.public_url)
  );

  const articleBlocks = splitArticleBlocks(article.content, heroImageUrl);

  const showUpdated =
    article.published_at &&
    article.updated_at &&
    article.updated_at !== article.published_at;

  return (
    <div className="max-w-[1280px] mx-auto px-4 md:px-6 lg:px-8 py-8 md:py-12">
      <BackLink />

      <article className="mt-6 max-w-[720px]">
        {/* 날짜 + 초안 뱃지 */}
        <div className="flex flex-wrap items-center gap-2 mb-4 text-xs text-gray-500">
          {article.published_at ? (
            <time>발행 {formatDate(article.published_at)}</time>
          ) : (
            <time>생성 {formatDate(article.created_at)}</time>
          )}
          {showUpdated && article.updated_at && (
            <span className="text-gray-400">
              · 수정됨 {formatDate(article.updated_at)}
            </span>
          )}
          {!article.published && (
            <span className="px-1.5 py-0.5 bg-gray-200 text-gray-600 text-[11px] font-medium">
              초안
            </span>
          )}
        </div>

        {/* 카테고리 + 장르 배지 */}
        {(article.category || article.genre) && (
          <div className="flex flex-wrap items-center gap-1.5 mb-4">
            {article.category && (
              <span
                className={`inline-block px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white ${badgeCls(article.category)}`}
                style={{ fontFamily: "var(--font-display), sans-serif" }}
              >
                {article.category}
              </span>
            )}
            {article.genre && (
              <span
                className="inline-block px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider border border-gray-300 text-gray-600"
                style={{ fontFamily: "var(--font-display), sans-serif" }}
              >
                {article.genre}
              </span>
            )}
          </div>
        )}

        {/* 제목 */}
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-black leading-tight tracking-tight mb-4">
          {article.title}
        </h1>

        {/* 아티스트/셀럽 태그 */}
        {entities.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-6">
            {entities.map((entity) => {
              const isArtist = entity.type === "artist";
              return (
                <Link
                  key={entity.name}
                  href={artistHref(entity.name)}
                  className={
                    isArtist
                      ? "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium bg-black text-white hover:opacity-70 transition-opacity"
                      : "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium border border-gray-800 text-gray-800 hover:bg-gray-800 hover:text-white transition-colors"
                  }
                >
                  {entity.korean_name}
                </Link>
              );
            })}
          </div>
        )}

        {/* 발행인 구분선 */}
        <div className="mb-8 pb-4 border-b border-gray-200 text-sm">
          <span className="text-gray-500">기사 · 편집</span>
          <span className="ml-2 text-gray-800 font-medium">곽준성</span>
        </div>

        {/* 본문 블록 */}
        <div className="text-[17px] leading-[1.9] text-[#0A0A0A] space-y-5">
          {articleBlocks.map((block, idx) => {
            if (block.type === "image") {
              return (
                <figure key={idx} className="my-8 overflow-hidden bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={block.src}
                    alt={block.alt}
                    className="w-full h-auto object-cover"
                  />
                  {block.alt && (
                    <figcaption className="mt-2 text-sm text-gray-500 px-1">
                      {block.alt}
                    </figcaption>
                  )}
                </figure>
              );
            }
            return <p key={idx}>{block.text}</p>;
          })}
        </div>

        {/* 관련 이미지 갤러리 */}
        {galleryImages.length > 0 && (
          <section className="mt-12 pt-8 border-t border-gray-200">
            <h2
              className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4"
              style={{ fontFamily: "var(--font-display), sans-serif" }}
            >
              관련 이미지
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {galleryImages.map((img, idx) => (
                <figure key={idx} className="overflow-hidden bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.public_url}
                    alt={img.alt_text ?? ""}
                    className="w-full h-full object-cover aspect-square"
                  />
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* 하단 */}
        <div className="mt-12 pt-8 border-t border-gray-200">
          <BackLink />
        </div>
      </article>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="text-sm text-gray-500 hover:text-black transition-colors"
    >
      ← 목록으로
    </Link>
  );
}
