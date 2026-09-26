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

function goodInput(groupId: string, keySuffix: string) {
  return {
    light: "green" as const,
    did: "完成初版介面",
    blocked: "沒有卡關",
    nextSteps: "下週開始測試",
    pdfKey: `${SEMESTER_NAME}/${groupId}/${keySuffix}.pdf`,
  };
}

describe("submitProgress", () => {
  beforeEach(async () => {
    mockInspectUploaded.mockReset();
    mockDeleteObject.mockReset();
    mockDeleteObject.mockResolvedValue(undefined);
    await resetDb();
  });

  it("寫入一筆，繳交時間 = R2 確認後的時間，submitted_by 是送出者", async () => {
    const seed = await seedSemester();
    asStudent(seed.semesterId, seed.groupA);
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const { submitProgress } = await import("@/server/actions/progress");
    const before = new Date();
    const result = await submitProgress(seed.periodIds[1], goodInput(seed.groupA, "a"));
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
  });

  it("R2 上沒有檔案 → 回傳「檔案沒有上傳成功，請重新選擇 PDF」、不寫入、刪掉物件", async () => {
    const seed = await seedSemester();
    asStudent(seed.semesterId, seed.groupA);
    mockInspectUploaded.mockResolvedValue(null);

    const { submitProgress } = await import("@/server/actions/progress");
    const input = goodInput(seed.groupA, "b");
    const result = await submitProgress(seed.periodIds[1], input);

    expect(result).toEqual({ ok: false, error: "檔案沒有上傳成功，請重新選擇 PDF" });
    expect(mockDeleteObject).toHaveBeenCalledWith(input.pdfKey);

    const db = createServiceSupabase();
    const { data: rows, error } = await db
      .from("progress_reports")
      .select("id")
      .eq("line_id", seed.lineA)
      .eq("period_id", seed.periodIds[1]);
    if (error) throw error;
    expect(rows).toHaveLength(0);
  });

  it("檔頭不是 PDF → 同一句錯誤訊息、不寫入", async () => {
    const seed = await seedSemester();
    asStudent(seed.semesterId, seed.groupA);
    mockInspectUploaded.mockResolvedValue({ size: 100, isPdf: false });

    const { submitProgress } = await import("@/server/actions/progress");
    const input = goodInput(seed.groupA, "c");
    const result = await submitProgress(seed.periodIds[1], input);

    expect(result).toEqual({ ok: false, error: "檔案沒有上傳成功，請重新選擇 PDF" });
    expect(mockDeleteObject).toHaveBeenCalledWith(input.pdfKey);
  });

  it("不是這組的人（其他組專案生）送出 → 被拒，不會查到別組的期別", async () => {
    const seed = await seedSemester();
    // b1 是第2組的人，pdfKey 用第1組的 key 硬闖也一樣被擋，因為身分本身就不是專案生歸屬那組。
    asStudent(seed.semesterId, seed.groupB, "b1@g.nccu.edu.tw", "乙一");
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const { submitProgress } = await import("@/server/actions/progress");
    const result = await submitProgress(seed.periodIds[1], goodInput(seed.groupB, "d"));

    // b1 是第2組合法的專案生，這筆其實應該成功寫進第2組的線；用它來確認「別組的人」不會誤寫進第1組。
    expect(result).toEqual({ ok: true });

    const db = createServiceSupabase();
    const { data: rows, error } = await db
      .from("progress_reports")
      .select("id")
      .eq("line_id", seed.lineA)
      .eq("period_id", seed.periodIds[1]);
    if (error) throw error;
    expect(rows).toHaveLength(0);
  });

  it("幹部（非專案生）送出 → 被拒", async () => {
    const seed = await seedSemester();
    asOfficer(seed.semesterId);

    const { submitProgress } = await import("@/server/actions/progress");
    const result = await submitProgress(seed.periodIds[1], goodInput(seed.groupA, "e"));

    expect(result).toEqual({ ok: false, error: "只有專案生可以交進度" });
  });

  it("同一組兩人同時送出同一期，只留一份，另一人收到可理解的訊息", async () => {
    const seed = await seedSemester();
    mockInspectUploaded.mockResolvedValue({ size: 2048, isPdf: true });

    const { submitProgress } = await import("@/server/actions/progress");
    const input = (key: string) => goodInput(seed.groupA, key);

    const [r1, r2] = await Promise.all([
      asUser("a1@g.nccu.edu.tw", () => submitProgress(seed.periodIds[1], input("k1"))),
      asUser("a2@g.nccu.edu.tw", () => submitProgress(seed.periodIds[1], input("k2"))),
    ]);

    expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
    expect([r1, r2].find((r) => !r.ok)).toEqual({
      ok: false,
      error: "這一期剛剛已經有組員交了，請重新整理",
    });
    // 輸的那一方要把自己剛上傳的 R2 檔案刪掉。
    expect(mockDeleteObject).toHaveBeenCalledTimes(1);

    const db = createServiceSupabase();
    const { data: rows, error } = await db
      .from("progress_reports")
      .select("id")
      .eq("line_id", seed.lineA)
      .eq("period_id", seed.periodIds[1]);
    if (error) throw error;
    expect(rows).toHaveLength(1);
  });
});
