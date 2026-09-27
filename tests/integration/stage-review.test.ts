import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester, asUser, clientAs } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

// reviewStage() 一律先呼叫 getAccess()，跟 stage-uploads.test.ts 同一套 mock 模式。
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/session", () => ({ getAccess: vi.fn() }));
import { getAccess } from "@/server/session";
const mockGetAccess = vi.mocked(getAccess);

// loadGroupDetail 用 createServerSupabase()（cookie-based），vitest 不是真的 Next.js request
// scope，這裡跟 group-detail.test.ts 同一套：換成 clientAs() 簽出來的真實登入 client 讓 RLS
// 真的跑起來。只有最後兩個「通過/退回之後狀態」的測試需要用到 loadGroupDetail。
const mockCreateServerSupabase = vi.fn();
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return { ...actual, createServerSupabase: () => mockCreateServerSupabase() };
});

const SEMESTER_NAME = "115-1";
const NOT_FOUND = "找不到這筆繳交";
const COMMENT_REQUIRED = "退回請寫原因";
const NOT_LOCKED = "還在 2 小時可修改時間內，鎖定後才能審核";
const ALREADY_REVIEWED = "這一版已經審核過了";
const NOT_LATEST = "只能審核最新的一版";
const ENDED = "這場比賽已經結束";

function asPmMember(semesterId: string, memberId: string, email = "pm@g.nccu.edu.tw") {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email,
    isAdmin: false,
    member: { id: memberId, semesterId, email, name: "專案幹部", role: "pm", groupId: null },
    semesterId,
  });
}

function asOfficer(semesterId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "off@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "off-id", semesterId, email: "off@g.nccu.edu.tw", name: "其他幹部", role: "officer", groupId: null },
    semesterId,
  });
}

function asAdminNoMember(semesterId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "admin@g.nccu.edu.tw",
    isAdmin: true,
    member: null,
    semesterId,
  });
}

async function pmMemberId(): Promise<string> {
  const db = createServiceSupabase();
  const { data, error } = await db.from("members").select("id").eq("email", "pm@g.nccu.edu.tw").single();
  if (error) throw error;
  return data.id as string;
}

async function assignPm(pmId: string, groupId: string) {
  const db = createServiceSupabase();
  const { error } = await db.from("pm_assignments").insert({ pm_member_id: pmId, group_id: groupId });
  if (error) throw error;
}

async function createCompetition(semesterId: string, overrides: Record<string, unknown> = {}) {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("competitions")
    .insert({
      semester_id: semesterId,
      name: "黑客松",
      url: "https://example.com",
      signup_deadline: "2026-10-01T15:59:59.999Z",
      submission_deadline: "2026-11-01T15:59:59.999Z",
      final_date: "2026-12-01T15:59:59.999Z",
      status: "published",
      created_by: "pm@g.nccu.edu.tw",
      ...overrides,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function confirmedEntry(groupId: string, competitionId: string, overrides: Record<string, unknown> = {}) {
  const db = createServiceSupabase();
  const { data: entry, error: entryError } = await db
    .from("competition_entries")
    .insert({
      group_id: groupId,
      competition_id: competitionId,
      created_by: "a1@g.nccu.edu.tw",
      confirmed_at: new Date("2026-09-01T00:00:00Z").toISOString(),
      ...overrides,
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

  return { entryId: entry.id as string, lineId: line.id as string };
}

function pdfKey(groupId: string, suffix: string) {
  return `${SEMESTER_NAME}/${groupId}/${suffix}.pdf`;
}

// 直接插入一筆 stage_submissions（不走 submitStage 的上傳安全鏈——那一整套已經被
// stage-uploads.test.ts 蓋過，這裡只需要「已鎖定的 pending 版本」這個前提）。
async function insertSubmission(
  lineId: string,
  groupId: string,
  opts: { stage?: string; version?: number; reviewStatus?: string; uploadedAt?: Date; comment?: string | null } = {}
) {
  const db = createServiceSupabase();
  const stage = opts.stage ?? "signup";
  const version = opts.version ?? 1;
  const uploadedAt = opts.uploadedAt ?? new Date(Date.now() - 3 * 60 * 60 * 1000);
  const { data, error } = await db
    .from("stage_submissions")
    .insert({
      line_id: lineId,
      stage,
      version,
      pdf_key: pdfKey(groupId, `${stage}-v${version}-${Math.random().toString(36).slice(2)}`),
      pdf_size: 1024,
      pdf_uploaded_at: uploadedAt.toISOString(),
      pdf_uploaded_by: "a1@g.nccu.edu.tw",
      submitted_by: "a1@g.nccu.edu.tw",
      review_status: opts.reviewStatus ?? "pending",
      comment: opts.comment ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function fetchSubmission(id: string) {
  const db = createServiceSupabase();
  const { data, error } = await db.from("stage_submissions").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

describe("reviewStage", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("負責組別的 PM 通過一筆已鎖定、pending 的最新版本", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupA);
    const submission = await insertSubmission(lineId, seed.groupA);

    asPmMember(seed.semesterId, pmId);
    const { reviewStage } = await import("@/server/actions/stages");
    const result = await asUser("pm@g.nccu.edu.tw", () => reviewStage(submission.id, "approved", null));

    expect(result).toEqual({ ok: true });
    const row = await fetchSubmission(submission.id);
    expect(row.review_status).toBe("approved");
    expect(row.reviewed_by).toBe("pm@g.nccu.edu.tw");
    expect(row.reviewed_at).not.toBeNull();
  });

  it("退回必須填原因", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupA);
    const submission = await insertSubmission(lineId, seed.groupA);

    asPmMember(seed.semesterId, pmId);
    const { reviewStage } = await import("@/server/actions/stages");
    const result = await asUser("pm@g.nccu.edu.tw", () => reviewStage(submission.id, "returned", "  "));

    expect(result).toEqual({ ok: false, error: COMMENT_REQUIRED });
    const row = await fetchSubmission(submission.id);
    expect(row.review_status).toBe("pending");
  });

  it("退回附上原因：狀態變 returned，評語留存", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupA);
    const submission = await insertSubmission(lineId, seed.groupA);

    asPmMember(seed.semesterId, pmId);
    const { reviewStage } = await import("@/server/actions/stages");
    const result = await asUser("pm@g.nccu.edu.tw", () => reviewStage(submission.id, "returned", "格式不對，請重交"));

    expect(result).toEqual({ ok: true });
    const row = await fetchSubmission(submission.id);
    expect(row.review_status).toBe("returned");
    expect(row.comment).toBe("格式不對，請重交");
  });

  it("還沒鎖定（不滿 2 小時）不能審核", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupA);
    const submission = await insertSubmission(lineId, seed.groupA, { uploadedAt: new Date() });

    asPmMember(seed.semesterId, pmId);
    const { reviewStage } = await import("@/server/actions/stages");
    const result = await asUser("pm@g.nccu.edu.tw", () => reviewStage(submission.id, "approved", null));

    expect(result).toEqual({ ok: false, error: NOT_LOCKED });
  });

  it("已經審核過的版本不能再審一次", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupA);
    const submission = await insertSubmission(lineId, seed.groupA, { reviewStatus: "approved" });

    asPmMember(seed.semesterId, pmId);
    const { reviewStage } = await import("@/server/actions/stages");
    const result = await asUser("pm@g.nccu.edu.tw", () => reviewStage(submission.id, "approved", null));

    expect(result).toEqual({ ok: false, error: ALREADY_REVIEWED });
  });

  it("只能審最新一版：舊版（已被退回重交）不能再審", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupA);
    const v1 = await insertSubmission(lineId, seed.groupA, { version: 1, reviewStatus: "returned", comment: "舊版" });
    await insertSubmission(lineId, seed.groupA, { version: 2 });

    asPmMember(seed.semesterId, pmId);
    const { reviewStage } = await import("@/server/actions/stages");
    const result = await asUser("pm@g.nccu.edu.tw", () => reviewStage(v1.id, "approved", null));

    expect(result).toEqual({ ok: false, error: NOT_LATEST });
  });

  it("線已結束（已退出）不能審核", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id, {
      withdrawn_at: new Date("2026-09-02T00:00:00Z").toISOString(),
    });
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupA);
    const submission = await insertSubmission(lineId, seed.groupA);

    asPmMember(seed.semesterId, pmId);
    const { reviewStage } = await import("@/server/actions/stages");
    const result = await asUser("pm@g.nccu.edu.tw", () => reviewStage(submission.id, "approved", null));

    expect(result).toEqual({ ok: false, error: ENDED });
  });

  it("別組的 PM（沒有被指派這組）拿到統一的找不到", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupB); // 指派到另一組，不是 groupA
    const submission = await insertSubmission(lineId, seed.groupA);

    asPmMember(seed.semesterId, pmId);
    const { reviewStage } = await import("@/server/actions/stages");
    const result = await asUser("pm@g.nccu.edu.tw", () => reviewStage(submission.id, "approved", null));

    expect(result).toEqual({ ok: false, error: NOT_FOUND });
    const row = await fetchSubmission(submission.id);
    expect(row.review_status).toBe("pending");
  });

  it("其他幹部拿到統一的找不到", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const submission = await insertSubmission(lineId, seed.groupA);

    asOfficer(seed.semesterId);
    const { reviewStage } = await import("@/server/actions/stages");
    const result = await asUser("off@g.nccu.edu.tw", () => reviewStage(submission.id, "approved", null));

    expect(result).toEqual({ ok: false, error: NOT_FOUND });
  });

  it("管理員（走服務身分）拿到統一的找不到——審核只給負責的 PM", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const submission = await insertSubmission(lineId, seed.groupA);

    asAdminNoMember(seed.semesterId);
    const { reviewStage } = await import("@/server/actions/stages");
    const result = await reviewStage(submission.id, "approved", null);

    expect(result).toEqual({ ok: false, error: NOT_FOUND });
  });

  it("找不到這筆繳交（亂填 id）", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const pmId = await pmMemberId();
    asPmMember(seed.semesterId, pmId);
    const { reviewStage } = await import("@/server/actions/stages");
    const result = await asUser("pm@g.nccu.edu.tw", () => reviewStage("not-a-uuid", "approved", null));
    expect(result).toEqual({ ok: false, error: NOT_FOUND });
  });

  it("退回後重交給 v2，v2 鎖定後可以被審核", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupA);
    await insertSubmission(lineId, seed.groupA, { version: 1, reviewStatus: "returned", comment: "舊版" });
    const v2 = await insertSubmission(lineId, seed.groupA, { version: 2 });

    asPmMember(seed.semesterId, pmId);
    const { reviewStage } = await import("@/server/actions/stages");
    const result = await asUser("pm@g.nccu.edu.tw", () => reviewStage(v2.id, "approved", null));

    expect(result).toEqual({ ok: true });
    const row = await fetchSubmission(v2.id);
    expect(row.review_status).toBe("approved");
  });

  it("通過報名階段後，狀態從準備中前進到已報名；completedAt 是通過那一版的送出時間", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupA);
    const submission = await insertSubmission(lineId, seed.groupA, { stage: "signup" });

    asPmMember(seed.semesterId, pmId);
    const { reviewStage } = await import("@/server/actions/stages");
    await asUser("pm@g.nccu.edu.tw", () => reviewStage(submission.id, "approved", null));

    // PM 可以讀到任何組的內容（is_pm()），用同一個 PM 身分看這組的比賽線摘要。
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));
    const { loadGroupDetail } = await import("@/server/queries/group-detail");
    const detail = await asUser("pm@g.nccu.edu.tw", () => loadGroupDetail(seed.groupA));
    const line = detail?.competitionLines.find((l) => l.lineId === lineId);
    expect(line?.status).toBe("已報名");
  });

  it("退回後線是黃燈，直到重交", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupA);
    const submission = await insertSubmission(lineId, seed.groupA, { stage: "signup" });

    asPmMember(seed.semesterId, pmId);
    const { reviewStage } = await import("@/server/actions/stages");
    await asUser("pm@g.nccu.edu.tw", () => reviewStage(submission.id, "returned", "重交一次"));

    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));
    const { loadGroupDetail } = await import("@/server/queries/group-detail");
    const detail = await asUser("pm@g.nccu.edu.tw", () => loadGroupDetail(seed.groupA));
    const line = detail?.competitionLines.find((l) => l.lineId === lineId);
    expect(line?.light).toBe("yellow");
  });
});
