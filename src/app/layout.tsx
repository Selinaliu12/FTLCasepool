import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FTL 競賽池",
  description: "政大金融科技創新實驗室（FTL）競賽池管理工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router layout.tsx is the root <head>, not a pages/_document.js page; this loads sitewide, not per-page. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Huninn:wght@400;700&family=Outfit:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+TC:wght@400;700&display=swap"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
