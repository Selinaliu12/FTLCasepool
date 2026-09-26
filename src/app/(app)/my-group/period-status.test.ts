import { describe, it, expect } from "vitest";
import { daysLeft } from "./period-status";

describe("daysLeft", () => {
  it("deadline 就是今天（台北時區）→ 0，不是 -0", () => {
    const now = new Date("2026-10-01T01:00:00Z"); // 09:00 台北
    const deadline = new Date("2026-10-01T15:59:59.999Z"); // 23:59:59.999 台北，同一天
    const result = daysLeft(deadline, now);
    expect(result).toBe(0);
    expect(Object.is(result, -0)).toBe(false);
  });

  it("deadline 是明天 → 1", () => {
    const now = new Date("2026-10-01T01:00:00Z");
    const deadline = new Date("2026-10-02T15:59:59.999Z");
    expect(daysLeft(deadline, now)).toBe(1);
  });

  it("deadline 是 36 天後 → 36", () => {
    const now = new Date("2026-09-26T01:00:00Z");
    const deadline = new Date("2026-11-01T15:59:59.999Z");
    expect(daysLeft(deadline, now)).toBe(36);
  });
});
