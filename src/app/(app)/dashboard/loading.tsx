import { Card, CardContent, CardHeader } from "@/components/ui/card";

// Next.js 在 dashboard/page.tsx 的 async 資料還沒讀完時自動顯示這個骨架畫面
// （app router 的 loading.tsx 慣例），沿用 admin/loading.tsx 同樣的手法。
function SkeletonCard() {
  return (
    <Card>
      <CardHeader>
        <div className="h-5 w-20 animate-pulse rounded bg-muted" />
        <div className="mt-1 h-4 w-32 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="h-5 w-24 animate-pulse rounded bg-muted" />
        <div className="h-8 w-full animate-pulse rounded bg-muted" />
        <div className="h-8 w-full animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

export default function DashboardLoading() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div className="h-8 w-32 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </main>
  );
}
