"use client";

import { Button } from "@/components/ui/button";

// 作業頁讀取失敗時顯示這個畫面，不是整頁白畫面（同 dashboard/error.tsx）。
export default function AssignmentsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col items-start gap-3 p-6">
      <h1 className="font-heading text-2xl font-bold text-foreground">作業</h1>
      <p className="text-sm text-[color:var(--danger,#B3261E)]">作業資料讀取失敗，請稍後再試。</p>
      <Button onClick={() => reset()}>重試</Button>
    </main>
  );
}
