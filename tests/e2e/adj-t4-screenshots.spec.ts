import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { resetDb, seedSemester, service } from "../integration/helpers";
import { loginAndPassWelcome } from "./helpers";

// Task 4 視覺自我檢查用的截圖腳本：看板卡片（組員＋備註）、/my-group（組員＋備註編輯欄，含
// 錯誤狀態）、/groups/[id]（組員含學號＋備註）。跟 adj-t2/adj-t3 同一套規矩：預設跳過，
// 明確帶 CAPTURE_SCREENSHOTS=1 才會真的執行、把截圖存成檔案。
//
//   CAPTURE_SCREENSHOTS=1 SCREENSHOT_ROUND=1 npx playwright test tests/e2e/adj-t4-screenshots.spec.ts
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1";
const ROUND = process.env.SCREENSHOT_ROUND ?? "1";

const SIZES = [
  { name: "1280", width: 1280, height: 800 },
  { name: "375", width: 375, height: 812 },
];

let groupAId: string;
let groupBId: string;

// Fix round 1 F5：一長串沒有空白的網址，用來檢查 375px 卡片／頁面不會被撐出水平捲軸
// （break-words／whitespace-pre-wrap）。
const LONG_URL_NOTE =
  "https://example.com/very/long/path/that/has/no/spaces/anywhere/so/it/would/overflow/a/375px/card/if/nothing/wraps/it-abcdefghijklmnopqrstuvwxyz0123456789";

async function expectNoHorizontalScroll(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
}

test.describe.serial(`adj-t4 視覺自我檢查截圖 round${ROUND}`, () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。執行方式見檔案開頭註解（CAPTURE_SCREENSHOTS=1）。");

  test.beforeAll(async () => {
    fs.mkdirSync(".screenshots", { recursive: true });
    await resetDb();
    const seed = await seedSemester();
    groupAId = seed.groupA;
    groupBId = seed.groupB;
    const svc = service();
    await svc
      .from("members")
      .update({ student_id: "110701001", dept_year: "資科三" })
      .eq("semester_id", seed.semesterId)
      .eq("email", "a1@g.nccu.edu.tw");
    await svc
      .from("groups")
      .update({ note: "智慧記帳系統", note_updated_by: "甲一", note_updated_at: new Date().toISOString() })
      .eq("id", seed.groupA);
    // 第2組用一長串沒有空白的網址當備註，檢查斷字設定真的擋住水平捲軸。
    await svc
      .from("groups")
      .update({ note: LONG_URL_NOTE, note_updated_by: "乙一", note_updated_at: new Date().toISOString() })
      .eq("id", seed.groupB);
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`看板卡片（組員＋備註）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "off@g.nccu.edu.tw", /\/dashboard$/);
      await expect(page.getByText("智慧記帳系統")).toBeVisible();
      await expect(page.getByText("甲一 · 資科三")).toBeVisible();
      // 第2組的長網址備註：不能把卡片、頁面撐出水平捲軸。
      await expect(page.getByText(LONG_URL_NOTE)).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: `.screenshots/round${ROUND}-adj-t4-dashboard-card-${size.name}.png`, fullPage: true });
    });

    test(`/my-group（組員＋備註編輯欄，含錯誤狀態）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
      await expect(page.getByText("甲一 · 資科三")).toBeVisible();
      await expect(page.getByLabel("組別備註")).toHaveValue("智慧記帳系統");
      // 觸發錯誤狀態：超過 200 字。計數器現在應該是 --danger 紅色（F4）。
      await page.getByLabel("組別備註").fill("字".repeat(201));
      await page.getByRole("button", { name: "儲存" }).click();
      await expect(page.getByText("備註最多 200 字")).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: `.screenshots/round${ROUND}-adj-t4-my-group-note-error-${size.name}.png`, fullPage: true });
    });

    test(`/groups/[id]（組員含學號＋備註，含長網址備註）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "pm@g.nccu.edu.tw", /\/dashboard$/);
      await page.goto(`/groups/${groupAId}`);
      await expect(page.getByText("甲一 · 110701001 · 資科三")).toBeVisible();
      await expect(page.getByText("智慧記帳系統")).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: `.screenshots/round${ROUND}-adj-t4-group-detail-${size.name}.png`, fullPage: true });

      // 第2組（長網址備註）另外截一張，專門檢查斷字。
      await page.goto(`/groups/${groupBId}`);
      await expect(page.getByText(LONG_URL_NOTE)).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: `.screenshots/round${ROUND}-adj-t4-group-detail-long-url-${size.name}.png`, fullPage: true });
    });
  }
});
