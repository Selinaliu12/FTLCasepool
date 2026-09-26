import { Card, CardContent, CardHeader } from "@/components/ui/card";

// Next.js 在 admin/page.tsx 的 async 資料還沒讀完時自動顯示這個骨架畫面
// （app router 的 loading.tsx 慣例），六個區塊對應 page.tsx 的六張 Card。
function SkeletonCard() {
  return (
    <Card>
      <CardHeader>
        <div className="h-5 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-1 h-4 w-64 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
        <div className="h-8 w-full animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

export default function AdminLoading() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div className="h-8 w-32 animate-pulse rounded bg-muted" />
      {Array.from({ length: 6 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </main>
  );
}
