import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { resetDb, seedSemester, backdateStageSubmissionUploadedAt } from "../integration/helpers";

function serviceSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

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

// b2-t5：學生上傳報名階段的 PDF → 看到待審／可修改到。跟 entries.spec.ts 同一套種子與
// 登入流程，這裡直接用 service client 建一筆已確認的報名（跳過掛比賽／確認報名這兩步，
// 專注測 Task 5 的上傳流程本身）。
test.describe.serial("比賽階段上傳", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let entryId: string;

  test.beforeAll(async () => {
    await resetDb();
    seed = await seedSemester({ acknowledged: true });

    const db = serviceSupabase();
    const { data: competition, error: competitionError } = await db
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "全國黑客松",
        url: "https://example.com/hackathon",
        signup_deadline: "2099-12-31T15:59:59.999Z",
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
    entryId = entry.id as string;

    const { error: lineError } = await db
      .from("lines")
      .insert({ group_id: seed.groupA, kind: "competition", entry_id: entryId });
    if (lineError) throw lineError;
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("學生上傳報名階段的 PDF → 看到待審 · 可修改到", async ({ page }) => {
    await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);

    await page.goto(`/my-group/competitions/${entryId}`);
    await expect(page.getByText("全國黑客松")).toBeVisible();
    await expect(page.getByText("報名", { exact: true })).toBeVisible();

    await page.locator('input[aria-label="上傳報名"]').setInputFiles(path.join(__dirname, "../fixtures/sample.pdf"));

    await expect(page.getByText(/已上傳第 1 版 · 待審 · 可修改到/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "換 PDF" })).toBeVisible();
    await expect(page.getByRole("button", { name: "撤回" })).toBeVisible();
  });

  // fix round 1：同一個 describe.serial，接著上一個測試留下的狀態（報名階段已上傳第 1 版），
  // 驗證 2 小時內撤回真的把畫面帶回「還沒交」的狀態（上傳按鈕重新出現）。
  test("2 小時內撤回 → 回到上傳按鈕", async ({ page }) => {
    await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
    await page.goto(`/my-group/competitions/${entryId}`);
    await expect(page.getByText(/已上傳第 1 版/)).toBeVisible();

    await page.getByRole("button", { name: "撤回" }).click();
    await page.getByRole("button", { name: "確定撤回" }).click();

    await expect(page.getByRole("button", { name: "上傳" }).first()).toBeVisible();
    await expect(page.getByText(/已上傳第 1 版/)).toHaveCount(0);
  });
});

// fix round 1：鎖定狀態＋退回帶原因＋版本列表，這三個畫面狀態只靠「剛上傳、還沒過 2 小時」的
// 測試看不到——用 service client 直接造一個「已鎖定、被退回、留了原因」的第 1 版，模擬 Task 6
// 審核過的結果。
test.describe.serial("比賽階段上傳：鎖定與版本列表", () => {
  let entryId: string;

  test.beforeAll(async () => {
    await resetDb();
    const seed = await seedSemester({ acknowledged: true });

    const db = serviceSupabase();
    const { data: competition, error: competitionError } = await db
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "全國黑客松",
        url: "https://example.com/hackathon",
        signup_deadline: "2099-12-31T15:59:59.999Z",
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
    entryId = entry.id as string;

    const { data: line, error: lineError } = await db
      .from("lines")
      .insert({ group_id: seed.groupA, kind: "competition", entry_id: entryId })
      .select()
      .single();
    if (lineError) throw lineError;

    const { data: submission, error: submissionError } = await db
      .from("stage_submissions")
      .insert({
        line_id: line.id,
        stage: "signup",
        version: 1,
        pdf_key: `${seed.semesterId}/${seed.groupA}/signup-v1.pdf`,
        pdf_size: 1024,
        pdf_uploaded_at: new Date().toISOString(),
        pdf_uploaded_by: "a1@g.nccu.edu.tw",
        submitted_by: "a1@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (submissionError) throw submissionError;

    // review 欄位只能在鎖定之後改（NOT_LOCKED trigger），先把上傳時間往前搬，模擬已經鎖定。
    await backdateStageSubmissionUploadedAt(submission.id as string, new Date(Date.now() - 3 * 60 * 60 * 1000));
    const { error: returnError } = await db
      .from("stage_submissions")
      .update({
        review_status: "returned",
        reviewed_by: "pm@g.nccu.edu.tw",
        reviewed_at: new Date().toISOString(),
        comment: "格式不對，請用官方範本重新輸出",
      })
      .eq("id", submission.id);
    if (returnError) throw returnError;
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("被退回、已鎖定：上傳按鈕重新出現（可以重交），版本列表顯示退回原因", async ({ page }) => {
    await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
    await page.goto(`/my-group/competitions/${entryId}`);

    await expect(page.getByRole("button", { name: "上傳" }).first()).toBeVisible();
    await expect(page.getByText(/第 1 版 · 已退回/)).toBeVisible();
    await expect(page.getByText(/格式不對，請用官方範本重新輸出/)).toBeVisible();
  });
});
