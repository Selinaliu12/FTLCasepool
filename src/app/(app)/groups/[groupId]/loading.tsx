import { Card, CardContent, CardHeader } from "@/components/ui/card";

// Next.js 在 page.tsx 的 async 資料還沒讀完時自動顯示這個骨架畫面（app router 的 loading.tsx
// 慣例），沿用 my-group／dashboard 同樣的手法。
function SkeletonCard() {
  return (
    <Card>
      <CardHeader>
        <div className="h-5 w-16 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

export default function GroupDetailLoading() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-6 w-56 animate-pulse rounded bg-muted" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </main>
  );
}
