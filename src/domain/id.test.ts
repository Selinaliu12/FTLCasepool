import { describe, it, expect } from "vitest";
import { isUuid } from "./id";

describe("isUuid", () => {
  it("接受標準 UUID（含全零）", () => {
    expect(isUuid("db209048-c194-418b-8adb-7d13038b8870")).toBe(true);
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
  });

  it("拒絕不是 UUID 格式的字串（會讓 PostgREST 丟 22P02，得在打資料庫前先擋下來）", () => {
    expect(isUuid("abc")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("db209048-c194-418b-8adb-7d13038b887")).toBe(false); // 少一碼
  });
});
