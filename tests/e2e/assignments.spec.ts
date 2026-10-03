import { test, expect } from "@playwright/test";
import { resetDb, seedSemester } from "../integration/helpers";
import { loginAndPassWelcome } from "./helpers";

// 規格 §17：專案幹部出作業 → 被派到的組員交 PDF → 出題者在作業頁看到「已交」。重建資料庫，跑完還原全域種子。
test.describe.serial("專案幹部出作業", () => {
  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("出作業給第2組 → 乙一交 PDF → 作業頁顯示已交；第1組看不到這份作業", async ({ page, browser }) => {
    await resetDb();
    await seedSemester({ acknowledged: true });

    await loginAndPassWelcome(page, "pm@g.nccu.edu.tw", /\/dashboard$/);
    await page.getByRole("link", { name: "作業" }).click();
    await page.getByRole("button", { name: "出新作業" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("標題").fill("市場調查");
    await dialog.getByLabel("截止日期").fill("2099-12-31");
    await dialog.getByRole("checkbox", { name: "第2組" }).click();
    await dialog.getByRole("button", { name: "出作業" }).click();
    await expect(dialog).toBeHidden();
    const card = page.locator('[data-slot="card"]').filter({ hasText: "市場調查" });
    await expect(card).toContainText("第2組");
    await expect(card).toContainText("未交");

    const ctx = await browser.newContext();
    const student = await ctx.newPage();
    await loginAndPassWelcome(student, "b1@g.nccu.edu.tw", /\/my-group$/);
    await student.getByRole("link", { name: "交作業" }).click();
    await student.getByLabel("PDF").setInputFiles({ name: "survey.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%test\n") });
    await student.getByLabel("說明（選填）").fill("訪談 10 人");
    await student.getByRole("button", { name: "送出" }).click();
    await student.waitForURL(/\/my-group$/);
    await expect(student.getByRole("link", { name: "查看作業" })).toBeVisible();
    await ctx.close();

    const other = await browser.newContext();
    const a1 = await other.newPage();
    await loginAndPassWelcome(a1, "a1@g.nccu.edu.tw", /\/my-group$/);
    await expect(a1.getByText("市場調查")).toHaveCount(0);
    await other.close();

    await page.reload();
    await expect(page.locator('[data-slot="card"]').filter({ hasText: "市場調查" })).toContainText("已交");
  });
});
