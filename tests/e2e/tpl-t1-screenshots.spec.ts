import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { resetDb, seedSemester } from "../integration/helpers";
import { loginAndPassWelcome } from "./helpers";

// 競賽大廳新模板 Task 1 視覺自我檢查用的截圖腳本：幹部「新增競賽」表單的五個新分區
// （基本資料、參賽資格、賽程與繳交、獎勵與機會、報名方式與幹部備註）。跟其他 *-screenshots.spec.ts
// 同一套規矩：預設跳過，明確帶 CAPTURE_SCREENSHOTS=1 才會真的執行、把截圖存成檔案。
//
//   CAPTURE_SCREENSHOTS=1 npx playwright test tests/e2e/tpl-t1-screenshots.spec.ts
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1";
const ROUND = process.env.SCREENSHOT_ROUND ?? "1";

const SIZES = [
  { name: "1280", width: 1280, height: 800 },
  { name: "375", width: 375, height: 812 },
];

test.describe.serial(`tpl-t1 視覺自我檢查截圖 round${ROUND}`, () => {
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
    test(`新增競賽表單：新分區與新欄位 @ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "pm@g.nccu.edu.tw", /\/dashboard$/);
      await page.goto("/competitions/new");
      await expect(page.getByRole("heading", { name: "新增競賽" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "基本資料" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "參賽資格" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "賽程與繳交" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "獎勵與機會" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "報名方式與幹部備註" })).toBeVisible();
      await expect(page.getByRole("checkbox", { name: "ESG" })).toBeVisible();
      await expect(page.getByRole("switch", { name: "幹部推薦" })).toBeVisible();

      const pageOverflowsHorizontally = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(pageOverflowsHorizontally).toBe(false);

      await page.screenshot({ path: `.screenshots/round${ROUND}-tpl-t1-new-form-top-${size.name}.png`, fullPage: false });

      // 捲到「賽程與繳交」「獎勵與機會」「報名方式與幹部備註」，看填了值的樣子（含超過字數的錯誤訊息位置）。
      await page.getByLabel("比賽名稱").fill("黑客松");
      await page.getByLabel("官方連結").fill("https://example.com");
      await page.getByLabel("報名截止日期").fill("2026-12-01");
      await page.getByLabel("幹部備註（選填）").fill("字".repeat(501));
      await page.getByRole("button", { name: "存草稿" }).click();
      await expect(page.getByText("幹部備註最多 500 字")).toBeVisible();

      await page.getByRole("heading", { name: "報名方式與幹部備註" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.screenshots/round${ROUND}-tpl-t1-new-form-bottom-${size.name}.png`, fullPage: false });
    });
  }
});
