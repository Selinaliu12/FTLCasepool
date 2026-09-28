import { describe, it, expect } from "vitest";
import { validateGroupNote, MAX_GROUP_NOTE_LENGTH } from "./group-note";

describe("validateGroupNote", () => {
  it("修剪頭尾空白後存下來", () => {
    const result = validateGroupNote("  智慧記帳系統  ");
    expect(result).toEqual({ ok: true, note: "智慧記帳系統" });
  });

  it("空字串（或只有空白）存成 null", () => {
    expect(validateGroupNote("")).toEqual({ ok: true, note: null });
    expect(validateGroupNote("   ")).toEqual({ ok: true, note: null });
  });

  it("剛好 200 字可以存", () => {
    const note = "字".repeat(MAX_GROUP_NOTE_LENGTH);
    expect(validateGroupNote(note)).toEqual({ ok: true, note });
  });

  it("超過 200 字回傳錯誤『備註最多 200 字』", () => {
    const note = "字".repeat(MAX_GROUP_NOTE_LENGTH + 1);
    expect(validateGroupNote(note)).toEqual({ ok: false, error: "備註最多 200 字" });
  });

  // 用 Unicode code point 計算長度，不是 UTF-16 code unit——避免 emoji／surrogate pair
  // 被算成 2 個字，跟其他字數限制（例如 checkin note）用同一套規則。
  it("用 Unicode code point 算字數，不是 UTF-16 code unit", () => {
    const note = "🎉".repeat(MAX_GROUP_NOTE_LENGTH);
    expect(validateGroupNote(note)).toEqual({ ok: true, note });
    const tooLong = "🎉".repeat(MAX_GROUP_NOTE_LENGTH + 1);
    expect(validateGroupNote(tooLong)).toEqual({ ok: false, error: "備註最多 200 字" });
  });

  it("超過長度時先修剪頭尾空白再算字數", () => {
    const padded = "  " + "字".repeat(MAX_GROUP_NOTE_LENGTH) + "  ";
    expect(validateGroupNote(padded)).toEqual({ ok: true, note: "字".repeat(MAX_GROUP_NOTE_LENGTH) });
  });
});
