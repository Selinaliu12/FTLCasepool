import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester } from "./helpers";

// requestPdfUpload 一律先呼叫 getAccess()，這裡跟 admin-actions.test.ts 一樣用 vi.mock
// 假造 @/server/session，讓每個測試自己決定「呼叫者是誰」，不用真的登入。
const mockGetAccess = vi.fn();
vi.mock("@/server/session", () => ({ getAccess: () => mockGetAccess() }));

// 簽網址（presignPdfPut）本身在 r2.contract.test.ts 已經對真實端點驗證過；這裡只驗證
// requestPdfUpload 「什麼情況下會呼叫／不會呼叫」它，所以整個 mock 掉，不用真的打 S3。
const mockPresignPdfPut = vi.fn();
vi.mock("@/server/r2", () => ({ presignPdfPut: (...args: unknown[]) => mockPresignPdfPut(...args) }));

const GOOD_FILE = { name: "report.pdf", type: "application/pdf", size: 1024 };

function asStudent(semesterId: string, groupId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "a1@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "m1", semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student", groupId },
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

function asWrongDomain() {
  mockGetAccess.mockResolvedValue({ kind: "wrong_domain" });
}

describe("requestPdfUpload", () => {
  beforeEach(async () => {
    mockPresignPdfPut.mockReset();
    mockPresignPdfPut.mockResolvedValue("https://signed.example/put");
    await resetDb();
  });

  it("沒登入（wrong_domain）→ 被拒，不簽網址", async () => {
    asWrongDomain();
    const { requestPdfUpload } = await import("@/server/actions/upload");
    const result = await requestPdfUpload(GOOD_FILE);
    expect(result).toEqual({ ok: false, error: "只有專案生可以上傳" });
    expect(mockPresignPdfPut).not.toHaveBeenCalled();
  });

  it("幹部（officer，非專案生）→ 被拒，不簽網址", async () => {
    const seed = await seedSemester();
    asOfficer(seed.semesterId);
    const { requestPdfUpload } = await import("@/server/actions/upload");
    const result = await requestPdfUpload(GOOD_FILE);
    expect(result).toEqual({ ok: false, error: "只有專案生可以上傳" });
    expect(mockPresignPdfPut).not.toHaveBeenCalled();
  });

  it("檔案不合規格 → 直接回錯，不簽網址", async () => {
    const seed = await seedSemester();
    asStudent(seed.semesterId, seed.groupA);
    const { requestPdfUpload } = await import("@/server/actions/upload");
    const result = await requestPdfUpload({ name: "a.docx", type: "application/msword", size: 100 });
    expect(result).toEqual({ ok: false, error: "只收 PDF" });
    expect(mockPresignPdfPut).not.toHaveBeenCalled();
  });

  it("專案生上傳合規格的檔案 → key 格式正確、回傳簽好的網址", async () => {
    const seed = await seedSemester();
    asStudent(seed.semesterId, seed.groupA);
    const { requestPdfUpload } = await import("@/server/actions/upload");
    const result = await requestPdfUpload(GOOD_FILE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.url).toBe("https://signed.example/put");
    expect(result.key).toMatch(
      new RegExp(`^115-1/${seed.groupA}/[0-9a-f-]{36}\\.pdf$`)
    );
    expect(mockPresignPdfPut).toHaveBeenCalledWith(result.key, GOOD_FILE.size);
  });
});
