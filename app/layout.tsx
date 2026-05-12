import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { CATEGORY_NAV, GENRE_NAV } from "@/lib/taxonomy";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white">
          <div className="max-w-6xl mx-auto px-6">
            <div className="flex items-center justify-between py-4">
              <Link
                href="/"
                className="text-2xl font-extrabold tracking-tight"
              >
                EDM Star News
              </Link>
              {showAdminLink && (
                <Link
                  href="/admin"
                  className="text-xs text-zinc-500 hover:text-zinc-900 transition-colors"
                >
                  어드민
                </Link>
              )}
            </div>
            <nav className="flex flex-wrap gap-1 sm:gap-3 text-sm font-medium">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="px-3 py-3 text-zinc-600 hover:text-zinc-900 whitespace-nowrap border-b-2 border-transparent hover:border-zinc-900 transition-colors"
                >
                  {item.label}
                </Link>
              ))}
              <div className="relative group flex-shrink-0">
                <button
                  type="button"
                  className="px-3 py-3 text-zinc-600 hover:text-zinc-900 whitespace-nowrap border-b-2 border-transparent group-hover:border-zinc-900 transition-colors"
                >
                  장르별 ▾
                </button>
                <div className="absolute left-0 top-full z-20 hidden min-w-40 rounded border border-zinc-200 bg-white py-2 shadow-lg group-hover:block">
                  {GENRE_NAV.map((item) => (
                    <Link
                      key={item.slug}
                      href={`/genre/${item.slug}`}
                      className="block px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
