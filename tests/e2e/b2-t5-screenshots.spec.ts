import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { resetDb, seedSemester } from "../integration/helpers";

function serviceSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

// b2-t5（比賽階段上傳）視覺自我檢查截圖，跟 b2-t3／b2-t4 同一套規矩：預設跳過、自己控制
// 種子資料、結束後還原。執行方式：
//   CAPTURE_SCREENSHOTS=1 SCREENSHOT_ROUND=1 npx playwright test tests/e2e/b2-t5-screenshots.spec.ts
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1";
const ROUND = process.env.SCREENSHOT_ROUND === "2" ? "round2" : "round1";

const SIZES = [
  { name: "1280", width: 1280, height: 800 },
  { name: "375", width: 375, height: 812 },
];

async function loginAndPassWelcome(page: Page, email: string, waitForUrl: RegExp) {
  await page.goto(`/test-login?email=${email}`);
  await Promise.race([
    page.waitForURL(waitForUrl),
    page.getByRole("button", { name: "我已了解" }).waitFor({ state: "visible" }),
  ]);
  if (await page.getByRole("button", { name: "我已了解" }).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "我已了解" }).click();
  }
  await expect(page).toHaveURL(waitForUrl);
}

async function setupConfirmedEntry(): Promise<{ entryId: string }> {
  await resetDb();
  const seed = await seedSemester({ acknowledged: true });
  const db = serviceSupabase();

  const { data: competition, error: competitionError } = await db
    .from("competitions")
    .insert({
      semester_id: seed.semesterId,
      name: "全國大學生黑客松",
      url: "https://example.com/hackathon",
      signup_deadline: "2099-12-01T15:59:59.999Z",
      submission_deadline: "2099-12-15T15:59:59.999Z",
      final_date: "2099-12-31T15:59:59.999Z",
      status: "published",
      created_by: "pm@g.nccu.edu.tw",
    })
    .select()
    .single();
  if (competitionError) throw competitionError;

  const { data: entry, error: entryError } = await db
    .from("competition_entries")
    .insert({
      group_id: seed.groupA,
      competition_id: competition.id,
      created_by: "a1@g.nccu.edu.tw",
      confirmed_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (entryError) throw entryError;

  const { error: lineError } = await db
    .from("lines")
    .insert({ group_id: seed.groupA, kind: "competition", entry_id: entry.id });
  if (lineError) throw lineError;

  return { entryId: entry.id as string };
}

test.describe(`b2-t5 視覺自我檢查截圖 ${ROUND}`, () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。執行方式見檔案開頭註解（CAPTURE_SCREENSHOTS=1）。");

  test.beforeAll(() => {
    fs.mkdirSync(".screenshots", { recursive: true });
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`報名頁：三個階段都還沒交，顯示上傳按鈕 @ ${size.name}`, async ({ page }) => {
      const { entryId } = await setupConfirmedEntry();
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
      await page.goto(`/my-group/competitions/${entryId}`);
      await expect(page.getByText("全國大學生黑客松")).toBeVisible();
      await expect(page.getByRole("button", { name: "上傳" }).first()).toBeVisible();
      await page.screenshot({ path: `.screenshots/${ROUND}-b2-t5-stage-empty-${size.name}.png`, fullPage: true });
    });

    test(`報名頁：報名階段已上傳，待審 · 可修改到 @ ${size.name}`, async ({ page }) => {
      const { entryId } = await setupConfirmedEntry();
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
      await page.goto(`/my-group/competitions/${entryId}`);

      await page.locator('input[aria-label="上傳報名"]').setInputFiles(path.join(__dirname, "../fixtures/sample.pdf"));
      await expect(page.getByText(/已上傳第 1 版 · 待審 · 可修改到/)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: "換 PDF" })).toBeVisible();
      await expect(page.getByRole("button", { name: "撤回" })).toBeVisible();

      await page.screenshot({ path: `.screenshots/${ROUND}-b2-t5-stage-uploaded-${size.name}.png`, fullPage: true });
    });
  }
});
