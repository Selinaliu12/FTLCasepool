import { test, expect } from "@playwright/test";
import { resetDb, seedSemester } from "../integration/helpers";
import { loginAndPassWelcome } from "./helpers";

// Task 4（規格 §14 第 6 點）：組員改組別備註後，幹部總覽看板要立刻看到（server action 的
// revalidatePath 涵蓋 /dashboard）。用自己的種子資料、resetDb／seedSemester serial 模式，
// 跟 dashboard.spec.ts／group-detail.spec.ts 同一套規矩。
test.describe.serial("組別備註：學生編輯 → 幹部看板同步", () => {
  test.beforeAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("學生改第1組備註後，其他幹部的看板卡片顯示新備註；別組（第2組）仍顯示『尚未訂題』", async ({ page }) => {
    await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);

    // 組員清單（姓名 · 系級，種子資料沒有系級 → 「—」）。
    await expect(page.getByText("甲一 · —")).toBeVisible();
    await expect(page.getByText("甲二 · —")).toBeVisible();

    const textarea = page.getByLabel("組別備註");
    await expect(textarea).toHaveValue("");
    await expect(page.getByText("0/200")).toBeVisible();

    await textarea.fill("智慧記帳系統");
    await expect(page.getByText("6/200")).toBeVisible();
    await page.getByRole("button", { name: "儲存" }).click();

    await expect(page.getByText("已更新組別備註")).toBeVisible();
    await expect(page.getByText(/最後由 甲一 於 .+ 更新/)).toBeVisible();

    // 重新整理後仍在（真的寫進資料庫，不是只更新前端 state）。
    await page.reload();
    await expect(page.getByLabel("組別備註")).toHaveValue("智慧記帳系統");

    // 其他幹部的看板馬上看到（revalidatePath("/dashboard")）。
    await loginAndPassWelcome(page, "off@g.nccu.edu.tw", /\/dashboard$/);

    const firstCard = page.locator("[data-slot='card']").filter({ hasText: "第1組" });
    await expect(firstCard.getByText("智慧記帳系統")).toBeVisible();
    await expect(firstCard.getByText("甲一 · —")).toBeVisible();

    const secondCard = page.locator("[data-slot='card']").filter({ hasText: "第2組" });
    await expect(secondCard.getByText("尚未訂題")).toBeVisible();
  });
});
