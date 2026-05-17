import type { Metadata } from "next";
import Link from "next/link";
import { Barlow_Condensed, Noto_Sans_KR } from "next/font/google";
import { CATEGORY_NAV, RELEASE_GENRE_NAV } from "@/lib/taxonomy";
import "./globals.css";

const barlowCondensed = Barlow_Condensed({
  weight: ["700", "900"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const notoSansKR = Noto_Sans_KR({
  weight: ["400", "500", "700", "900"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "EDM Star News",
  description: "한국어 EDM 뉴스 종합",
  verification: {
    google: "dBSG9LfIn9zB1n1Hu13rgD_RqKS5GeEknVNf9a2PlMg",
  },
};

const NAV_ITEMS = [
  { label: "홈", href: "/" },
  ...CATEGORY_NAV.map((item) => ({
    label: item.label,
    href: `/category/${item.slug}`,
  })),
];

const showAdminLink = process.env.BUILD_STATIC !== "1";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${barlowCondensed.variable} ${notoSansKR.variable} h-full antialiased`}
    >
      <body
        className="min-h-full flex flex-col bg-white text-[#0A0A0A]"
        style={{ fontFamily: "var(--font-body), sans-serif" }}
      >
        {/* ── 헤더 ── */}
        <header className="border-b border-gray-200 bg-white sticky top-0 z-50">
          <div className="max-w-[1280px] mx-auto px-4 md:px-6 lg:px-8">
            {/* 상단 바 — 로고 + 슬로건 + 우측 액션 */}
            <div className="flex items-center justify-between gap-4 py-3 md:py-4">
              <div className="min-w-0">
                <Link
                  href="/"
                  className="block text-2xl md:text-3xl font-black leading-none tracking-tight uppercase hover:text-[#0052D4] transition-colors"
                  style={{ fontFamily: "var(--font-display), sans-serif" }}
                >
                  EDM Star News
                </Link>
                <p className="mt-1 text-xs font-medium text-gray-500">
                  EDM의 순간을 기록합니다
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/search"
                  aria-label="검색"
                  title="검색"
                  className="flex h-8 w-8 items-center justify-center border border-gray-200 text-gray-500 transition-colors hover:border-gray-400 hover:text-black"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                </Link>
                {showAdminLink && (
                  <Link
                    href="/admin"
                    className="text-[11px] font-bold uppercase tracking-widest text-gray-400 hover:text-black transition-colors border border-gray-200 hover:border-gray-400 px-2.5 py-1"
                    style={{ fontFamily: "var(--font-display), sans-serif" }}
                  >
                    Admin
                  </Link>
                )}
              </div>
            </div>

            {/* 하단 바 — 카테고리 네비 */}
            <nav className="relative flex items-center border-t border-gray-100 -mx-4 px-4 md:mx-0 md:px-0 md:border-t-0">
              <div className="flex min-w-0 flex-1 items-center overflow-x-auto [&::-webkit-scrollbar]:hidden">
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="shrink-0 px-3 py-2.5 text-sm font-medium text-gray-600 hover:text-black whitespace-nowrap border-b-2 border-transparent hover:border-black transition-colors"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>

              <details className="group relative shrink-0">
                <summary className="genre-nav-summary list-none cursor-pointer px-3 py-2.5 text-sm font-medium text-gray-600 hover:text-black whitespace-nowrap border-b-2 border-transparent group-open:border-black transition-colors">
                  릴리즈 ▾
                </summary>
                <div className="absolute right-0 top-full z-20 min-w-40 border border-gray-200 bg-white py-1.5 shadow-lg">
                  {RELEASE_GENRE_NAV.map((item) => (
                    <Link
                      key={item.slug}
                      href={`/genre/${item.slug}/`}
                      className="block px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-black transition-colors"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </details>
            </nav>
          </div>
        </header>

        {/* ── 메인 ── */}
        <main className="flex-1">{children}</main>

        {/* ── 푸터 ── */}
        <footer className="border-t border-gray-200 bg-[#F7F7F7] mt-16">
          <div className="max-w-[1280px] mx-auto px-4 md:px-6 lg:px-8 py-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-5 text-sm text-gray-500">
                <Link href="/about" className="hover:text-black transition-colors">
                  소개
                </Link>
                <a
                  href="mailto:gwakjoonsung@gmail.com"
                  className="hover:text-black transition-colors"
                >
                  문의
                </a>
              </div>
              <div className="text-xs text-gray-400">
                © 2026 EDM Star News · 발행인 곽준성
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
