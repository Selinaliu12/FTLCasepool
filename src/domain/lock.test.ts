import { describe, it, expect } from "vitest";
import { LOCK_MS, lockedAt, isLocked } from "./lock";

describe("lock", () => {
  it("LOCK_MS 為 2 小時", () => {
    expect(LOCK_MS).toBe(2 * 60 * 60 * 1000);
  });

  it("lockedAt 回傳上傳時間 + 2 小時", () => {
    const uploadedAt = new Date("2026-10-16T10:00:00Z");
    expect(lockedAt(uploadedAt)).toEqual(new Date("2026-10-16T12:00:00Z"));
  });

  it("上傳後 1 小時 59 分 59 秒 → 未鎖", () => {
    const uploadedAt = new Date("2026-10-16T10:00:00Z");
    const now = new Date(uploadedAt.getTime() + (2 * 60 * 60 * 1000 - 1000));
    expect(isLocked(uploadedAt, now)).toBe(false);
  });

  it("剛好 2 小時 → 已鎖", () => {
    const uploadedAt = new Date("2026-10-16T10:00:00Z");
    const now = new Date(uploadedAt.getTime() + 2 * 60 * 60 * 1000);
    expect(isLocked(uploadedAt, now)).toBe(true);
  });
});
