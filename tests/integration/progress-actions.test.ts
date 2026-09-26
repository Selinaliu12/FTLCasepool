import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester, asUser } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

// submitProgress 一律先呼叫 getAccess()；跟 upload.test.ts 一樣用 vi.mock 假造
// @/server/session，讓每個測試自己決定呼叫者是誰。asUser()（helpers.ts）需要直接拿到
// 這顆被 mock 過的 getAccess 本身（不是另一層包裝的箭頭函式），才能在併發測試裡把它的
// 回傳值換成不同人的身分。
vi.mock("@/server/session", () => ({ getAccess: vi.fn() }));
import { getAccess } from "@/server/session";
const mockGetAccess = vi.mocked(getAccess);

// inspectUploaded／deleteObject 在 r2.contract.test.ts 已經對真實端點驗證過；這裡只驗證
// submitProgress 根據它們的回傳值做出的判斷，所以整個 mock 掉，不用真的打 S3。
const mockInspectUploaded = vi.fn();
const mockDeleteObject = vi.fn();
vi.mock("@/server/r2", () => ({
  inspectUploaded: (...args: unknown[]) => mockInspectUploaded(...args),
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
}));

const SEMESTER_NAME = "115-1"; // 跟 seedSemester() 建立的學期名稱一致
const UPLOAD_FAILED = "檔案沒有上傳成功，請重新選擇 PDF";

function asStudent(semesterId: string, groupId: string, email = "a1@g.nccu.edu.tw", name = "甲一") {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email,
    isAdmin: false,
    member: { id: "m1", semesterId, email, name, role: "student", groupId },
    semesterId,
  });
}

function asOfficer(semesterId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "off@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "m2", semesterId, email: "off@g.nccu.edu.tw", name: "其他幹部", role: "officer", groupId: null },
    semesterId,
  });
}

function asNotInRoster() {
  mockGetAccess.mockResolvedValue({ kind: "not_in_roster" });
}

function goodInput(groupId: string, keySuffix: string) {
  return {
    light: "green" as const,
    did: "完成初版介面",
    blocked: "沒有卡關",
    nextSteps: "下週開始測試",
    pdfKey: `${SEMESTER_NAME}/${groupId}/${keySuffix}.pdf`,
  };
}

// requestPdfUpload() 在核發 key 的同時會留一張票（見 upload.ts、
// supabase/migrations/20260927000006_upload_tickets.sql）。這裡直接用 service client 造票，
// 不用真的先跑一次 requestPdfUpload——upload.test.ts 已經驗證過那條路徑會留票；這裡只關心
// submitProgress 怎麼「用」這張票。
async function issueTicket(key: string, issuerEmail: string) {
  const db = createServiceSupabase();
  const { error } = await db.from("upload_tickets").insert({ key, issuer_email: issuerEmail });
  if (error) throw error;
}

async function reportsFor(lineId: string, periodId: string) {
  const db = createServiceSupabase();
  const { data, error } = await db.from("progress_reports").select("*").eq("line_id", lineId).eq("period_id", periodId);
  if (error) throw error;
  return data;
}

describe("submitProgress", () => {
  beforeEach(async () => {
    mockInspectUploaded.mockReset();
    mockDeleteObject.mockReset();
    mockDeleteObject.mockResolvedValue(undefined);
    await resetDb();
  });

  it("寫入一筆，繳交時間 = R2 確認後的時間，submitted_by 是送出者", async () => {
    const seed = await seedSemester({ acknowledged: true });
    asStudent(seed.semesterId, seed.groupA);
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const input = goodInput(seed.groupA, "a");
    await issueTicket(input.pdfKey, "a1@g.nccu.edu.tw");

    const { submitProgress } = await import("@/server/actions/progress");
    const before = new Date();
    const result = await submitProgress(seed.periodIds[1], input);
    const after = new Date();

    expect(result).toEqual({ ok: true });

    const db = createServiceSupabase();
    const { data: row, error } = await db
      .from("progress_reports")
      .select("*")
      .eq("line_id", seed.lineA)
      .eq("period_id", seed.periodIds[1])
      .single();
    if (error) throw error;

    expect(row.submitted_by).toBe("a1@g.nccu.edu.tw");
    expect(row.pdf_uploaded_by).toBe("a1@g.nccu.edu.tw");
    expect(row.pdf_size).toBe(2048);
    const uploadedAt = new Date(row.pdf_uploaded_at).getTime();
    expect(uploadedAt).toBeGreaterThanOrEqual(before.getTime());
    expect(uploadedAt).toBeLessThanOrEqual(after.getTime());

    // 票被標記用掉。
    const { data: ticket, error: ticketError } = await db
      .from("upload_tickets")
      .select("used_at")
      .eq("key", input.pdfKey)
      .single();
    if (ticketError) throw ticketError;
    expect(ticket.used_at).not.toBeNull();
  });

  it("R2 上沒有檔案 → 回傳「檔案沒有上傳成功，請重新選擇 PDF」、不寫入、刪掉物件", async () => {
    const seed = await seedSemester({ acknowledged: true });
    asStudent(seed.semesterId, seed.groupA);
    mockInspectUploaded.mockResolvedValue(null);

    const input = goodInput(seed.groupA, "b");
    await issueTicket(input.pdfKey, "a1@g.nccu.edu.tw");

    const { submitProgress } = await import("@/server/actions/progress");
    const result = await submitProgress(seed.periodIds[1], input);

    expect(result).toEqual({ ok: false, error: UPLOAD_FAILED });
    expect(mockDeleteObject).toHaveBeenCalledWith(input.pdfKey);
    expect(await reportsFor(seed.lineA, seed.periodIds[1])).toHaveLength(0);
  });

  it("檔頭不是 PDF → 同一句錯誤訊息、不寫入", async () => {
    const seed = await seedSemester({ acknowledged: true });
    asStudent(seed.semesterId, seed.groupA);
    mockInspectUploaded.mockResolvedValue({ size: 100, isPdf: false });

    const input = goodInput(seed.groupA, "c");
    await issueTicket(input.pdfKey, "a1@g.nccu.edu.tw");

    const { submitProgress } = await import("@/server/actions/progress");
    const result = await submitProgress(seed.periodIds[1], input);

    expect(result).toEqual({ ok: false, error: UPLOAD_FAILED });
    expect(mockDeleteObject).toHaveBeenCalledWith(input.pdfKey);
  });

  it("別組的合法專案生交自己組的期別 → 成功，且不會誤寫進別組的期別", async () => {
    const seed = await seedSemester({ acknowledged: true });
    // b1 是第2組的人，自己申請、自己用自己的票，交自己組的期別。
    asStudent(seed.semesterId, seed.groupB, "b1@g.nccu.edu.tw", "乙一");
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const input = goodInput(seed.groupB, "d");
    await issueTicket(input.pdfKey, "b1@g.nccu.edu.tw");

    const { submitProgress } = await import("@/server/actions/progress");
    const result = await submitProgress(seed.periodIds[1], input);

    expect(result).toEqual({ ok: true });
    // 這筆寫進第2組的線，不會混進第1組。
    expect(await reportsFor(seed.lineA, seed.periodIds[1])).toHaveLength(0);
  });

  it("幹部（非專案生）送出 → 被拒，收到『只有專案生可以交進度』", async () => {
    const seed = await seedSemester({ acknowledged: true });
    asOfficer(seed.semesterId);

    const { submitProgress } = await import("@/server/actions/progress");
    const result = await submitProgress(seed.periodIds[1], goodInput(seed.groupA, "e"));

    expect(result).toEqual({ ok: false, error: "只有專案生可以交進度" });
    expect(mockInspectUploaded).not.toHaveBeenCalled();
  });

  it("不在名單上的人（not_in_roster）送出 → 被拒，收到『只有專案生可以交進度』", async () => {
    const seed = await seedSemester({ acknowledged: true });
    asNotInRoster();

    const { submitProgress } = await import("@/server/actions/progress");
    const result = await submitProgress(seed.periodIds[1], goodInput(seed.groupA, "f"));

    expect(result).toEqual({ ok: false, error: "只有專案生可以交進度" });
  });

  it("period 屬於別的（非目前）學期 → 『找不到這一期』", async () => {
    const seed = await seedSemester({ acknowledged: true });
    asStudent(seed.semesterId, seed.groupA);

    // 另外造一個「不是目前學期」的學期跟期別。
    const db = createServiceSupabase();
    const { data: otherSemester, error: semError } = await db
      .from("semesters")
      .insert({ name: "114-2", is_current: false })
      .select()
      .single();
    if (semError) throw semError;
    const { data: otherPeriod, error: periodError } = await db
      .from("periods")
      .insert({ semester_id: otherSemester.id, seq: 1, deadline: "2025-01-01T00:00:00Z" })
      .select()
      .single();
    if (periodError) throw periodError;

    const { submitProgress } = await import("@/server/actions/progress");
    const result = await submitProgress(otherPeriod.id, goodInput(seed.groupA, "g"));

    expect(result).toEqual({ ok: false, error: "找不到這一期" });
    expect(mockInspectUploaded).not.toHaveBeenCalled();
  });

  it("key 的字首是舊組別的（換組後，票本身還合法未用）→『檔案沒有上傳成功』，不呼叫 inspectUploaded／deleteObject／不寫入", async () => {
    // Fix round 1 的舊版這個測試不會咬：拿一把 b1 從沒申請過的 key，字首檢查跟票務檢查
    // （b1 不是這張票的 issuer）同時會擋下來，關掉字首檢查測試照樣綠，殺不死那個 mutant。
    // 這裡改成模擬真實情境——moveMember()（admin.ts）可以把一個專案生換到別組，換組當下
    // 完全不會去動這個人手上還沒用掉的票：票對這個人來說仍然合法（issuer_email 是自己、
    // used_at 是 null），字首卻還停在舊組別。這種情況下，**只有**字首檢查能擋下來。
    const seed = await seedSemester({ acknowledged: true });

    // a1 一開始真的在第1組（seedSemester() 種的），申請了一把字首是第1組的 key。
    asStudent(seed.semesterId, seed.groupA, "a1@g.nccu.edu.tw", "甲一");
    const input = goodInput(seed.groupA, "moved");
    await issueTicket(input.pdfKey, "a1@g.nccu.edu.tw");

    // 幹部把 a1 換到第2組（直接改 members.group_id，等同 moveMember() 實際做的事——
    // moveMember() 本身要先過 requireAdmin()，這裡不用另外借一套 admin mock 身分）。
    const db = createServiceSupabase();
    const { data: member, error: memberError } = await db
      .from("members")
      .select("id")
      .eq("semester_id", seed.semesterId)
      .eq("email", "a1@g.nccu.edu.tw")
      .single();
    if (memberError) throw memberError;
    const { error: moveError } = await db.from("members").update({ group_id: seed.groupB }).eq("id", member.id);
    if (moveError) throw moveError;

    // 如果字首檢查沒擋下來，票務檢查會過（票是 a1 自己的、還沒用）、inspect 也會過——
    // 讓 inspect 回傳合法結果，才能真正驗到「沒有字首檢查會一路寫進第2組的線」。
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    // access 反映換組後的狀態：現在是第2組。
    asStudent(seed.semesterId, seed.groupB, "a1@g.nccu.edu.tw", "甲一");

    const { submitProgress } = await import("@/server/actions/progress");
    const result = await submitProgress(seed.periodIds[1], input);

    expect(result).toEqual({ ok: false, error: UPLOAD_FAILED });
    expect(mockInspectUploaded).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(await reportsFor(seed.lineA, seed.periodIds[1])).toHaveLength(0);
    expect(await reportsFor(seed.lineB, seed.periodIds[1])).toHaveLength(0);
  });

  it("情境 A：A2 重放 A1 已經交出去的 key → A1 的報告與檔案不受影響，A2 收到錯誤", async () => {
    const seed = await seedSemester({ acknowledged: true });
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const key = goodInput(seed.groupA, "shared").pdfKey;
    await issueTicket(key, "a1@g.nccu.edu.tw");

    const { submitProgress } = await import("@/server/actions/progress");

    // A1 先合法交出去。
    asStudent(seed.semesterId, seed.groupA, "a1@g.nccu.edu.tw", "甲一");
    const first = await submitProgress(seed.periodIds[1], { ...goodInput(seed.groupA, "shared"), pdfKey: key });
    expect(first).toEqual({ ok: true });
    mockDeleteObject.mockClear();

    // A2 重放同一把 key，交同一期。
    asStudent(seed.semesterId, seed.groupA, "a2@g.nccu.edu.tw", "甲二");
    const second = await submitProgress(seed.periodIds[1], { ...goodInput(seed.groupA, "shared"), pdfKey: key });

    expect(second).toEqual({ ok: false, error: UPLOAD_FAILED });
    // A1 剛交出去的檔案不能被這次失敗的重放請求刪掉。
    expect(mockDeleteObject).not.toHaveBeenCalled();

    const rows = await reportsFor(seed.lineA, seed.periodIds[1]);
    expect(rows).toHaveLength(1);
    expect(rows[0].submitted_by).toBe("a1@g.nccu.edu.tw");
    expect(rows[0].pdf_key).toBe(key);
  });

  it("情境 B：A2 拿 A1 的 key 交另一期 → 被拒，不會有第二筆報告", async () => {
    const seed = await seedSemester({ acknowledged: true });
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const key = goodInput(seed.groupA, "shared-b").pdfKey;
    await issueTicket(key, "a1@g.nccu.edu.tw");

    const { submitProgress } = await import("@/server/actions/progress");

    // A1 交第 2 期（periodIds[1]）。
    asStudent(seed.semesterId, seed.groupA, "a1@g.nccu.edu.tw", "甲一");
    const first = await submitProgress(seed.periodIds[1], { ...goodInput(seed.groupA, "shared-b"), pdfKey: key });
    expect(first).toEqual({ ok: true });
    mockDeleteObject.mockClear();

    // A2 想拿同一把 key 交第 1 期（periodIds[0]，seedSemester() 已經幫第1組交過，這裡故意選
    // 一個「還沒交」的期別也一樣會被票務檔掉，用 periodIds[1] 已經交過的來測反而會先撞到
    // unique(line_id, period_id)，蓋掉票務檢查真正要測的東西，所以特地造一個新期別）。
    const db = createServiceSupabase();
    const { data: extraPeriod, error } = await db
      .from("periods")
      .insert({ semester_id: seed.semesterId, seq: 99, deadline: "2026-12-31T00:00:00Z" })
      .select()
      .single();
    if (error) throw error;

    asStudent(seed.semesterId, seed.groupA, "a2@g.nccu.edu.tw", "甲二");
    const second = await submitProgress(extraPeriod.id, { ...goodInput(seed.groupA, "shared-b"), pdfKey: key });

    expect(second).toEqual({ ok: false, error: UPLOAD_FAILED });
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(await reportsFor(seed.lineA, extraPeriod.id)).toHaveLength(0);
  });

  it("拿同組隊友還沒用過的票交 → 被拒（票不是自己申請的，就算同組也不行）", async () => {
    const seed = await seedSemester({ acknowledged: true });
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const key = goodInput(seed.groupA, "teammates-ticket").pdfKey;
    await issueTicket(key, "a1@g.nccu.edu.tw"); // a1 申請的，還沒用過

    const { submitProgress } = await import("@/server/actions/progress");
    asStudent(seed.semesterId, seed.groupA, "a2@g.nccu.edu.tw", "甲二");
    const result = await submitProgress(seed.periodIds[1], { ...goodInput(seed.groupA, "teammates-ticket"), pdfKey: key });

    expect(result).toEqual({ ok: false, error: UPLOAD_FAILED });
    expect(mockInspectUploaded).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(await reportsFor(seed.lineA, seed.periodIds[1])).toHaveLength(0);
  });

  it("同一組兩人同時送出同一期，只留一份，輸的那一方的檔案被刪掉（不是贏家的）", async () => {
    const seed = await seedSemester({ acknowledged: true });
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const key1 = goodInput(seed.groupA, "k1").pdfKey;
    const key2 = goodInput(seed.groupA, "k2").pdfKey;
    await issueTicket(key1, "a1@g.nccu.edu.tw");
    await issueTicket(key2, "a2@g.nccu.edu.tw");

    const { submitProgress } = await import("@/server/actions/progress");
    const input = (key: string) => ({ ...goodInput(seed.groupA, "unused"), pdfKey: key });

    const [r1, r2] = await Promise.all([
      asUser("a1@g.nccu.edu.tw", () => submitProgress(seed.periodIds[1], input(key1))),
      asUser("a2@g.nccu.edu.tw", () => submitProgress(seed.periodIds[1], input(key2))),
    ]);

    expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
    expect([r1, r2].find((r) => !r.ok)).toEqual({
      ok: false,
      error: "這一期剛剛已經有組員交了，請重新整理",
    });

    const rows = await reportsFor(seed.lineA, seed.periodIds[1]);
    expect(rows).toHaveLength(1);
    const winnerKey = rows[0].pdf_key as string;
    const loserKey = winnerKey === key1 ? key2 : key1;

    // 輸的那一方要把「自己」剛上傳的 R2 檔案刪掉，不是贏家的那份。
    expect(mockDeleteObject).toHaveBeenCalledTimes(1);
    expect(mockDeleteObject).toHaveBeenCalledWith(loserKey);
    expect(mockDeleteObject).not.toHaveBeenCalledWith(winnerKey);
  });
});

// 最終審查 M6：還沒按過這學期的「我已了解」（規格 4.2），就算是本組的專案生也不能交進度——
// (app)/layout.tsx 只擋畫面，server action 是可以直接從瀏覽器呼叫的端點，要自己再擋一次。
describe("submitProgress：還沒按「我已了解」", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("回傳「請先閱讀並同意使用說明」，不寫入", async () => {
    const seed = await seedSemester(); // 沒有 acknowledged
    asStudent(seed.semesterId, seed.groupA);
    const { submitProgress } = await import("@/server/actions/progress");
    const result = await submitProgress(seed.periodIds[1], {
      light: "green",
      did: "做了",
      blocked: "沒有",
      nextSteps: "繼續",
      pdfKey: `reports/${seed.groupA}/x.pdf`,
    });
    expect(result).toEqual({ ok: false, error: "請先閱讀並同意使用說明" });

    const db = createServiceSupabase();
    const { count } = await db
      .from("progress_reports")
      .select("id", { count: "exact", head: true })
      .eq("period_id", seed.periodIds[1]);
    expect(count).toBe(0);
  });
});
