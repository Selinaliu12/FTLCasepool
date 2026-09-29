import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { resetDb, seedSemester, service } from "../integration/helpers";
import { loginAndPassWelcome } from "./helpers";

// Task 7 視覺自我檢查：管理員頁「成員」區塊——勾「顯示已離開」看得到被移除的人、每個身份的移除
// 按鈕、「移除整個人」，以及移除確認視窗。
// 預設跳過；CAPTURE_SCREENSHOTS=1 SCREENSHOT_ROUND=1|2 npx playwright test tests/e2e/tpl-t7-screenshots.spec.ts
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1";
const ROUND = process.env.SCREENSHOT_ROUND ?? "1";

const SIZES = [
  { name: "1280", width: 1280, height: 800 },
  { name: "375", width: 375, height: 812 },
];

test.describe.serial(`tpl-t7 視覺自我檢查截圖 round${ROUND}`, () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。");

  test.beforeAll(async () => {
    fs.mkdirSync(".screenshots", { recursive: true });
    await resetDb();
    const seed = await seedSemester();
    const db = service();
    await db.from("members").update({ student_id: "110701001", dept_year: "資科三" }).eq("email", "a1@g.nccu.edu.tw");
    await db.from("members").insert([
      { semester_id: seed.semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "officer", student_id: "110701001", dept_year: "資科三" },
      { semester_id: seed.semesterId, email: "wang@g.nccu.edu.tw", name: "王小明", role: "student", group_id: seed.groupB, student_id: "111701009", dept_year: "財管二", left_at: new Date().toISOString() },
    ]);
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`成員區塊與移除確認視窗 ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "admin@g.nccu.edu.tw", /\/admin$/);
      const card = page.locator('[data-slot="card"]').filter({ has: page.getByText("成員", { exact: true }) });
      await card.getByRole("checkbox", { name: "顯示已離開" }).click();
      await expect(card.getByRole("row").filter({ hasText: "王小明" })).toContainText("（已離開）");
      await card.scrollIntoViewIfNeeded();
      const prefix = `.screenshots/round${ROUND}-tpl-t7-${size.name}`;
      await card.screenshot({ path: `${prefix}-members-card.png` });

      await card.getByRole("button", { name: "移除甲一的第1組專案生身份" }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toContainText("甲一的第1組專案生身份會標成已離開，之前交的進度保留");
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${prefix}-remove-identity-dialog.png` });
      await dialog.getByRole("button", { name: "取消" }).click();
      await expect(dialog).toBeHidden();

      await card.getByRole("row").filter({ hasText: "甲一" }).getByRole("button", { name: "移除整個人" }).click();
      await expect(dialog).toContainText("甲一的所有身份都會標成已離開");
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${prefix}-remove-person-dialog.png` });

      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      fs.writeFileSync(`${prefix}-scrollwidth.txt`, String(scrollW));
    });
  }
});
