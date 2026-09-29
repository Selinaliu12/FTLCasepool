import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { resetDb, seedSemester, service } from "../integration/helpers";
import { loginAndPassWelcome } from "./helpers";

// 競賽大廳新模板 Task 3 視覺自我檢查用的截圖腳本：大廳卡片改版——一張填滿新欄位的卡片
// （標籤、四格資訊、幹部推薦、已掛上的組別），一張舊比賽卡片（新欄位全是 null，確認不會壞、
// 不出現 null／空標題）。跟其他 *-screenshots.spec.ts 同一套規矩：預設跳過，明確帶
// CAPTURE_SCREENSHOTS=1 才會真的執行、把截圖存成檔案。
//
//   CAPTURE_SCREENSHOTS=1 npx playwright test tests/e2e/tpl-t3-screenshots.spec.ts
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1";
const ROUND = process.env.SCREENSHOT_ROUND ?? "1";

const SIZES = [
  { name: "1280", width: 1280, height: 800 },
  { name: "375", width: 375, height: 812 },
];

test.describe.serial(`tpl-t3 視覺自我檢查截圖 round${ROUND}`, () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。執行方式見檔案開頭註解（CAPTURE_SCREENSHOTS=1）。");

  test.beforeAll(async () => {
    fs.mkdirSync(".screenshots", { recursive: true });
    await resetDb();
    const seed = await seedSemester();
    const db = service();

    const { data: full, error: fullError } = await db
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "全欄位黑客松",
        organizer: "校友會",
        url: "https://example.com/full",
        signup_deadline: "2026-10-31T09:00:00Z", // 台北 10/31 17:00
        submission_deadline: "2026-11-15T09:00:00Z",
        final_date: "2026-12-01T09:00:00Z",
        status: "published",
        summary: "一句話介紹這場比賽在做什麼。",
        tags: ["ESG", "企業出題", "行銷"],
        max_prize: 100000,
        team_size: "3-5 人",
        recommended: true,
        staff_note: "這場很值得推薦",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (fullError) throw fullError;

    const { error: oldError } = await db.from("competitions").insert({
      semester_id: seed.semesterId,
      name: "舊比賽（沒有新欄位）",
      url: "https://example.com/old",
      signup_deadline: "2026-10-20T09:00:00Z",
      status: "published",
      created_by: "pm@g.nccu.edu.tw",
    });
    if (oldError) throw oldError;

    // 兩組都掛上全欄位那場比賽，確認底部「第1組、第2組已掛上」會顯示、依組名自然排序。
    const { error: entriesError } = await db.from("competition_entries").insert([
      { group_id: seed.groupA, competition_id: full.id, created_by: "a1@g.nccu.edu.tw" },
      { group_id: seed.groupB, competition_id: full.id, created_by: "b1@g.nccu.edu.tw" },
    ]);
    if (entriesError) throw entriesError;
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`大廳：全欄位卡片＋舊比賽卡片 @ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "pm@g.nccu.edu.tw", /\/dashboard$/);
      await page.goto("/competitions");
      await expect(page.getByRole("heading", { name: "競賽大廳" })).toBeVisible();
      await expect(page.getByText("幹部推薦")).toBeVisible();
      await expect(page.getByText("第1組、第2組已掛上")).toBeVisible();
      await expect(page.getByText("舊比賽（沒有新欄位）").first()).toBeVisible();

      const pageOverflowsHorizontally = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(pageOverflowsHorizontally).toBe(false);

      await page.screenshot({ path: `.screenshots/round${ROUND}-tpl-t3-lobby-${size.name}.png`, fullPage: true });
    });
  }
});
