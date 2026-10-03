// 作業頁資料還沒讀完時的骨架畫面（同 dashboard/loading.tsx）。
export default function AssignmentsLoading() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div className="h-8 w-24 animate-pulse rounded bg-muted" />
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="h-40 w-full animate-pulse rounded-[var(--r-sm,12px)] bg-muted" />
      ))}
    </main>
  );
}
