import { test, expect, type Page } from "@playwright/test";
import { resetDb, seedSemester } from "../integration/helpers";

async function loginAndPassWelcome(page: Page, email: string, waitForUrl: RegExp) {
  await page.goto(`/test-login?email=${email}`);
  await Promise.race([
    page.waitForURL(waitForUrl),
    page.getByRole("button", { name: "我已了解" }).waitFor({ state: "visible" }),
  ]);
  if (await page.getByRole("button", { name: "我已了解" }).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "我已了解" }).click();
  }
  await expect(page).toHaveURL(waitForUrl);
}

// 跟其他 e2e 檔案一樣：自己控制種子資料，結束後還原，讓其他測試檔案不受影響
// （single-worker，全部 e2e 測試共用同一個本機 Supabase）。
test.describe.serial("競賽大廳", () => {
  test.beforeAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("幹部新增→存草稿→發布→學生在大廳看到卡片", async ({ page }) => {
    await loginAndPassWelcome(page, "pm@g.nccu.edu.tw", /\/dashboard$/);

    await page.goto("/competitions");
    await expect(page.getByRole("heading", { name: "競賽大廳" })).toBeVisible();
    await page.getByRole("link", { name: "新增競賽" }).click();
    await expect(page).toHaveURL(/\/competitions\/new$/);

    await page.getByLabel("比賽名稱").fill("全國黑客松");
    await page.getByLabel("官方連結").fill("https://example.com/hackathon");
    await page.getByLabel("報名截止日期").fill("2026-12-31");

    await page.getByRole("button", { name: "存草稿" }).click();
    await expect(page).toHaveURL(/\/competitions\/[0-9a-f-]+\/edit$/);
    await expect(page.getByRole("button", { name: "發布" })).toBeVisible();
    const editUrl = page.url();

    // 草稿階段：回到大廳看得到「草稿」卡片。
    await page.goto("/competitions");
    await expect(page.getByText("草稿").first()).toBeVisible();
    await expect(page.getByText("全國黑客松")).toBeVisible();

    // 回到編輯頁按發布。
    await page.goto(editUrl);
    await page.getByRole("button", { name: "發布" }).click();
    await expect(page).toHaveURL(/\/competitions$/);

    // 學生登入後在大廳看得到這張已發布的卡片。
    await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
    await page.goto("/competitions");
    await expect(page.getByText("全國黑客松")).toBeVisible();
    await expect(page.getByRole("link", { name: "新增競賽" })).toHaveCount(0);
    await expect(page.getByText(/剩 \d+ 天|今天截止/)).toBeVisible();
    await expect(page.getByRole("link", { name: "官方連結" })).toHaveAttribute("href", "https://example.com/hackathon");
  });

  test("學生打 /competitions/new 與 /competitions/[id]/edit 都是 404", async ({ page }) => {
    await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);

    await page.goto("/competitions/new");
    await expect(page.getByText("This page could not be found.")).toBeVisible();

    await page.goto(`/competitions/00000000-0000-0000-0000-000000000000/edit`);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  });

  test("網址不是 http/https 被擋，不能存草稿", async ({ page }) => {
    await loginAndPassWelcome(page, "off@g.nccu.edu.tw", /\/dashboard$/);
    await page.goto("/competitions/new");

    await page.getByLabel("比賽名稱").fill("測試賽");
    await page.getByLabel("官方連結").fill("javascript:alert(1)");
    await page.getByLabel("報名截止日期").fill("2026-12-31");
    await page.getByRole("button", { name: "存草稿" }).click();

    await expect(page.getByText("請填正確的官方連結")).toBeVisible();
    await expect(page).toHaveURL(/\/competitions\/new$/);
  });
});
