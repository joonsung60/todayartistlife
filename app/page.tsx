import Link from "next/link";
import { loadPublishedArticles } from "@/lib/articles";
import type { ArticleListItem } from "@/lib/articles";

// ── 유틸 ──────────────────────────────────────────────

const CATEGORY_BADGE: Record<string, string> = {
  페스티벌: "bg-orange-500",
  릴리즈: "bg-emerald-600",
  뉴스: "bg-blue-600",
};

function badgeCls(category?: string | null): string {
  return category ? (CATEGORY_BADGE[category] ?? "bg-gray-800") : "bg-gray-800";
}

function articleHref(a: ArticleListItem): string {
  return `/articles/${a.slug ?? a.id}`;
}

// ── 공통 카드 이미지 (배지 + 폴백 포함) ──────────────────

function CardImage({ article }: { article: ArticleListItem }) {
  return (
    <div className="relative aspect-[16/9] overflow-hidden bg-gray-900">
      {article.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={article.imageUrl}
          alt={article.title}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 bg-gray-900 flex items-center justify-center">
          {article.category && (
            <span
              className="text-xs font-bold uppercase tracking-widest text-white/30"
              style={{ fontFamily: "var(--font-display), sans-serif" }}
            >
              {article.category}
            </span>
          )}
        </div>
      )}
      {/* 카테고리 배지 — 좌상단, 사각형 */}
      {article.category && (
        <span
          className={`absolute top-2 left-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white ${badgeCls(article.category)}`}
          style={{ fontFamily: "var(--font-display), sans-serif" }}
        >
          {article.category}
        </span>
      )}
    </div>
  );
}

// ── FEATURED 대형 카드 (좌측) ──────────────────────────

function FeaturedMain({ article }: { article: ArticleListItem }) {
  return (
    <article className="group">
      <Link href={articleHref(article)} className="block">
        <CardImage article={article} />
        <div className="pt-4">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-black leading-tight group-hover:text-blue-600 transition-colors">
            {article.title}
          </h2>
        </div>
      </Link>
    </article>
  );
}

// ── FEATURED 소형 카드 (우측 2x2) ──────────────────────

function FeaturedSmall({ article }: { article: ArticleListItem }) {
  return (
    <article className="group">
      <Link href={articleHref(article)} className="block">
        <CardImage article={article} />
        <div className="pt-3">
          <h3 className="text-sm font-bold leading-snug group-hover:text-blue-600 transition-colors">
            {article.title}
          </h3>
        </div>
      </Link>
    </article>
  );
}

// ── LATEST 카드 (균일 그리드) ──────────────────────────

function LatestCard({ article }: { article: ArticleListItem }) {
  return (
    <article className="group">
      <Link href={articleHref(article)} className="block">
        <CardImage article={article} />
        <div className="pt-3">
          <h3 className="text-base font-bold leading-snug group-hover:text-blue-600 transition-colors">
            {article.title}
          </h3>
        </div>
      </Link>
    </article>
  );
}

// ── 섹션 라벨 ─────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="mb-6 border-b-2 border-black pb-2">
      <h2
        className="border-l-4 border-black pl-3 text-sm font-bold tracking-[0.2em] uppercase"
        style={{ fontFamily: "var(--font-display), sans-serif" }}
      >
        {label}
      </h2>
    </div>
  );
}

// ── 에러 ──────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-6 p-4 border border-red-200 bg-red-50 text-red-700 text-sm">
      기사를 불러오지 못했습니다: {message}
    </div>
  );
}

// ── 페이지 ────────────────────────────────────────────

export default async function Home() {
  // 기존 시그니처 그대로 유지
  const { articles, error } = await loadPublishedArticles({ limit: 20 });

  const [featuredMain, ...featuredRest] = articles.slice(0, 5);
  const latest = articles.slice(5);

  return (
    <div className="max-w-[1280px] mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-8">
      {error && <ErrorBanner message={error} />}

      {/* FEATURED */}
      {featuredMain && (
        <section className="mb-12 md:mb-16">
          <SectionLabel label="FEATURED" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
            <FeaturedMain article={featuredMain} />
            {featuredRest.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
                {featuredRest.map((article) => (
                  <FeaturedSmall key={article.id} article={article} />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* LATEST */}
      {latest.length > 0 && (
        <section>
          <SectionLabel label="LATEST" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
            {latest.map((article) => (
              <LatestCard key={article.id} article={article} />
            ))}
          </div>
        </section>
      )}

      {!featuredMain && !error && (
        <p className="text-sm text-gray-400">아직 발행된 기사가 없습니다.</p>
      )}
    </div>
  );
}
