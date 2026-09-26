"use client";

import { Button } from "@/components/ui/button";

// Next.js app router 慣例：dashboard/page.tsx（或它讀的 loadDashboard）拋出例外時，
// 顯示這個畫面而不是整頁白畫面。error.tsx 必須是 client component。
export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-6xl flex-col items-start gap-3 p-6">
      <h1 className="font-heading text-2xl font-bold text-foreground">總覽看板</h1>
      <p className="text-sm text-[color:var(--danger,#B3261E)]">看板資料讀取失敗，請稍後再試。</p>
      <Button onClick={() => reset()}>重試</Button>
    </main>
  );
}
