import { test, expect } from "@playwright/test";
import { resetDb, seedSemester, backdatePeriodDeadline, deleteCheckinsForLine } from "../integration/helpers";

// 跟 admin.spec.ts 一樣：這支測試需要自己控制種子資料（把第2組的第1期截止日改成4天前），
// 跟其他 e2e 測試依賴的全域種子資料衝突，所以用 serial 模式、自己 resetDb／seedSemester，
// 結束後把種子資料還原給其他測試用。不依賴檔名排在誰前面誰後面——不管這支測試被排在哪裡，
// 自己的 beforeAll 都會建出它需要的資料，afterAll 都會還原。
test.describe.serial("幹部總覽看板", () => {
  test.beforeAll(async () => {
    await resetDb();
    const seed = await seedSemester();
    const overdueDeadline = new Date(Date.now() - 4 * 24 * 3_600_000);
    await backdatePeriodDeadline(seed.periodIds[0], overdueDeadline);
    // 第1組種子資料裡有一筆紅燈 check-in，跟這支測試要驗證的「第2組因為逾期而紅」無關，
    // 留著的話兩組都紅燈，「第2組排最前」這個斷言會被同色時的組名排序蓋過去。
    await deleteCheckinsForLine(seed.lineA);
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("其他幹部登入看板：第2組排最前、紅燈、來源『系統：第 1 期逾期 4 天』", async ({ page }) => {
    await page.goto("/test-login?email=off@g.nccu.edu.tw");
    await Promise.race([
      page.waitForURL(/\/dashboard$/),
      page.getByRole("button", { name: "我已了解" }).waitFor({ state: "visible" }),
    ]);
    if (await page.getByRole("button", { name: "我已了解" }).isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "我已了解" }).click();
    }
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "總覽看板" })).toBeVisible();

    const cards = page.locator("[data-slot='card']");
    const firstCard = cards.first();
    await expect(firstCard.getByText("第2組")).toBeVisible();
    await expect(firstCard.getByText("系統：第 1 期逾期 4 天")).toBeVisible();
    await expect(firstCard.getByText("紅燈")).toBeVisible();
  });

  test("專案生打 /dashboard 被導回 /my-group", async ({ page }) => {
    await page.goto("/test-login?email=a1@g.nccu.edu.tw");
    await Promise.race([
      page.waitForURL(/\/my-group$/),
      page.getByRole("button", { name: "我已了解" }).waitFor({ state: "visible" }),
    ]);
    if (await page.getByRole("button", { name: "我已了解" }).isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "我已了解" }).click();
    }
    await expect(page).toHaveURL(/\/my-group$/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/my-group$/);
  });
});
