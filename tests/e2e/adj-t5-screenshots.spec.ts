import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { resetDb, seedSemester } from "../integration/helpers";
import { loginAndPassWelcome } from "./helpers";

// Adjustments Task 5 視覺自我檢查用的截圖腳本：期別表（每一期都可編輯、沒有「已有人交件」標籤）、
// 刪除有人交件的期別時的確認視窗（空白輸入／打了「刪除」）。預設跳過，明確帶
// CAPTURE_SCREENSHOTS=1 才會真的執行。
//
//   CAPTURE_SCREENSHOTS=1 SCREENSHOT_ROUND=1 npx playwright test tests/e2e/adj-t5-screenshots.spec.ts
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1";
const ROUND = process.env.SCREENSHOT_ROUND ?? "1";

const SIZES = [
  { name: "1280", width: 1280, height: 800 },
  { name: "375", width: 375, height: 812 },
];

test.describe.serial(`adj-t5 視覺自我檢查截圖 round${ROUND}`, () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。執行方式見檔案開頭註解（CAPTURE_SCREENSHOTS=1）。");

  test.beforeAll(async () => {
    fs.mkdirSync(".screenshots", { recursive: true });
    await resetDb();
    await seedSemester();
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`期別表與刪除確認視窗 @ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "admin@g.nccu.edu.tw", /\/admin$/);

      const form = page.getByRole("form", { name: "期別表" });
      await expect(page.getByLabel("第 1 期日期")).toBeVisible();
      // 把期別表卡片捲到頁首（sticky 導覽列）下方再截整個視窗，避免卡片上緣被導覽列蓋住。
      await page.locator('[data-slot="card"]', { has: form }).evaluate((el) => {
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 72);
      });
      await page.screenshot({ path: `.screenshots/round${ROUND}-adj-t5-periods-form-${size.name}.png` });

      await page.getByRole("button", { name: "刪除第 1 期" }).click();
      await page.getByRole("button", { name: "儲存期別" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("第 1 期有 1 組交了進度，刪除會一併刪掉這些進度與檔案")).toBeVisible();
      await page.waitForTimeout(500); // 等開啟動畫（淡入＋背景模糊）跑完再截圖。
      await page.screenshot({ path: `.screenshots/round${ROUND}-adj-t5-delete-dialog-empty-${size.name}.png` });

      await dialog.getByLabel("輸入「刪除」確認").fill("刪除");
      await expect(dialog.getByRole("button", { name: "確定刪除" })).toBeEnabled();
      await page.waitForTimeout(400); // 按鈕的 disabled→enabled 有 transition，等它跑完再截圖。
      await page.screenshot({ path: `.screenshots/round${ROUND}-adj-t5-delete-dialog-typed-${size.name}.png` });
    });
  }
});
