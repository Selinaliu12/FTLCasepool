import { periodLabel } from "./lights";

// 下載檔名「{學期}-{組名}-第{N}期.pdf」（規格 Task 14）。
export function pdfDownloadName(i: { semesterName: string; groupName: string; seq: number }): string {
  return `${i.semesterName}-${i.groupName}-${periodLabel(i.seq).replace(/\s/g, "")}.pdf`;
}

// Content-Disposition：中文檔名不是合法的 ASCII header 值，RFC 5987 的 filename* 才是瀏覽器
// 拿檔名的來源；filename= 只當作不支援 filename* 的舊瀏覽器的備援，所以裡面只留 ASCII 字元。
function asciiFallback(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");
  return ascii.trim() || "download.pdf";
}

export function contentDisposition(downloadName: string): string {
  const fallback = asciiFallback(downloadName);
  const encoded = encodeURIComponent(downloadName);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
