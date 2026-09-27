"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "cn";

// Final review minor 6：各路由 loading.tsx／error.tsx 共用的骨架與錯誤畫面，沿用
// dashboard/loading.tsx、dashboard/error.tsx 的樣式。
function SkeletonCard() {
  return (
    <Card>
      <CardHeader>
        <div className="h-5 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-1 h-4 w-40 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="h-8 w-full animate-pulse rounded bg-muted" />
        <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

export function PageSkeleton({ cards = 3, wide = false }: { cards?: number; wide?: boolean }) {
  return (
    <main aria-busy="true" className={cn("mx-auto flex flex-col gap-6 p-6", wide ? "max-w-3xl" : "max-w-2xl")}>
      <span className="sr-only">載入中…</span>
      <div className="h-8 w-40 animate-pulse rounded bg-muted" />
      {Array.from({ length: cards }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </main>
  );
}

export function PageError({ title, reset, wide = false }: { title: string; reset: () => void; wide?: boolean }) {
  return (
    <main className={cn("mx-auto flex flex-col items-start gap-3 p-6", wide ? "max-w-3xl" : "max-w-2xl")}>
      <h1 className="font-heading text-2xl font-bold text-foreground">{title}</h1>
      <p className="text-sm text-[color:var(--danger,#B3261E)]">資料讀取失敗，請稍後再試。</p>
      <Button onClick={() => reset()}>重試</Button>
    </main>
  );
}
