import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { resetDb, seedSemester } from "../integration/helpers";

function serviceSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

// Batch 2 final review 視覺自我檢查截圖，跟 b2-t* 同一套規矩：預設跳過、自己控制種子資料、
// 結束後還原。執行方式：
//   CAPTURE_SCREENSHOTS=1 SCREENSHOT_ROUND=1 npx playwright test tests/e2e/b2-final-screenshots.spec.ts
// 涵蓋：看板組卡的比賽截止日、/groups/[id] 三個階段、報名頁狀態＋上傳提示＋結果限制、
// 通過附評語對話框。
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1";
const ROUND = process.env.SCREENSHOT_ROUND === "2" ? "round2" : "round1";

const SIZES = [
  { name: "1280", width: 1280, height: 800 },
  { name: "375", width: 375, height: 812 },
];

const DAY = 24 * 60 * 60 * 1000;

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

async function setup(): Promise<{ groupId: string; entryId: string }> {
  await resetDb();
  const seed = await seedSemester({ acknowledged: true });
  const db = serviceSupabase();

  const { data: competition, error: competitionError } = await db
    .from("competitions")
    .insert({
      semester_id: seed.semesterId,
      name: "全國大學生黑客松",
      url: "https://example.com/hackathon",
      signup_deadline: new Date(Date.now() + 2 * DAY).toISOString(),
      submission_deadline: new Date(Date.now() + 20 * DAY).toISOString(),
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

  const { data: a1 } = await db.from("members").select("id").eq("email", "a1@g.nccu.edu.tw").single();
  await db.from("entry_members").insert({ entry_id: entry.id, member_id: a1!.id });

  const { data: line, error: lineError } = await db
    .from("lines")
    .insert({ group_id: seed.groupA, kind: "competition", entry_id: entry.id })
    .select()
    .single();
  if (lineError) throw lineError;

  const { error: subError } = await db.from("stage_submissions").insert({
    line_id: line.id,
    stage: "signup",
    version: 1,
    pdf_key: `115-1/${seed.groupA}/final-shot-signup.pdf`,
    pdf_size: 1024,
    pdf_uploaded_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    pdf_uploaded_by: "a1@g.nccu.edu.tw",
    submitted_by: "a1@g.nccu.edu.tw",
  });
  if (subError) throw subError;

  const { data: pm } = await db.from("members").select("id").eq("email", "pm@g.nccu.edu.tw").single();
  await db.from("pm_assignments").insert({ pm_member_id: pm!.id, group_id: seed.groupA });

  return { groupId: seed.groupA, entryId: entry.id as string };
}

test.describe.serial("b2 final 視覺自我檢查截圖", () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。執行方式見檔案開頭註解（CAPTURE_SCREENSHOTS=1）。");

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`看板／組頁／通過對話框／報名頁 @ ${size.name}`, async ({ browser }) => {
      const { groupId, entryId } = await setup();
      const shot = (name: string) => `.screenshots/${ROUND}-b2-final-${name}-${size.name}.png`;

      // 學生先看報名頁：報名階段還沒通過 → 結果卡只有提示；每個階段寫要上傳什麼。
      const student = await browser.newPage({ viewport: { width: size.width, height: size.height } });
      await loginAndPassWelcome(student, "a1@g.nccu.edu.tw", /\/my-group$/);
      await student.goto(`/my-group/competitions/${entryId}`);
      await expect(student.getByText("報名階段通過後，才能在這裡填比賽結果。")).toBeVisible();
      await expect(student.getByText("上傳報名成功證明 PDF")).toBeVisible();
      await student.screenshot({ path: shot("entry-gated"), fullPage: true });

      // PM：看板組卡的比賽列與「下一個截止」。
      const pm = await browser.newPage({ viewport: { width: size.width, height: size.height } });
      await loginAndPassWelcome(pm, "pm@g.nccu.edu.tw", /\/dashboard$/);
      await expect(pm.getByText("黑客松 報名").or(pm.getByText("全國大學生黑客松 報名"))).toBeVisible();
      await pm.screenshot({ path: shot("dashboard"), fullPage: true });

      // PM：/groups/[id] 三個階段（繳件、決賽還沒有任何上傳也列出來）。
      await pm.goto(`/groups/${groupId}`);
      await expect(pm.getByText("下一個截止：報名", { exact: false })).toBeVisible();
      await expect(pm.getByText("未設定截止日")).toBeVisible();
      await pm.getByRole("heading", { name: "比賽" }).scrollIntoViewIfNeeded();
      await pm.screenshot({ path: shot("group-stages"), fullPage: true });

      // PM：通過附評語對話框。
      await pm.getByRole("button", { name: "通過" }).click();
      await pm.getByLabel("通過評語（選填）").fill("報名證明清楚，繼續加油");
      await pm.screenshot({ path: shot("approve-dialog") });
      await pm.getByRole("button", { name: "確定通過" }).click();
      await expect(pm.getByRole("main").getByText("（報名證明清楚，繼續加油）")).toBeVisible();

      // 學生：報名通過 → 狀態已報名、看得到通過評語與結果選單。
      await student.reload();
      await expect(student.getByRole("button", { name: "更新結果" })).toBeVisible();
      await expect(student.getByText("已報名").first()).toBeVisible();
      await student.screenshot({ path: shot("entry-approved"), fullPage: true });

      await pm.close();
      await student.close();
    });
  }
});
