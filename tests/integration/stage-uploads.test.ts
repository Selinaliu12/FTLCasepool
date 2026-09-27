import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client as PgClient } from "pg";
import { resetDb, seedSemester, asUser, backdateStageSubmissionUploadedAt } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";
import { env } from "@/server/env";

// submitStage／replaceStagePdf／withdrawStage 一律先呼叫 getAccess()，跟 progress-actions.test.ts
// 同一套 mock 模式。revalidatePath 在非 Next.js render/action 情境（這裡是 vitest）呼叫會丟
// 'static generation store missing'，跟 entries-actions.test.ts 一樣整個 mock 掉。
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/session", () => ({ getAccess: vi.fn() }));
import { getAccess } from "@/server/session";
const mockGetAccess = vi.mocked(getAccess);

const mockInspectUploaded = vi.fn();
const mockDeleteObject = vi.fn();
vi.mock("@/server/r2", () => ({
  inspectUploaded: (...args: unknown[]) => mockInspectUploaded(...args),
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
}));

const SEMESTER_NAME = "115-1";
const NOT_FOUND = "找不到這筆繳交";
const UPLOAD_FAILED = "檔案沒有上傳成功，請重新選擇 PDF";
const LOCKED_ERROR = "已超過 2 小時，已鎖定不能修改";
const ENDED_ERROR = "這場比賽已經結束，不能再上傳";
const STAGE_ACTIVE_ERROR = "這個階段已經交了，等審核結果或被退回後再重交";

function asOfficer(semesterId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "off@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "m2", semesterId, email: "off@g.nccu.edu.tw", name: "其他幹部", role: "officer", groupId: null },
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

async function issueTicket(key: string, issuerEmail: string) {
  const db = createServiceSupabase();
  const { error } = await db.from("upload_tickets").insert({ key, issuer_email: issuerEmail });
  if (error) throw error;
}

function pdfKey(groupId: string, suffix: string) {
  return `${SEMESTER_NAME}/${groupId}/${suffix}.pdf`;
}

async function submissionsFor(lineId: string) {
  const db = createServiceSupabase();
  const { data, error } = await db.from("stage_submissions").select("*").eq("line_id", lineId).order("version");
  if (error) throw error;
  return data;
}

describe("submitStage", () => {
  beforeEach(async () => {
    mockInspectUploaded.mockReset();
    mockDeleteObject.mockReset();
    mockDeleteObject.mockResolvedValue(undefined);
    await resetDb();
  });

  it("第一次送出：寫入版本 1，pending", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { entryId, lineId } = await confirmedEntry(seed.groupA, competition.id);
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const key = pdfKey(seed.groupA, "signup-v1");
    await issueTicket(key, "a1@g.nccu.edu.tw");

    const { submitStage } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key));

    expect(result.ok).toBe(true);
    const rows = await submissionsFor(lineId);
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(1);
    expect(rows[0].review_status).toBe("pending");
    expect(rows[0].pdf_key).toBe(key);
    expect(rows[0].submitted_by).toBe("a1@g.nccu.edu.tw");
  });

  it("該階段已有 pending 版本時再送出：回錯誤，不建立新版本，不刪已核發的物件", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { entryId, lineId } = await confirmedEntry(seed.groupA, competition.id);
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const key1 = pdfKey(seed.groupA, "signup-v1");
    await issueTicket(key1, "a1@g.nccu.edu.tw");
    const { submitStage } = await import("@/server/actions/stages");
    await asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key1));

    const key2 = pdfKey(seed.groupA, "signup-v2");
    await issueTicket(key2, "a1@g.nccu.edu.tw");
    const result = await asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key2));

    expect(result).toEqual({ ok: false, error: STAGE_ACTIVE_ERROR });
    const rows = await submissionsFor(lineId);
    expect(rows).toHaveLength(1);
  });

  it("被退回後可以重交，版本 +1", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { entryId, lineId } = await confirmedEntry(seed.groupA, competition.id);
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const key1 = pdfKey(seed.groupA, "signup-v1");
    await issueTicket(key1, "a1@g.nccu.edu.tw");
    const { submitStage } = await import("@/server/actions/stages");
    await asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key1));

    const db = createServiceSupabase();
    const { error: returnError } = await db
      .from("stage_submissions")
      .update({ review_status: "returned", reviewed_by: "pm@g.nccu.edu.tw", reviewed_at: new Date().toISOString(), comment: "格式不對" })
      .eq("line_id", lineId);
    if (returnError) throw returnError;

    const key2 = pdfKey(seed.groupA, "signup-v2");
    await issueTicket(key2, "a1@g.nccu.edu.tw");
    const result = await asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key2));

    expect(result.ok).toBe(true);
    const rows = await submissionsFor(lineId);
    expect(rows).toHaveLength(2);
    expect(rows[1].version).toBe(2);
    expect(rows[1].review_status).toBe("pending");
  });

  it("比賽線已結束（已退出）：回「這場比賽已經結束，不能再上傳」", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { entryId } = await confirmedEntry(seed.groupA, competition.id, {
      withdrawn_at: new Date().toISOString(),
    });
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const key = pdfKey(seed.groupA, "signup-v1");
    await issueTicket(key, "a1@g.nccu.edu.tw");
    const { submitStage } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key));

    expect(result).toEqual({ ok: false, error: ENDED_ERROR });
  });

  it("別組的學生：回統一的找不到這筆繳交", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { entryId } = await confirmedEntry(seed.groupA, competition.id);

    const key = pdfKey(seed.groupB, "signup-v1");
    await issueTicket(key, "b1@g.nccu.edu.tw");
    const { submitStage } = await import("@/server/actions/stages");
    const result = await asUser("b1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key));

    expect(result).toEqual({ ok: false, error: NOT_FOUND });
  });

  it("其他幹部：回統一的找不到這筆繳交", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { entryId } = await confirmedEntry(seed.groupA, competition.id);
    asOfficer(seed.semesterId);

    const key = pdfKey(seed.groupA, "signup-v1");
    const { submitStage } = await import("@/server/actions/stages");
    const result = await submitStage(entryId, "signup", key);

    expect(result).toEqual({ ok: false, error: NOT_FOUND });
  });

  it("上傳的檔案不是合法 PDF（inspectUploaded 失敗）：回上傳失敗，物件被刪除", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { entryId } = await confirmedEntry(seed.groupA, competition.id);
    mockInspectUploaded.mockResolvedValue(null);

    const key = pdfKey(seed.groupA, "signup-v1");
    await issueTicket(key, "a1@g.nccu.edu.tw");
    const { submitStage } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key));

    expect(result).toEqual({ ok: false, error: UPLOAD_FAILED });
    expect(mockDeleteObject).toHaveBeenCalledWith(key);
  });
});

describe("replaceStagePdf / withdrawStage：2 小時內可換／撤回，之後鎖定", () => {
  beforeEach(async () => {
    mockInspectUploaded.mockReset();
    mockDeleteObject.mockReset();
    mockDeleteObject.mockResolvedValue(undefined);
    await resetDb();
  });

  async function seedSubmission() {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { entryId, lineId } = await confirmedEntry(seed.groupA, competition.id);
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const key = pdfKey(seed.groupA, "signup-v1");
    await issueTicket(key, "a1@g.nccu.edu.tw");
    const { submitStage } = await import("@/server/actions/stages");
    await asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key));

    const rows = await submissionsFor(lineId);
    return { seed, entryId, lineId, submissionId: rows[0].id as string, originalKey: key };
  }

  it("2 小時內換 PDF 成功，版本不變，上傳時間更新，舊檔被刪", async () => {
    const { seed, submissionId, originalKey } = await seedSubmission();
    const newKey = pdfKey(seed.groupA, "signup-v1-new");
    await issueTicket(newKey, "a1@g.nccu.edu.tw");
    mockInspectUploaded.mockResolvedValue({ size: 4096, isPdf: true });

    const { replaceStagePdf } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => replaceStagePdf(submissionId, newKey));

    expect(result).toEqual({ ok: true });
    const db = createServiceSupabase();
    const { data: row } = await db.from("stage_submissions").select("*").eq("id", submissionId).single();
    expect(row!.pdf_key).toBe(newKey);
    expect(row!.version).toBe(1);
    expect(mockDeleteObject).toHaveBeenCalledWith(originalKey);
  });

  it("2 小時內撤回成功：整筆刪除，R2 物件被刪", async () => {
    const { submissionId, lineId, originalKey } = await seedSubmission();

    const { withdrawStage } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => withdrawStage(submissionId));

    expect(result).toEqual({ ok: true });
    const rows = await submissionsFor(lineId);
    expect(rows).toHaveLength(0);
    expect(mockDeleteObject).toHaveBeenCalledWith(originalKey);
  });

  it("超過 2 小時：換 PDF 回已鎖定，不刪舊檔，新上傳的孤兒物件會被刪", async () => {
    const { seed, submissionId, originalKey } = await seedSubmission();
    await backdateStageSubmissionUploadedAt(submissionId, new Date(Date.now() - 3 * 60 * 60 * 1000));

    const newKey = pdfKey(seed.groupA, "signup-v1-late");
    await issueTicket(newKey, "a1@g.nccu.edu.tw");
    mockInspectUploaded.mockResolvedValue({ size: 4096, isPdf: true });

    const { replaceStagePdf } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => replaceStagePdf(submissionId, newKey));

    expect(result).toEqual({ ok: false, error: LOCKED_ERROR });
    expect(mockDeleteObject).not.toHaveBeenCalledWith(originalKey);
  });

  it("超過 2 小時：撤回回已鎖定，資料庫列還在", async () => {
    const { submissionId, lineId } = await seedSubmission();
    await backdateStageSubmissionUploadedAt(submissionId, new Date(Date.now() - 3 * 60 * 60 * 1000));

    const { withdrawStage } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => withdrawStage(submissionId));

    expect(result).toEqual({ ok: false, error: LOCKED_ERROR });
    const rows = await submissionsFor(lineId);
    expect(rows).toHaveLength(1);
  });

  it("真實邊界：資料庫 trigger 本身也擋已鎖定的 update（即使應用層檢查被跳過）", async () => {
    const { submissionId } = await seedSubmission();
    await backdateStageSubmissionUploadedAt(submissionId, new Date(Date.now() - 3 * 60 * 60 * 1000));

    const db = createServiceSupabase();
    const { error } = await db.from("stage_submissions").update({ pdf_size: 999 }).eq("id", submissionId);
    expect(error).not.toBeNull();
    expect(error!.message).toContain("LOCKED");
  });

  it("真實邊界：資料庫 trigger 允許已鎖定的列只改 review 欄位（Task 6 審核用）", async () => {
    const { submissionId } = await seedSubmission();
    await backdateStageSubmissionUploadedAt(submissionId, new Date(Date.now() - 3 * 60 * 60 * 1000));

    const db = createServiceSupabase();
    const { error } = await db
      .from("stage_submissions")
      .update({ review_status: "approved", reviewed_by: "pm@g.nccu.edu.tw", reviewed_at: new Date().toISOString() })
      .eq("id", submissionId);
    expect(error).toBeNull();

    const { data: row } = await db.from("stage_submissions").select("review_status").eq("id", submissionId).single();
    expect(row!.review_status).toBe("approved");
  });

  it("真實邊界：資料庫 trigger 擋已鎖定的 delete（撤回）", async () => {
    const { submissionId } = await seedSubmission();
    await backdateStageSubmissionUploadedAt(submissionId, new Date(Date.now() - 3 * 60 * 60 * 1000));

    const db = createServiceSupabase();
    const { error } = await db.from("stage_submissions").delete().eq("id", submissionId);
    expect(error).not.toBeNull();
    expect(error!.message).toContain("LOCKED");
  });

  it("別組的學生：換 PDF／撤回都回統一的找不到這筆繳交", async () => {
    const { seed, submissionId } = await seedSubmission();
    const newKey = pdfKey(seed.groupB, "x");

    const { replaceStagePdf, withdrawStage } = await import("@/server/actions/stages");
    const r1 = await asUser("b1@g.nccu.edu.tw", () => replaceStagePdf(submissionId, newKey));
    expect(r1).toEqual({ ok: false, error: NOT_FOUND });

    const r2 = await asUser("b1@g.nccu.edu.tw", () => withdrawStage(submissionId));
    expect(r2).toEqual({ ok: false, error: NOT_FOUND });
  });
});

describe("stage_submissions 部分唯一索引：併發送出同一階段第一版", () => {
  beforeEach(async () => {
    mockInspectUploaded.mockReset();
    mockDeleteObject.mockReset();
    mockDeleteObject.mockResolvedValue(undefined);
    await resetDb();
  });

  // submit_stage() 裡的「有沒有 active 版本」檢查不是原子的（select 完、真的 insert 之前還有
  // 時間窗）；透過 supabase-js 打兩個「同時」的 RPC 沒辦法保證兩個請求的 select 真的會交錯
  // （常常一個請求整個跑完、commit 了，另一個才開始，這樣只會撞到 submit_stage() 裡自己的
  // stage_active 檢查，測不到部分唯一索引本身）。這裡直接用兩條 raw pg 連線各開一個交易，
  // 手動控制交錯順序：A 先插入一筆未 commit 的 pending 列，B 在同一個 (line_id, stage) 插入
  // 第二筆時會卡住（等 A 的交易結束，因為兩筆都命中同一個部分索引項），A commit 之後 B 才會
  // 真的撞到 unique_violation（23505）——這樣才是真的在測「部分唯一索引」這道最後防線，不是
  // submit_stage() 自己的應用層檢查。
  it("部分唯一索引擋住同一條線同一階段的兩筆 pending 版本（交錯的交易）", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);

    const host = new URL(env.supabaseUrl).hostname;
    const clientA = new PgClient({ host, port: 54322, user: "postgres", password: "postgres", database: "postgres" });
    const clientB = new PgClient({ host, port: 54322, user: "postgres", password: "postgres", database: "postgres" });
    await clientA.connect();
    await clientB.connect();

    try {
      await clientA.query("begin");
      await clientA.query(
        `insert into stage_submissions (line_id, stage, version, pdf_key, pdf_size, pdf_uploaded_at, pdf_uploaded_by, submitted_by)
         values ($1, 'signup', 1, $2, 100, now(), 'a1@g.nccu.edu.tw', 'a1@g.nccu.edu.tw')`,
        [lineId, pdfKey(seed.groupA, "race-a")]
      );

      await clientB.query("begin");
      const bInsert = clientB
        .query(
          `insert into stage_submissions (line_id, stage, version, pdf_key, pdf_size, pdf_uploaded_at, pdf_uploaded_by, submitted_by)
           values ($1, 'signup', 2, $2, 100, now(), 'a1@g.nccu.edu.tw', 'a1@g.nccu.edu.tw')`,
          [lineId, pdfKey(seed.groupA, "race-b")]
        )
        .then(() => ({ ok: true as const }))
        .catch((err: { code?: string }) => ({ ok: false as const, code: err.code }));

      // B 的 insert 現在應該卡在等 A 的交易結束（同一個部分索引項），還沒有結果。
      await new Promise((r) => setTimeout(r, 200));
      await clientA.query("commit");

      const bResult = await bInsert;
      expect(bResult).toEqual({ ok: false, code: "23505" });
      await clientB.query("rollback").catch(() => {});
    } finally {
      await clientA.end();
      await clientB.end();
    }

    const db = createServiceSupabase();
    const { data: rows } = await db.from("stage_submissions").select("*").eq("line_id", lineId);
    expect(rows).toHaveLength(1);
  });
});
