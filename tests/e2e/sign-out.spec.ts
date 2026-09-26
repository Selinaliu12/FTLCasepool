import { test, expect, type Page } from "@playwright/test";

// 最終審查 #6：之前整個網站沒有登出、也沒有導覽列，登入之後只能手動清 cookie。

async function loginAndPassWelcome(page: Page, email: string, landing: RegExp) {
  await page.goto(`/test-login?email=${email}`);
  await Promise.race([
    page.waitForURL(landing),
    page.getByRole("button", { name: "我已了解" }).waitFor({ state: "visible" }),
  ]);
  if (await page.getByRole("button", { name: "我已了解" }).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "我已了解" }).click();
  }
  await expect(page).toHaveURL(landing);
}

test("專案生：頁首有姓名、「我的組別」；按登出回到登入頁，再打開首頁也會被擋回登入頁", async ({ page }) => {
  await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);

  const header = page.getByRole("banner");
  await expect(header.getByText("甲一")).toBeVisible();
  await expect(header.getByRole("link", { name: "我的組別" })).toBeVisible();
  await expect(header.getByRole("link", { name: "總覽看板" })).toHaveCount(0);

  await header.getByRole("button", { name: "登出" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("管理員：頁首有「學期設定」與「總覽看板」", async ({ page }) => {
  await loginAndPassWelcome(page, "admin@g.nccu.edu.tw", /\/admin$/);
  const header = page.getByRole("banner");
  await expect(header.getByText("admin@g.nccu.edu.tw")).toBeVisible();
  await expect(header.getByRole("link", { name: "學期設定" })).toBeVisible();
  await expect(header.getByRole("link", { name: "總覽看板" })).toBeVisible();
});

test("其他幹部：頁首只有「總覽看板」", async ({ page }) => {
  await loginAndPassWelcome(page, "off@g.nccu.edu.tw", /\/dashboard$/);
  const header = page.getByRole("banner");
  await expect(header.getByText("其他幹部")).toBeVisible();
  await expect(header.getByRole("link", { name: "總覽看板" })).toBeVisible();
  await expect(header.getByRole("link", { name: "學期設定" })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "我的組別" })).toHaveCount(0);
});

test("不在名單上的人：/not-in-roster 可以登出", async ({ page }) => {
  await page.goto("/test-login?email=stranger@g.nccu.edu.tw");
  await expect(page.getByText("你不在本學期名單中，請聯絡幹部")).toBeVisible();
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("/welcome 也可以登出", async ({ page }) => {
  // pm@ 在全域種子裡存在，但沒有任何 e2e 測試替它按過「我已了解」（global-setup 每輪都會 resetDb），
  // 所以登入後一定會被 (app)/layout.tsx 導到 /welcome。
  await page.goto("/test-login?email=pm@g.nccu.edu.tw");
  await expect(page).toHaveURL(/\/welcome$/);
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
