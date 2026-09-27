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

// b2-t6：專案幹部看板上方「待你審核」→ 點進去審核 → 通過 → 組員看到已報名。跟
// stage-uploads.spec.ts 同一套種子模式：用 service client 直接造一筆已鎖定、待審的報名階段
// 繳交（跳過真的上傳一份 PDF），並把這位 PM 指派到這組，專注測 Task 6 的審核流程本身。
test.describe.serial("專案幹部審核與待你審核", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let groupId: string;

  test.beforeAll(async () => {
    await resetDb();
    seed = await seedSemester({ acknowledged: true });
    groupId = seed.groupA;

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
        group_id: groupId,
        competition_id: competition.id,
        created_by: "a1@g.nccu.edu.tw",
        confirmed_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (entryError) throw entryError;

    const { data: line, error: lineError } = await db
      .from("lines")
      .insert({ group_id: groupId, kind: "competition", entry_id: entry.id })
      .select()
      .single();
    if (lineError) throw lineError;

    const { data: submission, error: submissionError } = await db
      .from("stage_submissions")
      .insert({
        line_id: line.id,
        stage: "signup",
        version: 1,
        pdf_key: `${seed.semesterId}/${groupId}/signup-v1.pdf`,
        pdf_size: 1024,
        pdf_uploaded_at: new Date().toISOString(),
        pdf_uploaded_by: "a1@g.nccu.edu.tw",
        submitted_by: "a1@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (submissionError) throw submissionError;

    // 鎖定（滿 2 小時）之後才會進到「待你審核」佇列。
    await backdateStageSubmissionUploadedAt(submission.id as string, new Date(Date.now() - 3 * 60 * 60 * 1000));

    const { data: pm, error: pmError } = await db
      .from("members")
      .select("id")
      .eq("semester_id", seed.semesterId)
      .eq("email", "pm@g.nccu.edu.tw")
      .single();
    if (pmError) throw pmError;

    const { error: assignError } = await db
      .from("pm_assignments")
      .insert({ pm_member_id: pm.id, group_id: groupId });
    if (assignError) throw assignError;
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("PM 在待你審核看到這筆、進去通過 → 組員看到已報名", async ({ page }) => {
    await loginAndPassWelcome(page, "pm@g.nccu.edu.tw", /\/dashboard$/);

    await expect(page.getByText("待你審核（1）")).toBeVisible();
    await expect(page.getByText(/第1組 · 全國黑客松 · 報名第 1 版/)).toBeVisible();

    await page.getByText(/第1組 · 全國黑客松 · 報名第 1 版/).click();
    await expect(page).toHaveURL(new RegExp(`/groups/${groupId}$`));

    await expect(page.getByRole("button", { name: "通過" })).toBeVisible();
    await page.getByRole("button", { name: "通過" }).click();
    // Final review minor 1：通過會先跳對話框，可以附選填評語。
    await page.getByLabel("通過評語（選填）").fill("報名證明清楚");
    await page.getByRole("button", { name: "確定通過" }).click();
    await expect(page.getByRole("main").getByText("已通過")).toBeVisible();
    await expect(page.getByRole("main").getByText("（報名證明清楚）")).toBeVisible();

    // 回看板：這筆已經不在待你審核裡了。
    await page.goto("/dashboard");
    await expect(page.getByText("目前沒有待審核的繳交")).toBeVisible();
  });

  test("組員在報名頁看到已報名", async ({ page }) => {
    await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
    await expect(page.getByText("已報名")).toBeVisible();
  });
});
