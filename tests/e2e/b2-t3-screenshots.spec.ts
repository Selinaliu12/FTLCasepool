import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { resetDb, seedSemester } from "../integration/helpers";

function serviceSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

// b2-t3（掛比賽、參賽成員、確認報名、取消報名）視覺自我檢查截圖，跟 b2-t1／b2-t2 同一套規矩：
// 預設跳過、自己控制種子資料、結束後還原。執行方式：
//   CAPTURE_SCREENSHOTS=1 npx playwright test tests/e2e/b2-t3-screenshots.spec.ts
//
// 跟 b2-t2 的截圖不一樣：這裡有幾個測試會真的寫入資料（掛比賽、確認報名），如果沿用
// describe.serial 共用同一份 beforeAll 種子資料，不同尺寸（1280／375）的同一個情境會互相
// 汙染（例如 1280 那次已經把比賽掛上去，375 那次同一個學生看到的就是「已掛到你們組」而不是
// 「掛到我們組」）。所以每個測試自己 resetDb／seedSemester，用完即丟。
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

async function setupPublishedCompetition(): Promise<{ competitionId: string; groupA: string; groupB: string }> {
  await resetDb();
  const seed = await seedSemester({ acknowledged: true });
  const { data, error } = await serviceSupabase()
    .from("competitions")
    .insert({
      semester_id: seed.semesterId,
      name: "全國大學生黑客松",
      url: "https://example.com/hackathon",
      signup_deadline: "2099-12-01T15:59:59.999Z",
      status: "published",
      created_by: "pm@g.nccu.edu.tw",
    })
    .select()
    .single();
  if (error) throw error;
  return { competitionId: data.id as string, groupA: seed.groupA, groupB: seed.groupB };
}

test.describe(`b2-t3 視覺自我檢查截圖 ${ROUND}`, () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。執行方式見檔案開頭註解（CAPTURE_SCREENSHOTS=1）。");

  test.beforeAll(() => {
    fs.mkdirSync(".screenshots", { recursive: true });
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`/competitions（學生：掛到我們組按鈕）@ ${size.name}`, async ({ page }) => {
      await setupPublishedCompetition();
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
      await page.goto("/competitions");
      await expect(page.getByRole("button", { name: "掛到我們組" })).toBeVisible();
      await page.screenshot({ path: `.screenshots/${ROUND}-b2-t3-lobby-attach-${size.name}.png`, fullPage: true });
    });

    test(`/my-group/competitions/[entryId]（未確認→確認報名）@ ${size.name}`, async ({ page }) => {
      await setupPublishedCompetition();
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
      await page.goto("/competitions");
      await page.getByRole("button", { name: "掛到我們組" }).click();
      await expect(page).toHaveURL(/\/my-group\/competitions\/[0-9a-f-]+$/);
      await expect(page.getByRole("button", { name: "確認報名" })).toBeVisible();
      await page.screenshot({ path: `.screenshots/${ROUND}-b2-t3-entry-unconfirmed-${size.name}.png`, fullPage: true });

      await page.getByRole("button", { name: "確認報名" }).click();
      await page.getByRole("button", { name: "確定" }).click();
      await expect(page.getByRole("button", { name: "取消報名" })).toBeVisible();
      await page.screenshot({ path: `.screenshots/${ROUND}-b2-t3-entry-confirmed-${size.name}.png`, fullPage: true });
    });

    test(`/my-group（比賽區塊）@ ${size.name}`, async ({ page }) => {
      const { competitionId, groupB } = await setupPublishedCompetition();
      const { error } = await serviceSupabase()
        .from("competition_entries")
        .insert({ group_id: groupB, competition_id: competitionId, created_by: "b1@g.nccu.edu.tw" });
      if (error) throw error;

      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "b1@g.nccu.edu.tw", /\/my-group$/);
      await page.goto("/my-group");
      await expect(page.getByRole("heading", { name: "比賽" })).toBeVisible();
      await expect(page.getByText("全國大學生黑客松")).toBeVisible();
      await page.screenshot({ path: `.screenshots/${ROUND}-b2-t3-my-group-section-${size.name}.png`, fullPage: true });
    });
  }
});
