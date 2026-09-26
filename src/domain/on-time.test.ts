import { describe, it, expect } from "vitest";
import { onTimeRate } from "./on-time";
import { parseTaipeiDeadline } from "./time";
import type { Deliverable } from "./lights";

describe("onTimeRate", () => {
  it("沒有已到期項目 → null（畫面顯示『—』）", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const ds: Deliverable[] = [{ label: "第 1 期", deadline: new Date("2026-10-10T00:00:00Z"), submittedAt: null }];
    expect(onTimeRate(ds, now)).toBeNull();
  });

  it("3 期到期、2 期準時 → 2/3", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    const ds: Deliverable[] = [
      { label: "第 1 期", deadline: new Date("2026-10-01T00:00:00Z"), submittedAt: new Date("2026-09-30T00:00:00Z") },
      { label: "第 2 期", deadline: new Date("2026-10-02T00:00:00Z"), submittedAt: new Date("2026-10-02T00:00:00Z") },
      { label: "第 3 期", deadline: new Date("2026-10-03T00:00:00Z"), submittedAt: new Date("2026-10-04T00:00:00Z") },
    ];
    expect(onTimeRate(ds, now)).toBe(2 / 3);
  });

  it("晚交的算不準時；到期沒交的也算不準時", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    const ds: Deliverable[] = [
      { label: "第 1 期", deadline: new Date("2026-10-01T00:00:00Z"), submittedAt: new Date("2026-10-02T00:00:00Z") }, // late
      { label: "第 2 期", deadline: new Date("2026-10-02T00:00:00Z"), submittedAt: null }, // not submitted
    ];
    expect(onTimeRate(ds, now)).toBe(0);
  });

  it("23:59 截止、23:59:40 交 → 準時", () => {
    const deadline = parseTaipeiDeadline("2026-10-16", "23:59");
    const submittedAt = new Date("2026-10-16T15:59:40.000Z"); // 台北 23:59:40
    const now = new Date("2026-10-17T00:00:00Z");
    const ds: Deliverable[] = [{ label: "第 1 期", deadline, submittedAt }];
    expect(onTimeRate(ds, now)).toBe(1);
  });

  it("還沒到期的項目不算進分母", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    const ds: Deliverable[] = [
      { label: "第 1 期", deadline: new Date("2026-10-01T00:00:00Z"), submittedAt: new Date("2026-09-30T00:00:00Z") }, // due, on time
      { label: "第 2 期", deadline: new Date("2026-11-01T00:00:00Z"), submittedAt: null }, // not due yet
    ];
    expect(onTimeRate(ds, now)).toBe(1);
  });
});
