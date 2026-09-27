"use client";

import { PageError } from "@/components/route-states";

// Final review minor 6：讀取失敗時顯示訊息＋重試，不是整頁白畫面。error.tsx 必須是 client component。
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError title="我的組" reset={reset} />;
}
