import { describe, it, expect } from "vitest";
import { pdfDownloadName, contentDisposition } from "./download";

describe("pdfDownloadName", () => {
  it("組成「{學期}-{組名}-第{N}期.pdf」", () => {
    expect(pdfDownloadName({ semesterName: "115-1", groupName: "第1組", seq: 2 })).toBe("115-1-第1組-第2期.pdf");
  });
});

describe("contentDisposition", () => {
  it("含 ASCII fallback filename 與 RFC 5987 filename*（中文檔名用 UTF-8 百分號編碼）", () => {
    const header = contentDisposition("115-1-第1組-第2期.pdf");
    expect(header).toContain('attachment; filename="');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain(encodeURIComponent("115-1-第1組-第2期.pdf"));
  });

  it("全英數檔名時 fallback 就是原檔名本身", () => {
    const header = contentDisposition("report.pdf");
    expect(header).toContain('filename="report.pdf"');
  });
});
