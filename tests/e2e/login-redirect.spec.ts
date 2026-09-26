import { test, expect } from "@playwright/test";

test("沒登入打開首頁，會被帶到登入頁並看到 Google 登入按鈕", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "用學校 Google 帳號登入" })).toBeVisible();
});

// 最終審查 #5：用錯網域的帳號登入會被 /auth/callback 或 requireOk() 導回 /login?error=domain，
// 之前登入頁完全不讀這個參數，使用者只看到登入頁「又出現一次」，不知道發生什麼事。
// 只在 <main> 裡找 role=alert：Next.js 的路由播報器（next-route-announcer）本身也是 role=alert。
test("網域不對被彈回登入頁時，看得到「請用 @g.nccu.edu.tw 學校帳號登入」", async ({ page }) => {
  await page.goto("/login?error=domain");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("請用 @g.nccu.edu.tw 學校帳號登入");
});

test("登入流程失敗（error=auth）時，看得到「登入失敗，請再試一次」", async ({ page }) => {
  await page.goto("/login?error=auth");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("登入失敗，請再試一次");
});

test("沒有 error 參數時，不顯示任何錯誤", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "用學校 Google 帳號登入" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});
