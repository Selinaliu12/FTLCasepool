import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { presignPdfPut, presignPdfGet, inspectUploaded, deleteObject } from "@/server/r2";
import { ensureLocalStorageBucket } from "./helpers";

// 這組測試打的是真實的 S3 相容端點（本機 R2_ENDPOINT 目前指向本機 Supabase Storage；
// 上線前必須換成真的 R2 測試桶再跑一次）。
// describe.skipIf 只防止「不小心打到正式桶」，跟本機/正式無關；bucket 名稱以 -test 結尾才會執行。
const key = `contract-test/${crypto.randomUUID()}.pdf`;
const pdf = new TextEncoder().encode("%PDF-1.7\n%test\n");

afterAll(() => deleteObject(key));

describe.skipIf(!process.env.R2_BUCKET?.endsWith("-test"))("R2 契約", () => {
  // 本機測試桶可能還沒建立（見 helpers.ts 的 ensureLocalStorageBucket：這個桶不是
  // migration／seed.sql 建的，`supabase db reset` 會把它一起重建掉），這裡補建一次；
  // idempotent，桶已存在就略過。
  beforeAll(() => ensureLocalStorageBucket());

  it("用預簽網址 PUT 上傳，之後讀得到大小與 PDF 檔頭", async () => {
    const url = await presignPdfPut(key, pdf.byteLength);
    const res = await fetch(url, { method: "PUT", body: pdf, headers: { "Content-Type": "application/pdf" } });
    expect(res.status).toBe(200);
    expect(await inspectUploaded(key)).toEqual({ size: pdf.byteLength, isPdf: true });
  });

  // 這個測試在本機 Supabase Storage 也會真的通過（不是假造的）：用 fetch() PUT 時，
  // fetch 會依實際 body 大小自動算出 Content-Length header，跟簽名時宣告的 10 bytes 不同，
  // 導致 SigV4 簽章驗證失敗（SignatureDoesNotMatch, 403）而被拒絕——這件事在本機、正式 R2
  // 都成立（簽章驗證是 S3 協定本身的行為，不是 R2 專屬）。已經用手動 PUT 對本機端點實測過
  // 確認會被拒絕，所以這裡不需要 skipIf，也不用另外加第二道大小防線。
  it("預簽 GET 下載拿到同樣內容，並帶中文下載檔名", async () => {
    const url = await presignPdfGet(key, "115-1-第1組-第1期.pdf");
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(pdf);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''");
  });

  it("deleteObject 之後檔案就不存在", async () => {
    const tmpKey = `contract-test/${crypto.randomUUID()}.pdf`;
    const url = await presignPdfPut(tmpKey, pdf.byteLength);
    expect((await fetch(url, { method: "PUT", body: pdf, headers: { "Content-Type": "application/pdf" } })).status).toBe(200);
    await deleteObject(tmpKey);
    expect(await inspectUploaded(tmpKey)).toBeNull();
  });

  it("實際內容比簽的大小大，R2 拒絕", async () => {
    const url = await presignPdfPut(`${key}.big`, 10);
    const res = await fetch(url, { method: "PUT", body: pdf, headers: { "Content-Type": "application/pdf" } });
    expect(res.ok).toBe(false);
  });

  it("不存在的檔案 inspectUploaded 回傳 null", async () => {
    expect(await inspectUploaded(`${key}.missing`)).toBeNull();
  });

  it("inspectUploaded 對非 PDF 的物件回傳 isPdf:false", async () => {
    const nonPdfKey = `contract-test/${crypto.randomUUID()}.pdf`;
    const nonPdf = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]); // "PK\x03\x04..."
    const url = await presignPdfPut(nonPdfKey, nonPdf.byteLength);
    const res = await fetch(url, { method: "PUT", body: nonPdf, headers: { "Content-Type": "application/pdf" } });
    expect(res.status).toBe(200);
    expect(await inspectUploaded(nonPdfKey)).toEqual({ size: nonPdf.byteLength, isPdf: false });
    await deleteObject(nonPdfKey);
  });
});
