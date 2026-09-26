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

  // encodeURIComponent() 不會跳脫 ' ( ) * ! 這幾個字元，但它們在 HTTP header 的
  // parameter-value（RFC 5987／RFC 2616 token）裡不是安全字元，組名帶這些字元
  // （例如英文組名 O'Brien's Team）時不跳脫，某些反向代理／瀏覽器會解析錯誤或把 header
  // 截斷。filename* 的值裡不該出現這幾個字元的原始形式。
  it("組名含單引號等字元時，filename* 也要跳脫 ' ( ) * !", () => {
    const header = contentDisposition("115-1-O'Brien(!)*-第1期.pdf");
    const filenameStar = header.split("filename*=UTF-8''")[1];
    expect(filenameStar).not.toMatch(/['()!*]/);
    expect(filenameStar).toContain("%27"); // '
    expect(filenameStar).toContain("%28"); // (
    expect(filenameStar).toContain("%29"); // )
    expect(filenameStar).toContain("%21"); // !
    expect(filenameStar).toContain("%2A"); // *
  });
});
