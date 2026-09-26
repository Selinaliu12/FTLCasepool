import { describe, it, expect } from "vitest";
import { presignPdfGet } from "./r2";
import { contentDisposition } from "@/domain/download";

// presignPdfGet 只是本機簽章（getSignedUrl 不會真的打網路），可以直接在單元測試跑，不需要
// 連本機 Supabase Storage／R2；contract 測試（tests/integration/r2.contract.test.ts）才會
// 真的打 S3 相容端點驗證簽出來的網址真的可以用。
describe("presignPdfGet", () => {
  it("預簽網址帶 response-content-disposition，值等於 contentDisposition() 算出來的內容（中文檔名走 RFC 5987 filename*）", async () => {
    const downloadName = "115-1-第1組-第2期.pdf";
    const url = await presignPdfGet("some/key.pdf", downloadName);
    const parsed = new URL(url);
    const disposition = parsed.searchParams.get("response-content-disposition");
    expect(disposition).toBe(contentDisposition(downloadName));
  });

  it("網址 10 分鐘後過期（X-Amz-Expires=600）", async () => {
    const url = await presignPdfGet("some/key.pdf", "report.pdf");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("600");
  });
});
