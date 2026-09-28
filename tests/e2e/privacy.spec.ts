import { test, expect } from "@playwright/test";

// Google OAuth 同意畫面要切成正式版，必須提供一個不用登入就能打開的隱私權政策網址。
test("沒登入也能打開隱私權說明，看得到聯絡信箱", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "隱私權說明" })).toBeVisible();
  await expect(page.getByRole("link", { name: "nccufintechlab@gmail.com" })).toHaveAttribute(
    "href",
    "mailto:nccufintechlab@gmail.com",
  );
});

test("登入頁有連到隱私權說明", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "隱私權說明" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
});

test("隱私權說明在手機寬度不會出現橫向捲動", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/privacy");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
