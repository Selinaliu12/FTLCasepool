import { describe, it, expect } from "vitest";
import { MAX_PDF_BYTES, validatePdfMeta, isPdfMagic } from "./pdf";

describe("validatePdfMeta", () => {
  it("副檔名大寫 .PDF 且 type 正確 → ok", () => {
    expect(validatePdfMeta({ name: "A.PDF", type: "application/pdf", size: 100 })).toEqual({ ok: true });
  });

  it("20MB 整剛好可以", () => {
    expect(validatePdfMeta({ name: "a.pdf", type: "application/pdf", size: MAX_PDF_BYTES })).toEqual({ ok: true });
  });

  it("20MB 多 1 byte 回傳『檔案超過 20MB』", () => {
    expect(validatePdfMeta({ name: "a.pdf", type: "application/pdf", size: MAX_PDF_BYTES + 1 })).toEqual({
      ok: false,
      error: "檔案超過 20MB",
    });
  });

  it("副檔名不是 .pdf 或 type 不是 application/pdf 回傳『只收 PDF』", () => {
    expect(validatePdfMeta({ name: "a.docx", type: "application/pdf", size: 100 })).toEqual({
      ok: false,
      error: "只收 PDF",
    });
    expect(validatePdfMeta({ name: "a.pdf", type: "application/msword", size: 100 })).toEqual({
      ok: false,
      error: "只收 PDF",
    });
  });

  it("0 byte 回傳『檔案是空的』", () => {
    expect(validatePdfMeta({ name: "a.pdf", type: "application/pdf", size: 0 })).toEqual({
      ok: false,
      error: "檔案是空的",
    });
  });
});

describe("isPdfMagic", () => {
  it("%PDF-1.7 開頭為 true", () => {
    const head = new TextEncoder().encode("%PDF-1.7");
    expect(isPdfMagic(head)).toBe(true);
  });

  it("把 .docx 改名成 .pdf（PK\\x03\\x04 開頭）為 false", () => {
    const head = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
    expect(isPdfMagic(head)).toBe(false);
  });
});
