import { periodLabel } from "./lights";
import { STAGE_LABEL, type StageKey } from "./competition-line";

// 下載檔名「{學期}-{組名}-第{N}期.pdf」（規格 Task 14）。
export function pdfDownloadName(i: { semesterName: string; groupName: string; seq: number }): string {
  return `${i.semesterName}-${i.groupName}-${periodLabel(i.seq).replace(/\s/g, "")}.pdf`;
}

// 比賽階段繳交的下載檔名「{學期}-{組名}-{比賽名}-{階段}-v{N}.pdf」（Batch 2 Task 6）。
export function stageDownloadName(i: {
  semesterName: string;
  groupName: string;
  competitionName: string;
  stage: StageKey;
  version: number;
}): string {
  return `${i.semesterName}-${i.groupName}-${i.competitionName}-${STAGE_LABEL[i.stage]}-v${i.version}.pdf`;
}

// 作業繳交的下載檔名「{學期}-{組名}-作業-{標題}.pdf」（§17）。標題裡的「/」換成「-」，不讓瀏覽器當成路徑。
export function assignmentDownloadName(i: { semesterName: string; groupName: string; title: string }): string {
  return `${i.semesterName}-${i.groupName}-作業-${i.title.replace(/[\\/]/g, "-")}.pdf`;
}

// Content-Disposition：中文檔名不是合法的 ASCII header 值，RFC 5987 的 filename* 才是瀏覽器
// 拿檔名的來源；filename= 只當作不支援 filename* 的舊瀏覽器的備援，所以裡面只留 ASCII 字元。
function asciiFallback(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");
  return ascii.trim() || "download.pdf";
}

// encodeURIComponent() 照 RFC 3986 留下 ' ( ) * ! 不跳脫（它們在 URI 裡是合法的
// sub-delims），但 RFC 5987 的 attr-char（filename* 的值域）不包含這幾個字元——不額外跳脫
//的話，組名剛好帶這些字元時，filename* 的值可能被某些反向代理或瀏覽器誤判成 header 語法
// 的一部分。
function rfc5987EncodeURIComponent(value: string): string {
  return encodeURIComponent(value).replace(
    /['()!*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

export function contentDisposition(downloadName: string): string {
  const fallback = asciiFallback(downloadName);
  const encoded = rfc5987EncodeURIComponent(downloadName);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
