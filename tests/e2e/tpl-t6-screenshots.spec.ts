import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { resetDb, seedSemester, service } from "../integration/helpers";
import { loginAndPassWelcome } from "./helpers";

// Task 6 視覺自我檢查：管理員頁「成員」區塊的「編輯」對話框（姓名／學號／系級／信箱＋錯誤）。
// 預設跳過；CAPTURE_SCREENSHOTS=1 SCREENSHOT_ROUND=1|2 npx playwright test tests/e2e/tpl-t6-screenshots.spec.ts
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1";
const ROUND = process.env.SCREENSHOT_ROUND ?? "1";

const SIZES = [
  { name: "1280", width: 1280, height: 800 },
  { name: "375", width: 375, height: 812 },
];

test.describe.serial(`tpl-t6 視覺自我檢查截圖 round${ROUND}`, () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。");

  test.beforeAll(async () => {
    fs.mkdirSync(".screenshots", { recursive: true });
    await resetDb();
    const seed = await seedSemester();
    const db = service();
    await db.from("members").update({ student_id: "110701001", dept_year: "資科三" }).eq("email", "a1@g.nccu.edu.tw");
    void seed;
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`編輯成員對話框 ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "admin@g.nccu.edu.tw", /\/admin$/);
      const card = page.locator('[data-slot="card"]').filter({ has: page.getByText("成員", { exact: true }) });
      await card.scrollIntoViewIfNeeded();
      const row = card.getByRole("row").filter({ hasText: "甲一" }).first();
      await row.getByRole("button", { name: "編輯" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel("姓名")).toHaveValue("甲一");
      const prefix = `.screenshots/round${ROUND}-tpl-t6-${size.name}`;
      await page.screenshot({ path: `${prefix}-dialog-open.png` });

      // 改信箱撞到已在名單上的信箱：錯誤顯示在表單裡。
      await dialog.getByLabel("學校信箱").fill("a2@g.nccu.edu.tw");
      await dialog.getByRole("button", { name: "儲存" }).click();
      await dialog.getByRole("alert").waitFor();
      await expect(dialog.getByRole("button", { name: "儲存" })).toBeEnabled();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${prefix}-dialog-error.png` });

      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      fs.writeFileSync(`${prefix}-scrollwidth.txt`, String(scrollW));
    });
  }
});
