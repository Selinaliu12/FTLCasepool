import { describe, it, expect } from "vitest";
import { deadlineLabel } from "./competition-label";

describe("deadlineLabel", () => {
  it("還沒到今天 → 剩 N 天", () => {
    const now = new Date("2026-10-01T00:00:00Z"); // 台北 08:00
    const deadline = new Date("2026-10-03T15:59:59.999Z"); // 台北 10/3 23:59
    expect(deadlineLabel(deadline, now)).toBe("剩 2 天");
  });

  it("今天截止 → 今天截止", () => {
    const now = new Date("2026-10-03T01:00:00Z"); // 台北 10/3 09:00
    const deadline = new Date("2026-10-03T15:59:59.999Z"); // 台北 10/3 23:59
    expect(deadlineLabel(deadline, now)).toBe("今天截止");
  });

  it("已經過了 → 已截止", () => {
    const now = new Date("2026-10-05T00:00:00Z");
    const deadline = new Date("2026-10-03T15:59:59.999Z");
    expect(deadlineLabel(deadline, now)).toBe("已截止");
  });
});
