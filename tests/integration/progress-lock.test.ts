import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester, asUser, backdatePdfUploadedAt, okAccess } from "./helpers";
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
const NOT_FOUND = "找不到這份進度";
const STALE_WRITE_ERROR = "這份進度剛剛被組員改過，請重新整理";
const MALFORMED_ID = "not-a-uuid";

function asOfficer(semesterId: string) {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email: "off@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "m2", semesterId, email: "off@g.nccu.edu.tw", name: "其他幹部", role: "officer", groupId: null },
    semesterId,
  }));
}

function asPm(semesterId: string) {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email: "pm@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "m3", semesterId, email: "pm@g.nccu.edu.tw", name: "專案幹部", role: "pm", groupId: null },
    semesterId,
  }));
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
    const seed = await seedSemester({ acknowledged: true });
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
    const seed = await seedSemester({ acknowledged: true });
    const row = await reportRow(seed.lineA, seed.periodIds[0]);
    await backdatePdfUploadedAt(row.id, new Date(Date.now() - 3 * 60 * 60 * 1000));

    const { editProgress } = await import("@/server/actions/progress");
    const result = await asUser("a1@g.nccu.edu.tw", () =>
      editProgress(row.id, { light: "red", did: "x", blocked: "x", nextSteps: "x" })
    );

    expect(result).toEqual({ ok: false, error: LOCKED_ERROR });
  });

  it("超過 2 小時 withdrawProgress 回傳「已超過 2 小時，已鎖定不能修改」", async () => {
    const seed = await seedSemester({ acknowledged: true });
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
    const seed = await seedSemester({ acknowledged: true });
    const row = await reportRow(seed.lineA, seed.periodIds[0]);
    await backdatePdfUploadedAt(row.id, new Date(Date.now() - 3 * 60 * 60 * 1000));

    const db = createServiceSupabase();
    const { error } = await db.from("progress_reports").update({ light: "red" }).eq("id", row.id);

    expect(error).not.toBeNull();
    expect(error?.message).toContain("LOCKED");
  });

  it("直接對資料庫 delete 已鎖定的列 → 被 trigger 拒絕", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const row = await reportRow(seed.lineA, seed.periodIds[0]);
    await backdatePdfUploadedAt(row.id, new Date(Date.now() - 3 * 60 * 60 * 1000));

    const db = createServiceSupabase();
    const { error } = await db.from("progress_reports").delete().eq("id", row.id);

    expect(error).not.toBeNull();
    expect(error?.message).toContain("LOCKED");
  });

  // Step 8：replaceProgressPdf 把繳交時間改成新檔時間、舊 R2 檔刪除。
  it("replaceProgressPdf 把繳交時間改成新檔時間、舊 R2 檔刪除", async () => {
    const seed = await seedSemester({ acknowledged: true });
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
    const seed = await seedSemester({ acknowledged: true });

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
    const seed = await seedSemester({ acknowledged: true });
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
    const seed = await seedSemester({ acknowledged: true });
    const row = await reportRow(seed.lineA, seed.periodIds[0]);

    const { editProgress } = await import("@/server/actions/progress");
    const result = await asUser("b1@g.nccu.edu.tw", () =>
      editProgress(row.id, { light: "red", did: "x", blocked: "x", nextSteps: "x" })
    );

    expect(result).toEqual({ ok: false, error: "找不到這份進度" });
  });

  it("幹部（非專案生）editProgress → 找不到這份進度", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const row = await reportRow(seed.lineA, seed.periodIds[0]);
    asOfficer(seed.semesterId);

    const { editProgress } = await import("@/server/actions/progress");
    const result = await editProgress(row.id, { light: "red", did: "x", blocked: "x", nextSteps: "x" });

    expect(result).toEqual({ ok: false, error: NOT_FOUND });
  });

  it("同組的另一位組員也可以 editProgress（該組任何組員都可以）", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const row = await reportRow(seed.lineA, seed.periodIds[0]);

    const { editProgress } = await import("@/server/actions/progress");
    const result = await asUser("a2@g.nccu.edu.tw", () =>
      editProgress(row.id, { light: "yellow", did: "組員二改的", blocked: "x", nextSteps: "x" })
    );

    expect(result).toEqual({ ok: true });
  });

  // replace 的安全鏈：別人的票不能用。
  it("replaceProgressPdf 用別人申請的票 → 被拒，舊檔沒被刪掉", async () => {
    const seed = await seedSemester({ acknowledged: true });
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

  // Fix round 1（controller ruling 3）：一旦票務檢查證明 newKey 是呼叫者自己申請、還沒用掉
  // 的上傳，鎖定檢查失敗後必須把這個「已經確定屬於呼叫者、但沒用上」的新物件刪掉（孤兒
  // 檔案），但絕對不能動舊檔（report.pdf_key）——舊檔案還在被這份報告使用，換檔失敗不該
  // 影響它。
  it("超過 2 小時 replaceProgressPdf 被拒：票沒被用掉、新物件被刪除、舊物件沒被動", async () => {
    const seed = await seedSemester({ acknowledged: true });
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

    expect(mockDeleteObject).toHaveBeenCalledWith(newKey);
    expect(mockDeleteObject).not.toHaveBeenCalledWith(row.pdf_key);
  });

  // Fix round 1（controller ruling 2）：不管是幹部、PM、別組的專案生、還是格式錯誤（不是
  // 合法 UUID）的 reportId，replaceProgressPdf／withdrawProgress 一律回同一句「找不到這份
  // 進度」，不能洩漏「這份報告其實存在」，格式錯誤的 id 也不能讓呼叫端看到 500。
  describe("授權統一成「找不到這份進度」（replace／withdraw）", () => {
    it.each([
      ["幹部", (semesterId: string) => asOfficer(semesterId)],
      ["PM", (semesterId: string) => asPm(semesterId)],
    ] as const)("%s replaceProgressPdf 別組的報告 → 找不到這份進度", async (_label, setAccess) => {
      const seed = await seedSemester({ acknowledged: true });
      const row = await reportRow(seed.lineA, seed.periodIds[0]);
      setAccess(seed.semesterId);

      const { replaceProgressPdf } = await import("@/server/actions/progress");
      const result = await replaceProgressPdf(row.id, `${SEMESTER_NAME}/${seed.groupA}/x.pdf`);

      expect(result).toEqual({ ok: false, error: NOT_FOUND });
      expect(mockInspectUploaded).not.toHaveBeenCalled();
    });

    it.each([
      ["幹部", (semesterId: string) => asOfficer(semesterId)],
      ["PM", (semesterId: string) => asPm(semesterId)],
    ] as const)("%s withdrawProgress 別組的報告 → 找不到這份進度", async (_label, setAccess) => {
      const seed = await seedSemester({ acknowledged: true });
      const row = await reportRow(seed.lineA, seed.periodIds[0]);
      setAccess(seed.semesterId);

      const { withdrawProgress } = await import("@/server/actions/progress");
      const result = await withdrawProgress(row.id);

      expect(result).toEqual({ ok: false, error: NOT_FOUND });
      const stillThere = await reportRow(seed.lineA, seed.periodIds[0]);
      expect(stillThere.id).toBe(row.id);
    });

    it("別組的專案生 replaceProgressPdf → 找不到這份進度", async () => {
      const seed = await seedSemester({ acknowledged: true });
      const row = await reportRow(seed.lineA, seed.periodIds[0]);

      const { replaceProgressPdf } = await import("@/server/actions/progress");
      const result = await asUser("b1@g.nccu.edu.tw", () =>
        replaceProgressPdf(row.id, `${SEMESTER_NAME}/${seed.groupA}/x.pdf`)
      );

      expect(result).toEqual({ ok: false, error: NOT_FOUND });
      expect(mockInspectUploaded).not.toHaveBeenCalled();
    });

    it("別組的專案生 withdrawProgress → 找不到這份進度", async () => {
      const seed = await seedSemester({ acknowledged: true });
      const row = await reportRow(seed.lineA, seed.periodIds[0]);

      const { withdrawProgress } = await import("@/server/actions/progress");
      const result = await asUser("b1@g.nccu.edu.tw", () => withdrawProgress(row.id));

      expect(result).toEqual({ ok: false, error: NOT_FOUND });
      const stillThere = await reportRow(seed.lineA, seed.periodIds[0]);
      expect(stillThere.id).toBe(row.id);
    });

    it("格式錯誤（非 UUID）的 reportId → replaceProgressPdf 回「找不到這份進度」，不是 500", async () => {
      await seedSemester({ acknowledged: true });

      const { replaceProgressPdf } = await import("@/server/actions/progress");
      const result = await asUser("a1@g.nccu.edu.tw", () =>
        replaceProgressPdf(MALFORMED_ID, `${SEMESTER_NAME}/some-group/x.pdf`)
      );

      expect(result).toEqual({ ok: false, error: NOT_FOUND });
    });

    it("格式錯誤（非 UUID）的 reportId → withdrawProgress 回「找不到這份進度」，不是 500", async () => {
      await seedSemester({ acknowledged: true });

      const { withdrawProgress } = await import("@/server/actions/progress");
      const result = await asUser("a1@g.nccu.edu.tw", () => withdrawProgress(MALFORMED_ID));

      expect(result).toEqual({ ok: false, error: NOT_FOUND });
    });

    it("格式錯誤（非 UUID）的 reportId → editProgress 回「找不到這份進度」，不是 500", async () => {
      await seedSemester({ acknowledged: true });

      const { editProgress } = await import("@/server/actions/progress");
      const result = await asUser("a1@g.nccu.edu.tw", () =>
        editProgress(MALFORMED_ID, { light: "red", did: "x", blocked: "x", nextSteps: "x" })
      );

      expect(result).toEqual({ ok: false, error: NOT_FOUND });
    });
  });

  // Fix round 1（controller ruling 4，競態）：兩個組員幾乎同時換檔同一份報告，RPC 用
  // `select ... for update` 鎖住那一列，兩邊都拿「換檔前」讀到的 pdf_key 當 p_old_pdf_key；
  // 先搶到鎖的那個會成功，另一個因為它預期的舊 key 已經被前者改掉（stale）而被拒，錯誤訊息
  // 是「這份進度剛剛被組員改過，請重新整理」，而且它自己申請的新物件要被刪掉（孤兒檔案），
  // 贏家的新物件不能被刪、原本真正的舊檔要被刪掉一次（贏家換檔成功後的正常清理）。
  // 一開始這裡用 Promise.all 同時發動兩個 replaceProgressPdf，指望它們在 RPC 的
  // `select ... for update` 上真的搶鎖。結果兩個都成功了：replaceProgressPdf 在打 RPC
  // 之前，自己會先用 loadOwnedReport() 重新讀一次「現在」的 pdf_key，如果 a1 整個流程
  // （好幾個 await：access → loadOwnedReport → 字首 → 票務 → isLocked → inspectUploaded →
  // RPC）在 a2 都還沒開始讀之前就已經跑完，a2 讀到的「舊」key 其實已經是 a1 換好的新
  // key——沒有真的產生 stale，兩邊都會「成功」，不是這裡要測的競態。
  //
  // 改用一個可以手動控制的 gate 卡住 a1 的 inspectUploaded：讓 a1 先讀到「換檔前」的舊
  // pdf_key、通過字首／票務檢查之後卡住，這時候讓 a2 完整跑完並真的把 pdf_key 換掉，
  // 最後才放行 a1——這樣 a1 手上的 p_old_pdf_key 保證跟資料庫「這一刻」的值不一樣，
  // 才是真正在測 RPC 的 stale_write 防護，而不是靠時間巧合。
  it("兩個組員幾乎同時換檔同一份報告 → 較晚打 RPC 的那個因為 pdf_key 被搶先改過而被拒（stale write）", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const row = await reportRow(seed.lineA, seed.periodIds[0]);

    const keyA = `${SEMESTER_NAME}/${seed.groupA}/race-a.pdf`;
    const keyB = `${SEMESTER_NAME}/${seed.groupA}/race-b.pdf`;
    await issueTicket(keyA, "a1@g.nccu.edu.tw");
    await issueTicket(keyB, "a2@g.nccu.edu.tw");

    let releaseA: ((v: { size: number; isPdf: boolean }) => void) | undefined;
    const aGate = new Promise<{ size: number; isPdf: boolean }>((resolve) => {
      releaseA = resolve;
    });
    mockInspectUploaded.mockImplementation((key: string) =>
      key === keyA ? aGate : Promise.resolve({ size: 2048, isPdf: true })
    );

    const { replaceProgressPdf } = await import("@/server/actions/progress");

    const pA = asUser("a1@g.nccu.edu.tw", () => replaceProgressPdf(row.id, keyA));
    // 讓 a1 有機會先跑到卡住的地方（讀到舊 pdf_key、通過字首／票務檢查）。
    await new Promise((resolve) => setTimeout(resolve, 100));

    const rB = await asUser("a2@g.nccu.edu.tw", () => replaceProgressPdf(row.id, keyB));
    expect(rB).toEqual({ ok: true, becameLate: false });

    // 放行 a1：資料庫現在的 pdf_key 已經是 keyB，跟 a1 手上的舊值對不上。
    releaseA!({ size: 2048, isPdf: true });
    const rA = await pA;

    expect(rA).toEqual({ ok: false, error: STALE_WRITE_ERROR });

    const finalRow = await reportRow(seed.lineA, seed.periodIds[0]);
    expect(finalRow.pdf_key).toBe(keyB);

    // 贏家（a2）真的換成功：原本的舊檔（row.pdf_key）被清掉，贏家的新 key 保留、沒被刪。
    expect(mockDeleteObject).toHaveBeenCalledWith(row.pdf_key);
    expect(mockDeleteObject).not.toHaveBeenCalledWith(keyB);
    // 輸家（a1）自己申請的新物件被刪掉（孤兒檔案），不是靜靜留著沒人管。
    expect(mockDeleteObject).toHaveBeenCalledWith(keyA);

    // 輸家的票沒被用掉（stale_write 發生在 RPC 標記票用掉之前）。
    const db = createServiceSupabase();
    const { data: loserTicket, error } = await db
      .from("upload_tickets")
      .select("used_at")
      .eq("key", keyA)
      .single();
    if (error) throw error;
    expect(loserTicket.used_at).toBeNull();
  });

  // Fix round 1（controller ruling 4）：withdrawProgress 刪的是「delete 當下」資料庫實際
  // 回傳的 pdf_key，不是呼叫最初讀到、可能已經過期的值——用「先換檔、再撤回」這個真實的
  // 循序場景驗證：撤回時 R2 上被刪的是換檔後的新 key，不是報告一開始建立時的舊 key。
  it("withdrawProgress 刪的是資料庫實際回傳的 pdf_key（換檔之後才撤回，刪的是新 key）", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const row = await reportRow(seed.lineA, seed.periodIds[0]);
    const originalKey = row.pdf_key as string;

    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });
    const newKey = `${SEMESTER_NAME}/${seed.groupA}/replaced-then-withdrawn.pdf`;
    await issueTicket(newKey, "a1@g.nccu.edu.tw");

    const { replaceProgressPdf, withdrawProgress } = await import("@/server/actions/progress");

    const replaceResult = await asUser("a1@g.nccu.edu.tw", () => replaceProgressPdf(row.id, newKey));
    expect(replaceResult).toEqual({ ok: true, becameLate: false });
    mockDeleteObject.mockClear();

    const withdrawResult = await asUser("a2@g.nccu.edu.tw", () => withdrawProgress(row.id));
    expect(withdrawResult).toEqual({ ok: true });

    expect(mockDeleteObject).toHaveBeenCalledTimes(1);
    expect(mockDeleteObject).toHaveBeenCalledWith(newKey);
    expect(mockDeleteObject).not.toHaveBeenCalledWith(originalKey);
  });
});

// 最終審查 M6：編輯／換 PDF／撤回也一樣要求這學期按過「我已了解」。
describe("editProgress／replaceProgressPdf／withdrawProgress：還沒按「我已了解」", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("三個動作都回傳「請先閱讀並同意使用說明」，報告不變", async () => {
    const seed = await seedSemester(); // 沒有 acknowledged
    const before = await reportRow(seed.lineA, seed.periodIds[0]);
    const { editProgress, replaceProgressPdf, withdrawProgress } = await import("@/server/actions/progress");

    const edit = await asUser("a1@g.nccu.edu.tw", () =>
      editProgress(before.id, { light: "red", did: "x", blocked: "y", nextSteps: "z" })
    );
    const replace = await asUser("a1@g.nccu.edu.tw", () => replaceProgressPdf(before.id, `reports/${seed.groupA}/new.pdf`));
    const withdraw = await asUser("a1@g.nccu.edu.tw", () => withdrawProgress(before.id));

    for (const r of [edit, replace, withdraw]) expect(r).toEqual({ ok: false, error: "請先閱讀並同意使用說明" });
    const after = await reportRow(seed.lineA, seed.periodIds[0]);
    expect(after).toEqual(before);
  });
});
