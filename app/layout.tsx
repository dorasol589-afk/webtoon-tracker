import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
  title: "웹툰 댓글수 추적",
  description: "네이버 웹툰 무료회차 댓글수를 매일 추적하는 대시보드",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-4">
            <Link href="/" className="text-lg font-semibold">
              📈 웹툰 댓글수 추적
            </Link>
            <nav className="flex gap-4 text-sm text-neutral-500">
              <Link href="/" className="hover:text-neutral-900">
                홈
              </Link>
              <Link href="/titles" className="hover:text-neutral-900">
                전체 작품 리스트
              </Link>
              <Link href="/studios" className="hover:text-neutral-900">
                제작사
              </Link>
              <Link href="/recruit" className="hover:text-neutral-900">
                채용공고
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
        <footer className="border-t border-neutral-200 py-4 text-center text-xs text-neutral-400">
          데이터 출처: 네이버 웹툰 (비공식) · 매일 자동 수집
        </footer>
      </body>
    </html>
  );
}
