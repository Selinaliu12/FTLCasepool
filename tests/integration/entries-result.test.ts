import { beforeEach, describe, it, expect, vi } from "vitest";
import { resetDb, seedSemester, asPm, asOfficer, asStudent, asAdminNoMember, asUser, clientAs } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";
import { NOT_ACKNOWLEDGED_ERROR } from "@/server/queries/acknowledgement";

vi.mock("@/server/session", () => ({ getAccess: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCreateServerSupabase = vi.fn();
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return { ...actual, createServerSupabase: () => mockCreateServerSupabase() };
});

import { getAccess } from "@/server/session";
const mockGetAccess = vi.mocked(getAccess);

import { attachCompetition, confirmEntry, withdrawEntry, setResult } from "@/server/actions/entries";
import { submitStage, reviewStage } from "@/server/actions/stages";
import { loadCompetitionLinesForGroup } from "@/server/queries/competition-lines";
import { loadReviewQueue } from "@/server/queries/review-queue";

const NOT_FOUND = "找不到這筆報名";

function asPmMember(semesterId: string, memberId: string, email = "pm@g.nccu.edu.tw") {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email,
    isAdmin: false,
    member: { id: memberId, semesterId, email, name: "專案幹部", role: "pm", groupId: null },
    semesterId,
  });
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
  return data.id as string;
}

async function studentIds(semesterId: string, groupId: string): Promise<string[]> {
  const db = createServiceSupabase();
  const { data, error } = await db.from("members").select("id").eq("semester_id", semesterId).eq("group_id", groupId);
  if (error) throw error;
  return (data ?? []).map((m) => m.id as string);
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

async function fetchEntry(entryId: string) {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("competition_entries")
    .select("result, confirmed_at, withdrawn_at")
    .eq("id", entryId)
    .single();
  if (error) throw error;
  return data;
}

// 建一筆已確認報名、拿到 entryId／lineId，走真正的 attachCompetition／confirmEntry（不是直接
// insert），確保 setResult 的測試蓋到的是實際使用者會走的路徑。
async function confirmedEntry(seed: Awaited<ReturnType<typeof seedSemester>>): Promise<{ entryId: string; lineId: string }> {
  const competitionId = await createCompetition(seed.semesterId);
  asStudent(mockGetAccess, seed.semesterId, seed.groupA);
  const attached = await attachCompetition(competitionId);
  if (!attached.ok) throw new Error("setup failed");
  const ids = await studentIds(seed.semesterId, seed.groupA);
  const confirmed = await confirmEntry(attached.entryId, [ids[0]]);
  if (!confirmed.ok) throw new Error("setup failed");
  return { entryId: attached.entryId, lineId: confirmed.lineId };
}

describe("setResult", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let entryId: string;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    await resetDb();
    seed = await seedSemester({ acknowledged: true });
    const entry = await confirmedEntry(seed);
    entryId = entry.entryId;
  });

  it("組員可以填入晉級／得獎／未入選，並且可以任意次更正，包含改回尚未公布", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);

    const advanced = await setResult(entryId, "advanced");
    expect(advanced).toEqual({ ok: true });
    expect((await fetchEntry(entryId)).result).toBe("advanced");

    const awarded = await setResult(entryId, "awarded");
    expect(awarded).toEqual({ ok: true });
    expect((await fetchEntry(entryId)).result).toBe("awarded");

    const notSelected = await setResult(entryId, "not_selected");
    expect(notSelected).toEqual({ ok: true });
    expect((await fetchEntry(entryId)).result).toBe("not_selected");

    const cleared = await setResult(entryId, null);
    expect(cleared).toEqual({ ok: true });
    expect((await fetchEntry(entryId)).result).toBeNull();
  });

  it("別組的學生呼叫回傳找不到這筆報名，資料庫不變", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupB, "b1@g.nccu.edu.tw", "乙一");
    const result = await setResult(entryId, "advanced");
    expect(result).toEqual({ ok: false, error: NOT_FOUND });
    // 手動核對資料庫確實沒有被改動（不是只看回傳值）。
    expect((await fetchEntry(entryId)).result).toBeNull();
  });

  it("專案幹部（PM）呼叫回傳找不到這筆報名，資料庫不變", async () => {
    asPm(mockGetAccess, seed.semesterId);
    const result = await setResult(entryId, "advanced");
    expect(result).toEqual({ ok: false, error: NOT_FOUND });
    expect((await fetchEntry(entryId)).result).toBeNull();
  });

  it("其他幹部呼叫回傳找不到這筆報名，資料庫不變", async () => {
    asOfficer(mockGetAccess, seed.semesterId);
    const result = await setResult(entryId, "advanced");
    expect(result).toEqual({ ok: false, error: NOT_FOUND });
    expect((await fetchEntry(entryId)).result).toBeNull();
  });

  it("管理員（沒有 member 列）呼叫回傳找不到這筆報名，資料庫不變", async () => {
    asAdminNoMember(mockGetAccess, seed.semesterId);
    const result = await setResult(entryId, "advanced");
    expect(result).toEqual({ ok: false, error: NOT_FOUND });
    expect((await fetchEntry(entryId)).result).toBeNull();
  });

  it("還沒按過我已了解的組員被拒，資料庫不變", async () => {
    await resetDb();
    const unacked = await seedSemester();
    const competitionId = await createCompetition(unacked.semesterId);
    const db = createServiceSupabase();
    const { data: entry, error } = await db
      .from("competition_entries")
      .insert({
        group_id: unacked.groupA,
        competition_id: competitionId,
        created_by: "a1@g.nccu.edu.tw",
        confirmed_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;

    asStudent(mockGetAccess, unacked.semesterId, unacked.groupA);
    const result = await setResult(entry.id as string, "advanced");
    expect(result).toEqual({ ok: false, error: NOT_ACKNOWLEDGED_ERROR });
    expect((await fetchEntry(entry.id as string)).result).toBeNull();
  });

  it("報名還沒確認時被拒，資料庫不變", async () => {
    const competitionId = await createCompetition(seed.semesterId);
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const attached = await attachCompetition(competitionId);
    if (!attached.ok) throw new Error("setup failed");

    const result = await setResult(attached.entryId, "advanced");
    expect(result).toEqual({ ok: false, error: NOT_FOUND });
    expect((await fetchEntry(attached.entryId)).result).toBeNull();
  });

  it("已退出的報名被拒，資料庫不變", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const withdrawn = await withdrawEntry(entryId);
    expect(withdrawn.ok).toBe(true);

    const result = await setResult(entryId, "advanced");
    expect(result).toEqual({ ok: false, error: NOT_FOUND });
    expect((await fetchEntry(entryId)).result).toBeNull();
  });

  it("亂填的 entryId 回傳找不到這筆報名", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const result = await setResult("not-a-uuid", "advanced");
    expect(result).toEqual({ ok: false, error: NOT_FOUND });
  });
});

describe("setResult 效果：燈號、必要階段、上傳與審核", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let entryId: string;
  let lineId: string;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    await resetDb();
    seed = await seedSemester({ acknowledged: true });
    const entry = await confirmedEntry(seed);
    entryId = entry.entryId;
    lineId = entry.lineId;
  });

  async function groupSummary() {
    const db = createServiceSupabase();
    const now = new Date();
    const summaries = await loadCompetitionLinesForGroup(db, seed.groupA, 72, now);
    const summary = summaries.find((s) => s.entryId === entryId);
    if (!summary) throw new Error("line not found");
    return summary;
  }

  it("填未入選後：線結束、沒有燈、剩下的階段不再必要、狀態顯示未入選", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const result = await setResult(entryId, "not_selected");
    expect(result).toEqual({ ok: true });

    const summary = await groupSummary();
    expect(summary.light).toBeNull();
    expect(summary.source).toBeNull();
    expect(summary.status).toBe("未入選");
    for (const stage of summary.stages) {
      expect(stage.required).toBe(false);
    }
  });

  it("填得獎後：線結束、沒有燈、狀態顯示得獎", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const result = await setResult(entryId, "awarded");
    expect(result).toEqual({ ok: true });

    const summary = await groupSummary();
    expect(summary.light).toBeNull();
    expect(summary.status).toBe("得獎");
    for (const stage of summary.stages) {
      expect(stage.required).toBe(false);
    }
  });

  it("填晉級後：決賽階段仍然必要、線還有燈、狀態顯示晉級", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const result = await setResult(entryId, "advanced");
    expect(result).toEqual({ ok: true });

    const summary = await groupSummary();
    expect(summary.light).not.toBeNull();
    expect(summary.status).toBe("晉級");
    const finalStage = summary.stages.find((s) => s.key === "final");
    expect(finalStage?.required).toBe(true);
  });

  it("填未入選後改回尚未公布：狀態與必要階段恢復正常", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    await setResult(entryId, "not_selected");
    const cleared = await setResult(entryId, null);
    expect(cleared).toEqual({ ok: true });

    const summary = await groupSummary();
    expect(summary.light).not.toBeNull();
    expect(summary.status).not.toBe("未入選");
    const finalStage = summary.stages.find((s) => s.key === "final");
    expect(finalStage?.required).toBe(true);
  });

  it("填未入選或得獎後，上傳被擋（顯示這場比賽已經結束）", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    await setResult(entryId, "not_selected");

    const result = await submitStage(entryId, "final", `115-1/${seed.groupA}/final-v1.pdf`);
    expect(result).toEqual({ ok: false, error: "這場比賽已經結束，不能再上傳" });
  });

  // 更正結果從得獎改回晉級之後，線重新開放：一筆已鎖定、pending 的送出，原本因為結果是得獎
  // 而不能審核，改回晉級之後應該可以重新被審——controller ruling 2 明確允許這個結果
  // （不是 bug）。
  it("結果從得獎改回晉級：一筆已鎖定的 pending 送出，重新變成可以審核", async () => {
    const db = createServiceSupabase();
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupA);

    const uploadedAt = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 小時前，已鎖定
    const { data: submission, error } = await db
      .from("stage_submissions")
      .insert({
        line_id: lineId,
        stage: "signup",
        version: 1,
        pdf_key: `115-1/${seed.groupA}/signup-v1.pdf`,
        pdf_size: 1024,
        pdf_uploaded_at: uploadedAt.toISOString(),
        pdf_uploaded_by: "a1@g.nccu.edu.tw",
        submitted_by: "a1@g.nccu.edu.tw",
        review_status: "pending",
      })
      .select()
      .single();
    if (error) throw error;

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    await setResult(entryId, "awarded");

    asPmMember(seed.semesterId, pmId);
    const blocked = await asUser("pm@g.nccu.edu.tw", () => reviewStage(submission.id as string, "approved", null));
    expect(blocked).toEqual({ ok: false, error: "這場比賽已經結束" });

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const corrected = await setResult(entryId, "advanced");
    expect(corrected).toEqual({ ok: true });

    asPmMember(seed.semesterId, pmId);
    const reopened = await asUser("pm@g.nccu.edu.tw", () => reviewStage(submission.id as string, "approved", null));
    expect(reopened).toEqual({ ok: true });
  });

  it("填未入選後，這條線被排除在待審清單之外", async () => {
    const db = createServiceSupabase();
    const pmId = await pmMemberId();
    await assignPm(pmId, seed.groupA);

    const uploadedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const { error } = await db.from("stage_submissions").insert({
      line_id: lineId,
      stage: "signup",
      version: 1,
      pdf_key: `115-1/${seed.groupA}/signup-v1.pdf`,
      pdf_size: 1024,
      pdf_uploaded_at: uploadedAt.toISOString(),
      pdf_uploaded_by: "a1@g.nccu.edu.tw",
      submitted_by: "a1@g.nccu.edu.tw",
      review_status: "pending",
    });
    if (error) throw error;

    asPmMember(seed.semesterId, pmId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));
    const beforeQueue = await loadReviewQueue();
    expect(beforeQueue.some((item) => item.groupId === seed.groupA)).toBe(true);

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    await setResult(entryId, "not_selected");

    asPmMember(seed.semesterId, pmId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));
    const afterQueue = await loadReviewQueue();
    expect(afterQueue.some((item) => item.groupId === seed.groupA)).toBe(false);
  });
});
