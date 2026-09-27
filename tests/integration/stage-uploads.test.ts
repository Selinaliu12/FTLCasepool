import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client as PgClient } from "pg";
import { resetDb, seedSemester, asUser, backdateStageSubmissionUploadedAt, withRawPg } from "./helpers";
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

    // fix round 1：review 欄位只能在鎖定之後改（NOT_LOCKED trigger，見
    // 20260927000016_stage_uploads_fix1.sql）——PM 審核一定是在學生的 2 小時修改窗關閉之後
    // 才會發生，這裡先把上傳時間往前搬，模擬「已經鎖定」。
    const db = createServiceSupabase();
    const rows0 = await submissionsFor(lineId);
    await backdateStageSubmissionUploadedAt(rows0[0].id as string, new Date(Date.now() - 3 * 60 * 60 * 1000));
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

  // fix round 1：安全鏈每一個分支都要有測試覆蓋，不能只靠「合法路徑」的測試間接帶到。
  // fix round 2：這四個測試原本沒有設 mockInspectUploaded——mockReset() 之後它預設回傳
  // undefined，如果字首檢查（stages.ts 的 prefix check）或票務檢查被誤刪，流程還是會走到
  // inspectUploaded → !inspected → deleteObject(pdfKey) → UPLOAD_FAILED，跟現在的結果一模一樣，
  // 測試測不出差別。這種情況下被刪的 pdfKey 很可能是「別人的物件」（字首不對／票是別人的），
  // 正是這兩道檢查要防止的傷害。這裡明確讓 inspectUploaded 回傳「合法 PDF」，並斷言
  // deleteObject 完全沒被呼叫——如果檢查被拿掉，流程會走到 RPC 那一步（字首/票務不是
  // RPC 檢查的東西），至少不會再是「刪掉別人的物件」這種結果被誤判成通過。
  it("字首不對（不是這組的 key）：回上傳失敗，不會去動這個物件", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { entryId } = await confirmedEntry(seed.groupA, competition.id);
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const key = pdfKey(seed.groupB, "signup-v1"); // 別組的字首
    await issueTicket(key, "a1@g.nccu.edu.tw");
    const { submitStage } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key));

    expect(result).toEqual({ ok: false, error: UPLOAD_FAILED });
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("票是別人申請的：回上傳失敗，不會去動這個物件", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { entryId } = await confirmedEntry(seed.groupA, competition.id);
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const key = pdfKey(seed.groupA, "signup-v1");
    await issueTicket(key, "a2@g.nccu.edu.tw"); // 同組但另一個人申請的票
    const { submitStage } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key));

    expect(result).toEqual({ ok: false, error: UPLOAD_FAILED });
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("票已經被用過：回上傳失敗，不會去動這個物件", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { entryId } = await confirmedEntry(seed.groupA, competition.id);
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const key = pdfKey(seed.groupA, "signup-v1");
    await issueTicket(key, "a1@g.nccu.edu.tw");
    const db = createServiceSupabase();
    const { error } = await db.from("upload_tickets").update({ used_at: new Date().toISOString() }).eq("key", key);
    if (error) throw error;

    const { submitStage } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key));

    expect(result).toEqual({ ok: false, error: UPLOAD_FAILED });
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("沒有核發過票的 key：回上傳失敗，不會去動這個物件", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { entryId } = await confirmedEntry(seed.groupA, competition.id);
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const key = pdfKey(seed.groupA, "signup-v1"); // 沒呼叫 issueTicket
    const { submitStage } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key));

    expect(result).toEqual({ ok: false, error: UPLOAD_FAILED });
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("階段代碼不合法：回統一的找不到這筆繳交", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { entryId } = await confirmedEntry(seed.groupA, competition.id);

    const key = pdfKey(seed.groupA, "x");
    const { submitStage } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "not-a-stage", key));

    expect(result).toEqual({ ok: false, error: NOT_FOUND });
  });

  it("還沒按我已了解：回請先閱讀並同意使用說明", async () => {
    const seed = await seedSemester({ acknowledged: false });
    const competition = await createCompetition(seed.semesterId);
    const { entryId } = await confirmedEntry(seed.groupA, competition.id);

    const key = pdfKey(seed.groupA, "signup-v1");
    await issueTicket(key, "a1@g.nccu.edu.tw");
    const { submitStage } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key));

    expect(result).toEqual({ ok: false, error: "請先閱讀並同意使用說明" });
  });

  it("已結束（result=not_selected）：回「這場比賽已經結束，不能再上傳」", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { entryId } = await confirmedEntry(seed.groupA, competition.id, { result: "not_selected" });

    const key = pdfKey(seed.groupA, "signup-v1");
    await issueTicket(key, "a1@g.nccu.edu.tw");
    const { submitStage } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key));

    expect(result).toEqual({ ok: false, error: ENDED_ERROR });
  });

  // fix round 2：submitStage() 本身在呼叫 RPC 之前已經先用 loadLineForEntry() 擋過一次已結束
  // 的線，所以透過 submitStage() 永遠測不到 submit_stage() RPC 自己的 ended 再檢查（見
  // 20260927000016_stage_uploads_fix1.sql）——那道防線只在「TS 檢查完、RPC 真的執行之前，線
  // 剛好被結束」這個時間窗才會被用到。這裡直接用 service client 呼叫 RPC，繞過 TS 層，單獨
  // 驗證 RPC 這道防線真的存在、真的擋下來。
  it("RPC 層：直接呼叫 submit_stage() 在已結束的線上，擋下來（不是靠應用層先擋）", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id, {
      withdrawn_at: new Date().toISOString(),
    });

    const key = pdfKey(seed.groupA, "rpc-level-ended");
    await issueTicket(key, "a1@g.nccu.edu.tw");

    const db = createServiceSupabase();
    const { error } = await db.rpc("submit_stage", {
      p_line_id: lineId,
      p_stage: "signup",
      p_key: key,
      p_size: 100,
      p_by: "a1@g.nccu.edu.tw",
      p_ticket: "a1@g.nccu.edu.tw",
    });

    expect(error).not.toBeNull();
    expect(error!.message).toBe("ended");

    // 票沒被用掉——ended 檢查在票務 claim 之前，RPC 整個回滾。
    const { data: ticket } = await db.from("upload_tickets").select("used_at").eq("key", key).single();
    expect(ticket!.used_at).toBeNull();
  });

  it("已有 approved 版本時再送出：回這個階段已經交了", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { entryId, lineId } = await confirmedEntry(seed.groupA, competition.id);
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const key1 = pdfKey(seed.groupA, "signup-v1");
    await issueTicket(key1, "a1@g.nccu.edu.tw");
    const { submitStage } = await import("@/server/actions/stages");
    await asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key1));

    const db = createServiceSupabase();
    const rows0 = await submissionsFor(lineId);
    await backdateStageSubmissionUploadedAt(rows0[0].id as string, new Date(Date.now() - 3 * 60 * 60 * 1000));
    const { error } = await db
      .from("stage_submissions")
      .update({ review_status: "approved", reviewed_by: "pm@g.nccu.edu.tw", reviewed_at: new Date().toISOString() })
      .eq("line_id", lineId);
    if (error) throw error;

    const key2 = pdfKey(seed.groupA, "signup-v2");
    await issueTicket(key2, "a1@g.nccu.edu.tw");
    const result = await asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key2));

    expect(result).toEqual({ ok: false, error: STAGE_ACTIVE_ERROR });
  });

  // fix round 2：不要用固定的 sleep 賭 submitStage() 的 insert「應該」已經卡住——直接從另一條
  // 監控連線的 pg_stat_activity 輪詢，等到真的看到一個 active 連線的查詢正在等鎖
  // （wait_event_type = 'Lock'），才確定 submitStage() 真的卡在我們要它卡住的地方，再 commit
  // clientA。submitStage() 是透過 PostgREST／supabase-js 呼叫 submit_stage() 這個 RPC，
  // pg_stat_activity 看到的查詢文字是最外層送進來的那句（呼叫 RPC 本身，例如
  // "select * from submit_stage(...)"），不是 plpgsql 函式內部真正卡住的那句
  // insert——所以比對條件用 submit_stage，不是 insert into stage_submissions（用 debug
  // script 實際跑過一次確認過這個查詢文字長什麼樣子）。輪詢間隔很短（10ms），有明確的逾時
  // （5 秒）會讓測試本身失敗，不會無窮等待。
  async function waitUntilBlockedOnInsert(): Promise<void> {
    const host = new URL(env.supabaseUrl).hostname;
    const monitor = new PgClient({ host, port: 54322, user: "postgres", password: "postgres", database: "postgres" });
    await monitor.connect();
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const { rows } = await monitor.query(
          `select count(*)::int as n from pg_stat_activity
           where state = 'active' and wait_event_type = 'Lock'
             and query ilike '%submit_stage%'`
        );
        if (rows[0].n > 0) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error("等不到 submitStage() 卡在鎖上——測試環境跟預期的交錯順序不一樣");
    } finally {
      await monitor.end();
    }
  }

  // fix round 1（controller ruling 2）：走真正的 23505 路徑（部分唯一索引），不是
  // submit_stage() 自己的應用層 stage_active 檢查——用一條 raw pg 連線先插入一筆未 commit 的
  // pending 列卡住同一個索引項，讓 submitStage() 自己的 insert 卡住、之後真的撞到
  // unique_violation，驗證這時候 pdfKey（已經證明是呼叫者自己申請、還沒用掉的票）真的被刪掉。
  it("撞到部分唯一索引（23505）：物件被刪除，回這個階段已經交了", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const competition = await createCompetition(seed.semesterId);
    const { entryId, lineId } = await confirmedEntry(seed.groupA, competition.id);
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const key = pdfKey(seed.groupA, "race-app");
    await issueTicket(key, "a1@g.nccu.edu.tw");

    const host = new URL(env.supabaseUrl).hostname;
    const clientA = new PgClient({ host, port: 54322, user: "postgres", password: "postgres", database: "postgres" });
    await clientA.connect();

    try {
      await clientA.query("begin");
      await clientA.query(
        `insert into stage_submissions (line_id, stage, version, pdf_key, pdf_size, pdf_uploaded_at, pdf_uploaded_by, submitted_by)
         values ($1, 'signup', 1, $2, 100, now(), 'a1@g.nccu.edu.tw', 'a1@g.nccu.edu.tw')`,
        [lineId, pdfKey(seed.groupA, "race-a-held")]
      );

      const { submitStage } = await import("@/server/actions/stages");
      const resultPromise = asUser("a1@g.nccu.edu.tw", () => submitStage(entryId, "signup", key));

      // 用真正觀察到的「submitStage 的 insert 正卡在鎖上」取代固定的 200ms sleep——不會有
      // 「機器比較慢時 200ms 不夠、submitStage 根本還沒跑到 insert 就先 commit 了」這種偶發
      // 失敗（那樣會讓這個測試退化成只測到應用層的 stage_active 檢查，不是真的部分唯一索引）。
      await waitUntilBlockedOnInsert();
      await clientA.query("commit");

      const result = await resultPromise;
      expect(result).toEqual({ ok: false, error: STAGE_ACTIVE_ERROR });
      expect(mockDeleteObject).toHaveBeenCalledWith(key);
    } finally {
      await clientA.end();
    }
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
    expect(error!.message).toBe("LOCKED");
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
    expect(error!.message).toBe("LOCKED");
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

  // fix round 1：換 PDF 的安全鏈也要每個分支都覆蓋，不能只靠 submitStage 那邊的測試帶過。
  // fix round 2：同一個理由——安全鏈檢查失敗時，不該去刪任何物件（原本的舊物件，或這次
  // pdfKey 指到的新物件），不管新舊都不是「已經證明屬於呼叫者、確定沒用上」的孤兒。
  it("換 PDF：字首不對，回上傳失敗，不會去動任何物件", async () => {
    const { seed, submissionId } = await seedSubmission();
    const newKey = pdfKey(seed.groupB, "wrong-prefix");
    await issueTicket(newKey, "a1@g.nccu.edu.tw");

    const { replaceStagePdf } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => replaceStagePdf(submissionId, newKey));

    expect(result).toEqual({ ok: false, error: UPLOAD_FAILED });
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("換 PDF：票是別人申請的，回上傳失敗，不會去動任何物件", async () => {
    const { seed, submissionId } = await seedSubmission();
    const newKey = pdfKey(seed.groupA, "someone-elses-ticket");
    await issueTicket(newKey, "a2@g.nccu.edu.tw");

    const { replaceStagePdf } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => replaceStagePdf(submissionId, newKey));

    expect(result).toEqual({ ok: false, error: UPLOAD_FAILED });
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("換 PDF：票已經被用過，回上傳失敗，不會去動任何物件", async () => {
    const { seed, submissionId } = await seedSubmission();
    const newKey = pdfKey(seed.groupA, "used-ticket");
    await issueTicket(newKey, "a1@g.nccu.edu.tw");
    const db = createServiceSupabase();
    const { error } = await db.from("upload_tickets").update({ used_at: new Date().toISOString() }).eq("key", newKey);
    if (error) throw error;

    const { replaceStagePdf } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => replaceStagePdf(submissionId, newKey));

    expect(result).toEqual({ ok: false, error: UPLOAD_FAILED });
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("換 PDF：沒有核發過票的 key，回上傳失敗，不會去動任何物件", async () => {
    const { seed, submissionId } = await seedSubmission();
    const newKey = pdfKey(seed.groupA, "no-ticket");

    const { replaceStagePdf } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => replaceStagePdf(submissionId, newKey));

    expect(result).toEqual({ ok: false, error: UPLOAD_FAILED });
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("換 PDF：還沒按我已了解，回請先閱讀並同意使用說明", async () => {
    // seedSubmission() 內部已經用 acknowledged:true 的種子交過一版；這裡直接把 access 換成
    // 一個沒按過的假身分，不重新造資料——acknowledgementRequired 只看 email／semesterId。
    const { seed, submissionId } = await seedSubmission();
    const db = createServiceSupabase();
    const { error } = await db.from("acknowledgements").delete().eq("semester_id", seed.semesterId).eq("email", "a1@g.nccu.edu.tw");
    if (error) throw error;

    const newKey = pdfKey(seed.groupA, "unacked");
    await issueTicket(newKey, "a1@g.nccu.edu.tw");
    const { replaceStagePdf } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => replaceStagePdf(submissionId, newKey));

    expect(result).toEqual({ ok: false, error: "請先閱讀並同意使用說明" });
  });

  it("換 PDF：線已結束（result=awarded），回「這場比賽已經結束，不能再上傳」", async () => {
    const { seed, entryId, submissionId } = await seedSubmission();
    const db = createServiceSupabase();
    const { error } = await db.from("competition_entries").update({ result: "awarded" }).eq("id", entryId);
    if (error) throw error;

    const newKey = pdfKey(seed.groupA, "ended-replace");
    await issueTicket(newKey, "a1@g.nccu.edu.tw");
    const { replaceStagePdf } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => replaceStagePdf(submissionId, newKey));

    expect(result).toEqual({ ok: false, error: ENDED_ERROR });
  });

  // fix round 2：同樣的理由——replaceStagePdf() 已經先用 loadOwnedSubmission() 擋過一次已結束
  // 的線，直接呼叫 replace_stage_pdf() RPC 才能單獨驗證 RPC 自己的 ended 再檢查。
  it("RPC 層：直接呼叫 replace_stage_pdf() 在已結束的線上，擋下來（不是靠應用層先擋）", async () => {
    const { seed, entryId, submissionId, originalKey } = await seedSubmission();
    const db = createServiceSupabase();
    const { error: entryError } = await db.from("competition_entries").update({ result: "awarded" }).eq("id", entryId);
    if (entryError) throw entryError;

    const newKey = pdfKey(seed.groupA, "rpc-level-ended-replace");
    await issueTicket(newKey, "a1@g.nccu.edu.tw");

    const { error } = await db.rpc("replace_stage_pdf", {
      p_submission_id: submissionId,
      p_old_key: originalKey,
      p_new_key: newKey,
      p_size: 100,
      p_by: "a1@g.nccu.edu.tw",
      p_ticket: "a1@g.nccu.edu.tw",
    });

    expect(error).not.toBeNull();
    expect(error!.message).toBe("ended");

    const { data: ticket } = await db.from("upload_tickets").select("used_at").eq("key", newKey).single();
    expect(ticket!.used_at).toBeNull();
    const { data: row } = await db.from("stage_submissions").select("pdf_key").eq("id", submissionId).single();
    expect(row!.pdf_key).toBe(originalKey);
  });

  // fix round 1（controller ruling 2，stale write）：跟 progress-lock.test.ts 的 stale-write
  // 測試同一套手法——用一個可以手動控制的 gate 卡住 a1 的 inspectUploaded，讓 a2 先完整換檔
  // 成功，再放行 a1，保證 a1 手上的 p_old_key 真的跟資料庫「這一刻」的值不一樣。
  it("兩個組員幾乎同時換檔同一筆繳交 → 較晚打 RPC 的那個因為 pdf_key 被搶先改過而被拒（stale write）", async () => {
    const { seed, submissionId, originalKey } = await seedSubmission();

    const keyA = pdfKey(seed.groupA, "stale-race-a");
    const keyB = pdfKey(seed.groupA, "stale-race-b");
    await issueTicket(keyA, "a1@g.nccu.edu.tw");
    await issueTicket(keyB, "a2@g.nccu.edu.tw");

    let releaseA: ((v: { size: number; isPdf: boolean }) => void) | undefined;
    const aGate = new Promise<{ size: number; isPdf: boolean }>((resolve) => {
      releaseA = resolve;
    });
    mockInspectUploaded.mockImplementation((key: string) =>
      key === keyA ? aGate : Promise.resolve({ size: 2048, isPdf: true })
    );

    const { replaceStagePdf } = await import("@/server/actions/stages");
    const pA = asUser("a1@g.nccu.edu.tw", () => replaceStagePdf(submissionId, keyA));
    await new Promise((resolve) => setTimeout(resolve, 100));

    const rB = await asUser("a2@g.nccu.edu.tw", () => replaceStagePdf(submissionId, keyB));
    expect(rB).toEqual({ ok: true });

    releaseA!({ size: 2048, isPdf: true });
    const rA = await pA;

    expect(rA).toEqual({ ok: false, error: "這個階段的繳交剛剛被組員改過，請重新整理" });

    const db = createServiceSupabase();
    const { data: finalRow } = await db.from("stage_submissions").select("pdf_key").eq("id", submissionId).single();
    expect(finalRow!.pdf_key).toBe(keyB);

    expect(mockDeleteObject).toHaveBeenCalledWith(originalKey);
    expect(mockDeleteObject).not.toHaveBeenCalledWith(keyB);
    expect(mockDeleteObject).toHaveBeenCalledWith(keyA);
  });

  // controller ruling 5（fix round 1）：撤回跟提交／換檔不同——即使線已經結束，pending、還沒
  // 鎖定的版本還是可以撤回，不然會卡著一筆永遠不會被審的東西。
  it("撤回：線已結束但這一版還是 pending、還沒鎖定 → 仍然允許撤回", async () => {
    const { entryId, lineId, submissionId, originalKey } = await seedSubmission();
    const db = createServiceSupabase();
    const { error } = await db.from("competition_entries").update({ withdrawn_at: new Date().toISOString() }).eq("id", entryId);
    if (error) throw error;

    const { withdrawStage } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => withdrawStage(submissionId));

    expect(result).toEqual({ ok: true });
    const rows = await submissionsFor(lineId);
    expect(rows).toHaveLength(0);
    expect(mockDeleteObject).toHaveBeenCalledWith(originalKey);
  });

  // fix round 1（controller ruling 4）：replace_stage_pdf／withdraw_stage 只能動目前
  // review_status = 'pending' 的那一列；已經通過的版本不能再換檔或撤回。
  //
  // 在真實流程裡，review 欄位只能在鎖定之後改（NOT_LOCKED trigger），所以「approved」的列
  // 100% 也是「locked」的——如果透過 backdate 造出這種資料，replaceStagePdf／withdrawStage
  // 會被應用層自己的 isLocked() 先擋下來（回 LOCKED_ERROR），測不到 RPC 這裡的
  // 「非 pending 一律 submission_not_found」這件事。這裡直接用 raw pg 連線＋
  // session_replication_role = replica 繞過 trigger，造一筆「approved 但還沒鎖定」的資料
  // （現實中不會出現，純粹為了單獨驗證這道 DB 防線），確認 RPC 真的是看 review_status，
  // 不是靠鎖定狀態間接擋下來的。
  async function forceReviewStatusBypassingLock(submissionId: string, status: string) {
    await withRawPg(async (client) => {
      await client.query("set session_replication_role = replica");
      await client.query(
        "update stage_submissions set review_status = $1, reviewed_by = 'pm@g.nccu.edu.tw', reviewed_at = now() where id = $2",
        [status, submissionId]
      );
    });
  }

  it("換 PDF：這一版已經通過審核（approved），回統一的找不到這筆繳交", async () => {
    const { seed, submissionId } = await seedSubmission();
    await forceReviewStatusBypassingLock(submissionId, "approved");

    const newKey = pdfKey(seed.groupA, "after-approved");
    await issueTicket(newKey, "a1@g.nccu.edu.tw");
    const { replaceStagePdf } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => replaceStagePdf(submissionId, newKey));

    expect(result).toEqual({ ok: false, error: NOT_FOUND });
  });

  it("撤回：這一版已經通過審核（approved），回統一的找不到這筆繳交", async () => {
    const { submissionId, lineId } = await seedSubmission();
    await forceReviewStatusBypassingLock(submissionId, "approved");

    const { withdrawStage } = await import("@/server/actions/stages");
    const result = await asUser("a1@g.nccu.edu.tw", () => withdrawStage(submissionId));

    expect(result).toEqual({ ok: false, error: NOT_FOUND });
    const rows = await submissionsFor(lineId);
    expect(rows).toHaveLength(1);
  });

  // fix round 1（NOT_LOCKED，另一個方向）：review 欄位只能在鎖定之後改，還沒鎖定就想改
  // （PM 手滑、或未來某個 bug 想提早審核）要被資料庫擋下來。
  it("真實邊界：資料庫 trigger 擋還沒鎖定就想改 review 欄位（NOT_LOCKED）", async () => {
    const { submissionId } = await seedSubmission();

    const db = createServiceSupabase();
    const { error } = await db
      .from("stage_submissions")
      .update({ review_status: "approved", reviewed_by: "pm@g.nccu.edu.tw", reviewed_at: new Date().toISOString() })
      .eq("id", submissionId);
    expect(error).not.toBeNull();
    expect(error!.message).toContain("NOT_LOCKED");

    const { data: row } = await db.from("stage_submissions").select("review_status").eq("id", submissionId).single();
    expect(row!.review_status).toBe("pending");
  });

  // controller ruling（fix round 1 #10）：一次 UPDATE 同時改到 review 欄位＋pdf_key，已鎖定的
  // 列上要整個被擋（LOCKED），不能因為也改了 review 欄位就走進 review-only 那個允許分支。
  it("真實邊界：已鎖定的列，單一 UPDATE 同時改 review 欄位＋pdf_key → LOCKED", async () => {
    const { submissionId } = await seedSubmission();
    await backdateStageSubmissionUploadedAt(submissionId, new Date(Date.now() - 3 * 60 * 60 * 1000));

    const db = createServiceSupabase();
    const { error } = await db
      .from("stage_submissions")
      .update({ review_status: "approved", pdf_key: "somewhere/else.pdf" })
      .eq("id", submissionId);
    expect(error).not.toBeNull();
    expect(error!.message).toBe("LOCKED");

    const { data: row } = await db.from("stage_submissions").select("review_status, pdf_key").eq("id", submissionId).single();
    expect(row!.review_status).toBe("pending");
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
