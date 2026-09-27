import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester, asUser, clientAs } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/session", () => ({ getAccess: vi.fn() }));
import { getAccess } from "@/server/session";
const mockGetAccess = vi.mocked(getAccess);

const mockCreateServerSupabase = vi.fn();
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return { ...actual, createServerSupabase: () => mockCreateServerSupabase() };
});

const SEMESTER_NAME = "115-1";

function asPmMember(semesterId: string, memberId: string, email = "pm@g.nccu.edu.tw") {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email,
    isAdmin: false,
    member: { id: memberId, semesterId, email, name: "專案幹部", role: "pm", groupId: null },
    semesterId,
  });
}

function asStudentMember(semesterId: string, groupId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "a1@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "s-id", semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student", groupId },
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

async function insertSubmission(
  lineId: string,
  groupId: string,
  opts: { stage?: string; version?: number; reviewStatus?: string; uploadedAt?: Date } = {}
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
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

describe("loadReviewQueue", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("列出負責組別、已鎖定、待審的最新版本", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupA);
    const submission = await insertSubmission(lineId, seed.groupA, { stage: "signup" });

    asPmMember(seed.semesterId, pmId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));
    const { loadReviewQueue } = await import("@/server/queries/review-queue");
    const queue = await asUser("pm@g.nccu.edu.tw", () => loadReviewQueue(new Date()));

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      submissionId: submission.id,
      groupName: "第1組",
      competitionName: "黑客松",
      stage: "signup",
      version: 1,
    });
    expect(queue[0].waitingDays).toBeGreaterThanOrEqual(0);
  });

  it("不滿 2 小時（還沒鎖定）不出現在佇列", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupA);
    await insertSubmission(lineId, seed.groupA, { uploadedAt: new Date() });

    asPmMember(seed.semesterId, pmId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));
    const { loadReviewQueue } = await import("@/server/queries/review-queue");
    const queue = await asUser("pm@g.nccu.edu.tw", () => loadReviewQueue(new Date()));

    expect(queue).toHaveLength(0);
  });

  it("不是最新版（已被退回重交）不出現", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupA);
    // v1 已退回，v2 待審且鎖定——只有 v2 該出現。
    await insertSubmission(lineId, seed.groupA, { version: 1, reviewStatus: "returned" });
    await insertSubmission(lineId, seed.groupA, { version: 2 });

    asPmMember(seed.semesterId, pmId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));
    const { loadReviewQueue } = await import("@/server/queries/review-queue");
    const queue = await asUser("pm@g.nccu.edu.tw", () => loadReviewQueue(new Date()));

    expect(queue).toHaveLength(1);
    expect(queue[0].version).toBe(2);
  });

  it("線已結束（已退出）不出現在佇列", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id, {
      withdrawn_at: new Date("2026-09-02T00:00:00Z").toISOString(),
    });
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupA);
    await insertSubmission(lineId, seed.groupA);

    asPmMember(seed.semesterId, pmId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));
    const { loadReviewQueue } = await import("@/server/queries/review-queue");
    const queue = await asUser("pm@g.nccu.edu.tw", () => loadReviewQueue(new Date()));

    expect(queue).toHaveLength(0);
  });

  it("不是負責的組別不出現", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupB); // 指派到別組
    await insertSubmission(lineId, seed.groupA);

    asPmMember(seed.semesterId, pmId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));
    const { loadReviewQueue } = await import("@/server/queries/review-queue");
    const queue = await asUser("pm@g.nccu.edu.tw", () => loadReviewQueue(new Date()));

    expect(queue).toHaveLength(0);
  });

  it("換負責組別後立即更新（Review Focus 4）", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const pmId = await pmMemberId();
    await insertSubmission(lineId, seed.groupA);

    asPmMember(seed.semesterId, pmId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));
    const { loadReviewQueue } = await import("@/server/queries/review-queue");

    expect(await asUser("pm@g.nccu.edu.tw", () => loadReviewQueue(new Date()))).toHaveLength(0);

    await assignPm(pmId, seed.groupA);
    expect(await asUser("pm@g.nccu.edu.tw", () => loadReviewQueue(new Date()))).toHaveLength(1);
  });

  it("非專案幹部回傳空陣列", async () => {
    const seed = await seedSemester({ acknowledged: true });
    asStudentMember(seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));
    const { loadReviewQueue } = await import("@/server/queries/review-queue");
    const queue = await asUser("a1@g.nccu.edu.tw", () => loadReviewQueue(new Date()));
    expect(queue).toEqual([]);
  });
});
