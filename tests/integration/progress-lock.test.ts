import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester, asUser, backdatePdfUploadedAt } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

// editProgress／replaceProgressPdf／withdrawProgress 一律先呼叫 getAccess()，跟
// progress-actions.test.ts 一樣 mock 掉 @/server/session。
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
const LOCKED_ERROR = "已超過 2 小時，已鎖定不能修改";
const UPLOAD_FAILED = "檔案沒有上傳成功，請重新選擇 PDF";

function asOfficer(semesterId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "off@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "m2", semesterId, email: "off@g.nccu.edu.tw", name: "其他幹部", role: "officer", groupId: null },
    semesterId,
  });
}

async function reportRow(lineId: string, periodId: string) {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("progress_reports")
    .select("*")
    .eq("line_id", lineId)
    .eq("period_id", periodId)
    .single();
  if (error) throw error;
  return data;
}

async function issueTicket(key: string, issuerEmail: string) {
  const db = createServiceSupabase();
  const { error } = await db.from("upload_tickets").insert({ key, issuer_email: issuerEmail });
  if (error) throw error;
}

describe("2 小時內修改／換 PDF／撤回；之後鎖定", () => {
  beforeEach(async () => {
    mockInspectUploaded.mockReset();
    mockDeleteObject.mockReset();
    mockDeleteObject.mockResolvedValue(undefined);
    await resetDb();
  });

  // Step 5：2 小時內 editProgress 改燈號與三句話成功，pdf_uploaded_at 不變。
  it("2 小時內 editProgress 改燈號與三句話成功，pdf_uploaded_at 不變", async () => {
    const seed = await seedSemester();
    const before = await reportRow(seed.lineA, seed.periodIds[0]);

    const { editProgress } = await import("@/server/actions/progress");
    const result = await asUser("a1@g.nccu.edu.tw", () =>
      editProgress(before.id, { light: "yellow", did: "改過的內容", blocked: "改過的卡點", nextSteps: "改過的下一步" })
    );

    expect(result).toEqual({ ok: true });

    const after = await reportRow(seed.lineA, seed.periodIds[0]);
    expect(after.light).toBe("yellow");
    expect(after.did).toBe("改過的內容");
    expect(after.blocked).toBe("改過的卡點");
    expect(after.next_steps).toBe("改過的下一步");
    expect(after.pdf_uploaded_at).toBe(before.pdf_uploaded_at);
  });

  // Step 6：超過 2 小時 editProgress／withdrawProgress 回傳「已超過 2 小時，已鎖定不能修改」。
  it("超過 2 小時 editProgress 回傳「已超過 2 小時，已鎖定不能修改」", async () => {
    const seed = await seedSemester();
    const row = await reportRow(seed.lineA, seed.periodIds[0]);
    await backdatePdfUploadedAt(row.id, new Date(Date.now() - 3 * 60 * 60 * 1000));

    const { editProgress } = await import("@/server/actions/progress");
    const result = await asUser("a1@g.nccu.edu.tw", () =>
      editProgress(row.id, { light: "red", did: "x", blocked: "x", nextSteps: "x" })
    );

    expect(result).toEqual({ ok: false, error: LOCKED_ERROR });
  });

  it("超過 2 小時 withdrawProgress 回傳「已超過 2 小時，已鎖定不能修改」", async () => {
    const seed = await seedSemester();
    const row = await reportRow(seed.lineA, seed.periodIds[0]);
    await backdatePdfUploadedAt(row.id, new Date(Date.now() - 3 * 60 * 60 * 1000));

    const { withdrawProgress } = await import("@/server/actions/progress");
    const result = await asUser("a1@g.nccu.edu.tw", () => withdrawProgress(row.id));

    expect(result).toEqual({ ok: false, error: LOCKED_ERROR });

    // 沒有真的被刪掉。
    const stillThere = await reportRow(seed.lineA, seed.periodIds[0]);
    expect(stillThere.id).toBe(row.id);
  });

  // Step 7：真實邊界——直接對資料庫 update／delete 一列已鎖定的資料，被 trigger 拒絕。
  // 就算伺服器程式有 bug（漏了應用層的鎖定檢查），資料庫本身也要擋下來。
  it("直接對資料庫 update 已鎖定的列 → 被 trigger 拒絕", async () => {
    const seed = await seedSemester();
    const row = await reportRow(seed.lineA, seed.periodIds[0]);
    await backdatePdfUploadedAt(row.id, new Date(Date.now() - 3 * 60 * 60 * 1000));

    const db = createServiceSupabase();
    const { error } = await db.from("progress_reports").update({ light: "red" }).eq("id", row.id);

    expect(error).not.toBeNull();
    expect(error?.message).toContain("LOCKED");
  });

  it("直接對資料庫 delete 已鎖定的列 → 被 trigger 拒絕", async () => {
    const seed = await seedSemester();
    const row = await reportRow(seed.lineA, seed.periodIds[0]);
    await backdatePdfUploadedAt(row.id, new Date(Date.now() - 3 * 60 * 60 * 1000));

    const db = createServiceSupabase();
    const { error } = await db.from("progress_reports").delete().eq("id", row.id);

    expect(error).not.toBeNull();
    expect(error?.message).toContain("LOCKED");
  });

  // Step 8：replaceProgressPdf 把繳交時間改成新檔時間、舊 R2 檔刪除。
  it("replaceProgressPdf 把繳交時間改成新檔時間、舊 R2 檔刪除", async () => {
    const seed = await seedSemester();
    const row = await reportRow(seed.lineA, seed.periodIds[0]);
    const oldKey = row.pdf_key as string;

    mockInspectUploaded.mockResolvedValue({ size: 4096, isPdf: true });
    const newKey = `${SEMESTER_NAME}/${seed.groupA}/new-version.pdf`;
    await issueTicket(newKey, "a1@g.nccu.edu.tw");

    const { replaceProgressPdf } = await import("@/server/actions/progress");
    const before = new Date();
    const result = await asUser("a1@g.nccu.edu.tw", () => replaceProgressPdf(row.id, newKey));
    const after = new Date();

    expect(result).toEqual({ ok: true, becameLate: false });

    const updated = await reportRow(seed.lineA, seed.periodIds[0]);
    expect(updated.pdf_key).toBe(newKey);
    expect(updated.pdf_size).toBe(4096);
    expect(updated.pdf_uploaded_by).toBe("a1@g.nccu.edu.tw");
    const uploadedAt = new Date(updated.pdf_uploaded_at).getTime();
    expect(uploadedAt).toBeGreaterThanOrEqual(before.getTime());
    expect(uploadedAt).toBeLessThanOrEqual(after.getTime());

    expect(mockDeleteObject).toHaveBeenCalledWith(oldKey);
    expect(mockDeleteObject).not.toHaveBeenCalledWith(newKey);
  });

  // Step 9（Review Focus 3）：截止前交、過了截止才換 PDF → 變成逾期，回傳 becameLate。
  it("截止前交、過了截止才換 PDF → 變成逾期，並回傳 becameLate", async () => {
    const seed = await seedSemester();

    // 期別截止 = 現在 - 30 分鐘；原本 PDF 在截止前 10 分鐘上傳（仍在 2 小時內）。
    const db = createServiceSupabase();
    const deadline = new Date(Date.now() - 30 * 60 * 1000);
    const originalUploadedAt = new Date(deadline.getTime() - 10 * 60 * 1000);
    const { data: period, error: periodError } = await db
      .from("periods")
      .insert({ semester_id: seed.semesterId, seq: 42, deadline: deadline.toISOString() })
      .select()
      .single();
    if (periodError) throw periodError;

    const { data: report, error: reportError } = await db
      .from("progress_reports")
      .insert({
        line_id: seed.lineA,
        period_id: period.id,
        light: "green",
        did: "x",
        blocked: "x",
        next_steps: "x",
        submitted_by: "a1@g.nccu.edu.tw",
        pdf_key: `${SEMESTER_NAME}/${seed.groupA}/before-deadline.pdf`,
        pdf_size: 1024,
        pdf_uploaded_at: originalUploadedAt.toISOString(),
        pdf_uploaded_by: "a1@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (reportError) throw reportError;

    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });
    const newKey = `${SEMESTER_NAME}/${seed.groupA}/after-deadline.pdf`;
    await issueTicket(newKey, "a1@g.nccu.edu.tw");

    const { replaceProgressPdf } = await import("@/server/actions/progress");
    const r = await asUser("a1@g.nccu.edu.tw", () => replaceProgressPdf(report.id, newKey));

    expect(r).toEqual({ ok: true, becameLate: true });
  });

  // Step 10：withdrawProgress 後資料庫沒有該筆、R2 沒有檔案、該期回到未交。
  it("withdrawProgress 後資料庫沒有該筆、R2 沒有檔案", async () => {
    const seed = await seedSemester();
    const row = await reportRow(seed.lineA, seed.periodIds[0]);

    const { withdrawProgress } = await import("@/server/actions/progress");
    const result = await asUser("a1@g.nccu.edu.tw", () => withdrawProgress(row.id));

    expect(result).toEqual({ ok: true });

    const db = createServiceSupabase();
    const { data, error } = await db.from("progress_reports").select("id").eq("id", row.id).maybeSingle();
    if (error) throw error;
    expect(data).toBeNull();

    expect(mockDeleteObject).toHaveBeenCalledWith(row.pdf_key);
  });

  // 授權：別組的專案生不能碰別組的報告，也不會被告知這份報告存在。
  it("別組的專案生 editProgress 別組的報告 → 找不到這份進度", async () => {
    const seed = await seedSemester();
    const row = await reportRow(seed.lineA, seed.periodIds[0]);

    const { editProgress } = await import("@/server/actions/progress");
    const result = await asUser("b1@g.nccu.edu.tw", () =>
      editProgress(row.id, { light: "red", did: "x", blocked: "x", nextSteps: "x" })
    );

    expect(result).toEqual({ ok: false, error: "找不到這份進度" });
  });

  it("幹部（非專案生）editProgress → 被拒", async () => {
    const seed = await seedSemester();
    const row = await reportRow(seed.lineA, seed.periodIds[0]);
    asOfficer(seed.semesterId);

    const { editProgress } = await import("@/server/actions/progress");
    const result = await editProgress(row.id, { light: "red", did: "x", blocked: "x", nextSteps: "x" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toBe(""); // 幹部沒有自己的組，一律被拒
  });

  it("同組的另一位組員也可以 editProgress（該組任何組員都可以）", async () => {
    const seed = await seedSemester();
    const row = await reportRow(seed.lineA, seed.periodIds[0]);

    const { editProgress } = await import("@/server/actions/progress");
    const result = await asUser("a2@g.nccu.edu.tw", () =>
      editProgress(row.id, { light: "yellow", did: "組員二改的", blocked: "x", nextSteps: "x" })
    );

    expect(result).toEqual({ ok: true });
  });

  // replace 的安全鏈：別人的票不能用。
  it("replaceProgressPdf 用別人申請的票 → 被拒，舊檔沒被刪掉", async () => {
    const seed = await seedSemester();
    const row = await reportRow(seed.lineA, seed.periodIds[0]);

    const foreignKey = `${SEMESTER_NAME}/${seed.groupA}/foreign.pdf`;
    await issueTicket(foreignKey, "a2@g.nccu.edu.tw"); // a2 申請的票

    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const { replaceProgressPdf } = await import("@/server/actions/progress");
    const result = await asUser("a1@g.nccu.edu.tw", () => replaceProgressPdf(row.id, foreignKey));

    expect(result).toEqual({ ok: false, error: UPLOAD_FAILED });
    expect(mockDeleteObject).not.toHaveBeenCalled();

    const stillOld = await reportRow(seed.lineA, seed.periodIds[0]);
    expect(stillOld.pdf_key).toBe(row.pdf_key);
  });

  it("超過 2 小時 replaceProgressPdf 被拒，票沒被用掉", async () => {
    const seed = await seedSemester();
    const row = await reportRow(seed.lineA, seed.periodIds[0]);
    await backdatePdfUploadedAt(row.id, new Date(Date.now() - 3 * 60 * 60 * 1000));

    const newKey = `${SEMESTER_NAME}/${seed.groupA}/too-late.pdf`;
    await issueTicket(newKey, "a1@g.nccu.edu.tw");
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const { replaceProgressPdf } = await import("@/server/actions/progress");
    const result = await asUser("a1@g.nccu.edu.tw", () => replaceProgressPdf(row.id, newKey));

    expect(result).toEqual({ ok: false, error: LOCKED_ERROR });

    const db = createServiceSupabase();
    const { data: ticket, error } = await db.from("upload_tickets").select("used_at").eq("key", newKey).single();
    if (error) throw error;
    expect(ticket.used_at).toBeNull();
  });
});
