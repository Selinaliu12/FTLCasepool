import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { resetDb, seedSemester, service } from "../integration/helpers";
import { loginAndPassWelcome } from "./helpers";

// Adjustments Task 2 視覺自我檢查用的截圖腳本：名單匯入區（新欄位說明／placeholder）與換組選單
// （「姓名（學號）· 第N組」，null 學號顯示「—」）。跟 Task 14 的 manual-screenshots.spec.ts
// 同一套規矩：預設跳過，明確帶 CAPTURE_SCREENSHOTS=1 才會真的執行、把截圖存成檔案。
//
//   CAPTURE_SCREENSHOTS=1 npx playwright test tests/e2e/adj-t2-screenshots.spec.ts
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1";
const ROUND = process.env.SCREENSHOT_ROUND ?? "1";

const SIZES = [
  { name: "1280", width: 1280, height: 800 },
  { name: "375", width: 375, height: 812 },
];

test.describe.serial(`adj-t2 視覺自我檢查截圖 round${ROUND}`, () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。執行方式見檔案開頭註解（CAPTURE_SCREENSHOTS=1）。");

  test.beforeAll(async () => {
    fs.mkdirSync(".screenshots", { recursive: true });
    await resetDb();
    const seed = await seedSemester();
    // 多補一列：讓同一個人（a1）同時也是第2組的專案生（多列身份），且有學號／系級，
    // 用來檢查換組選單「一個學生身份一個選項」＋「（學號）」的顯示。
    const svc = service();
    await svc
      .from("members")
      .update({ student_id: "110701001", dept_year: "資科三" })
      .eq("semester_id", seed.semesterId)
      .eq("email", "a1@g.nccu.edu.tw");
    await svc.from("members").insert({
      semester_id: seed.semesterId,
      email: "a1@g.nccu.edu.tw",
      name: "甲一",
      role: "student",
      student_id: "110701001",
      dept_year: "資科三",
      group_id: seed.groupB,
    });
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`名單匯入區（新欄位說明、placeholder）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "admin@g.nccu.edu.tw", /\/admin$/);
      await expect(page.getByText("名單匯入")).toBeVisible();
      await expect(page.getByLabel("貼上名單 CSV")).toBeVisible();
      await page.screenshot({ path: `.screenshots/round${ROUND}-adj-t2-roster-import-${size.name}.png`, fullPage: true });
    });

    test(`換組選單（姓名（學號）· 第N組，多身份各一個選項）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "admin@g.nccu.edu.tw", /\/admin$/);
      await page.getByLabel("選擇成員").click();
      await expect(page.getByRole("option", { name: "甲一（110701001）· 第1組" })).toBeVisible();
      await expect(page.getByRole("option", { name: "甲一（110701001）· 第2組" })).toBeVisible();
      await expect(page.getByRole("option", { name: "甲二（—）· 第1組" })).toBeVisible();

      // F1 fix：彈出視窗曾經只跟觸發按鈕一樣寬，導致「甲一（110701001）· 第1組」和
      // 「…· 第2組」兩個選項的文字被裁掉、長得一模一樣。用 scrollWidth（文字實際需要的
      // 寬度，不受 overflow 影響）跟 clientWidth（視窗實際可見的寬度）比較：兩者相等（在誤差
      // 內）代表沒有東西被裁掉；scrollWidth 明顯大於 clientWidth 代表文字被裁切了。
      const popup = page.locator('[data-slot="select-content"]');
      const overflow = await popup.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);

      // 彈出視窗變寬之後，不能把整個頁面撐出水平捲軸（尤其是 375 窄螢幕）。
      const pageOverflowsHorizontally = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(pageOverflowsHorizontally).toBe(false);

      // fullPage 截圖有時候拍不到用 Portal 掛在 body 外、position 為 fixed 的彈出視窗；
      // 改拍視窗截圖確保彈出中的選單真的被拍進去。
      await page.screenshot({ path: `.screenshots/round${ROUND}-adj-t2-move-member-select-${size.name}.png` });
      await page.keyboard.press("Escape");
    });
  }
});
