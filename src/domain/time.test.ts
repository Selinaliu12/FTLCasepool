import { describe, it, expect } from "vitest";
import { parseTaipeiDeadline, daysUntil, formatTaipei } from "./time";

describe("parseTaipeiDeadline", () => {
  it("23:59 截止代表台北 23:59:59.999，也就是 UTC 15:59:59.999", () => {
    expect(parseTaipeiDeadline("2026-10-16", "23:59").toISOString()).toBe("2026-10-16T15:59:59.999Z");
  });

  it("格式錯誤直接丟錯，不會默默變成別的日期", () => {
    expect(() => parseTaipeiDeadline("2026/10/16", "23:59")).toThrow("日期或時間格式錯誤");
    expect(() => parseTaipeiDeadline("2026-13-40", "23:59")).toThrow("日期或時間格式錯誤");
  });

  it("非存在的日期被拒絕，如 2026-02-30", () => {
    expect(() => parseTaipeiDeadline("2026-02-30", "23:59")).toThrow("日期或時間格式錯誤");
  });
});

describe("daysUntil", () => {
  it("台北 10/15 早上 7 點（UTC 還是 10/14）看 10/16 截止，剩 1 天", () => {
    const now = new Date("2026-10-14T23:00:00Z"); // 台北 10/15 07:00
    expect(daysUntil(parseTaipeiDeadline("2026-10-16", "23:59"), now)).toBe(1);
  });

  it("當天截止是 0，昨天截止是 -1", () => {
    const now = new Date("2026-10-16T02:00:00Z"); // 台北 10/16 10:00
    expect(daysUntil(parseTaipeiDeadline("2026-10-16", "23:59"), now)).toBe(0);
    expect(daysUntil(parseTaipeiDeadline("2026-10-15", "23:59"), now)).toBe(-1);
  });
});

describe("formatTaipei", () => {
  it("顯示成 10/16（五）23:59，不受伺服器時區影響", () => {
    expect(formatTaipei(parseTaipeiDeadline("2026-10-16", "23:59"))).toBe("10/16（五）23:59");
  });
});

describe("taipeiInputValues", () => {
  it("轉成台北時間的 <input type=date/time> 值（到分）", async () => {
    const { taipeiInputValues } = await import("./time");
    expect(taipeiInputValues(new Date("2026-10-01T15:59:59.999Z"))).toEqual({ date: "2026-10-01", time: "23:59" });
    expect(taipeiInputValues(new Date("2026-10-01T16:00:00Z"))).toEqual({ date: "2026-10-02", time: "00:00" });
  });
});
