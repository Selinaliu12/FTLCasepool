import { test, expect } from "@playwright/test";

// 定時喚醒（GitHub Actions 每 3 天打一次）用：不用登入、真的查一次資料庫，
// 讓 Supabase 免費專案不會因為一週沒活動而暫停。只回 ok，不回任何資料。
test("沒登入也能打 /api/health，回 200 與 { ok: true }", async ({ request }) => {
  const res = await request.get("/api/health", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(res.headers()["cache-control"]).toContain("no-store");
});
