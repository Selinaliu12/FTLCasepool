import { test, expect } from "@playwright/test";

test("沒登入打開首頁，會被帶到登入頁並看到 Google 登入按鈕", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "用學校 Google 帳號登入" })).toBeVisible();
});
