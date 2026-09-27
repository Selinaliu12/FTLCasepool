import { describe, it, expect } from "vitest";
import { worstLight, sortGroupCards, buildGroupCard, formatNextDeadline, type GroupCard } from "./dashboard";
import { systemLight, reporterLight, displayLight, type Deliverable } from "./lights";
import { onTimeRate } from "./on-time";
import { daysUntil } from "./time";

function card(overrides: Partial<GroupCard> = {}): GroupCard {
  return {
    groupId: "g1",
    groupName: "第一組",
    projectName: "專案 A",
    lines: [{ lineId: "l1", kind: "project", label: "專案", status: null, light: "green", source: "組員回報", onTime: 1 }],
    stage: "第 2 期",
    nextDeadline: null,
    ...overrides,
  };
}

describe("worstLight", () => {
  it("回傳卡片中最差的燈號", () => {
    const c = card({
      lines: [
        { lineId: "l1", kind: "project", label: "專案", status: null, light: "green", source: "s", onTime: 1 },
        { lineId: "l2", kind: "project", label: "專案", status: null, light: "red", source: "s", onTime: 0 },
      ],
    });
    expect(worstLight(c)).toBe("red");
  });

  it("比賽線的燈號也算進最嚴重的燈（不是只看第一條專案線）", () => {
    const c = card({
      lines: [
        { lineId: "l1", kind: "project", label: "專案", status: null, light: "green", source: "s", onTime: 1 },
        { lineId: "l2", kind: "competition", label: "黑客松 報名", status: null, light: "red", source: "系統：黑客松 報名逾期 4 天", onTime: 0 },
      ],
    });
    expect(worstLight(c)).toBe("red");
  });

  // fix round 1（controller ruling）：已結束的線 light 是 null，worstLight 要跳過它，不能
  // 因為它排在陣列前面就被誤判成「這組沒有燈」。
  it("已結束的線（light 為 null）不影響最嚴重的燈", () => {
    const c = card({
      lines: [
        { lineId: "l1", kind: "competition", label: "黑客松", status: "得獎", light: null, source: null, onTime: 1 },
        { lineId: "l2", kind: "project", label: "專案", status: null, light: "yellow", source: "s", onTime: 0.5 },
      ],
    });
    expect(worstLight(c)).toBe("yellow");
  });

  it("全部線都是 null（例如整組只剩已結束的比賽線）→ 綠燈", () => {
    const c = card({
      lines: [{ lineId: "l1", kind: "competition", label: "黑客松", status: "未入選", light: null, source: null, onTime: null }],
    });
    expect(worstLight(c)).toBe("green");
  });
});

describe("sortGroupCards", () => {
  it("紅燈組排最前，其次黃，再來綠；同色依組名", () => {
    const red = card({ groupId: "r", groupName: "紅組", lines: [{ lineId: "l1", kind: "project", label: "專案", status: null, light: "red", source: "s", onTime: 0 }] });
    const yellow = card({ groupId: "y", groupName: "黃組", lines: [{ lineId: "l1", kind: "project", label: "專案", status: null, light: "yellow", source: "s", onTime: 0.5 }] });
    const greenB = card({ groupId: "gb", groupName: "B組", lines: [{ lineId: "l1", kind: "project", label: "專案", status: null, light: "green", source: "s", onTime: 1 }] });
    const greenA = card({ groupId: "ga", groupName: "A組", lines: [{ lineId: "l1", kind: "project", label: "專案", status: null, light: "green", source: "s", onTime: 1 }] });
    const input = [greenB, yellow, greenA, red];
    const sorted = sortGroupCards(input);
    expect(sorted.map((c) => c.groupId)).toEqual(["r", "y", "ga", "gb"]);
  });

  it("同色依組名為數字感知排序（第 1 組先於第 2 組先於第 10 組）", () => {
    const g10 = card({ groupId: "g10", groupName: "第10組" });
    const g2 = card({ groupId: "g2", groupName: "第2組" });
    const g1 = card({ groupId: "g1", groupName: "第1組" });
    const sorted = sortGroupCards([g10, g2, g1]);
    expect(sorted.map((c) => c.groupId)).toEqual(["g1", "g2", "g10"]);
  });

  it("不改變原本傳入的陣列", () => {
    const red = card({ groupId: "r", groupName: "紅組", lines: [{ lineId: "l1", kind: "project", label: "專案", status: null, light: "red", source: "s", onTime: 0 }] });
    const greenA = card({ groupId: "ga", groupName: "甲組" });
    const input = [greenA, red];
    const copy = [...input];
    sortGroupCards(input);
    expect(input).toEqual(copy);
  });
});

describe("buildGroupCard", () => {
  const now = new Date("2026-10-20T00:00:00Z");

  it("下一個截止日是最近一個還沒過的期別，剩幾天用台北日曆", () => {
    const periods = [
      { seq: 1, deadline: new Date("2026-10-10T15:59:59.999Z") },
      { seq: 2, deadline: new Date("2026-10-25T15:59:59.999Z") },
      { seq: 3, deadline: new Date("2026-11-05T15:59:59.999Z") },
    ];
    const result = buildGroupCard({
      group: { id: "g1", name: "第一組", projectName: "專案 A" },
      lineId: "l1",
      periods,
      submissions: [{ periodSeq: 1, submittedAt: new Date("2026-10-09T00:00:00Z") }],
      events: [],
      now,
      redAfterHours: 72,
    });
    expect(result.nextDeadline).toEqual({
      at: periods[1].deadline,
      daysLeft: daysUntil(periods[1].deadline, now),
    });
    expect(result.stage).toBe("第 2 期");
  });

  it("全部期別都過了 → nextDeadline null、stage『本學期期別已結束』", () => {
    const periods = [{ seq: 1, deadline: new Date("2026-10-10T15:59:59.999Z") }];
    const result = buildGroupCard({
      group: { id: "g1", name: "第一組", projectName: "專案 A" },
      lineId: "l1",
      periods,
      submissions: [{ periodSeq: 1, submittedAt: new Date("2026-10-09T00:00:00Z") }],
      events: [],
      now,
      redAfterHours: 72,
    });
    expect(result.nextDeadline).toBeNull();
    expect(result.stage).toBe("本學期期別已結束");
  });

  it("燈號與準時率正確帶入（用 Task 11 的函式，不重算）", () => {
    const periods = [
      { seq: 1, deadline: new Date("2026-10-10T15:59:59.999Z") },
      { seq: 2, deadline: new Date("2026-10-25T15:59:59.999Z") },
    ];
    const submissions = [{ periodSeq: 1, submittedAt: new Date("2026-10-12T00:00:00Z") }];
    const events = [{ light: "yellow" as const, at: new Date("2026-10-15T00:00:00Z") }];
    const redAfterHours = 72;

    const result = buildGroupCard({
      group: { id: "g1", name: "第一組", projectName: "專案 A" },
      lineId: "l1",
      periods,
      submissions,
      events,
      now,
      redAfterHours,
    });

    const deliverables: Deliverable[] = periods.map((p) => ({
      label: `第 ${p.seq} 期`,
      deadline: p.deadline,
      submittedAt: submissions.find((s) => s.periodSeq === p.seq)?.submittedAt ?? null,
    }));
    const sys = systemLight(deliverables, now, { redAfterHours });
    const reporter = reporterLight(events);
    const expectedDisplay = displayLight(reporter, sys);
    const expectedOnTime = onTimeRate(deliverables, now);

    expect(result.lines).toEqual([
      { lineId: "l1", kind: "project", label: "專案", status: null, light: expectedDisplay.light, source: expectedDisplay.source, onTime: expectedOnTime },
    ]);
  });
});

describe("formatNextDeadline", () => {
  it("null → 本學期期別已結束", () => {
    expect(formatNextDeadline(null)).toBe("本學期期別已結束");
  });

  it("剩 5 天 → 日期時間 · 剩 5 天", () => {
    const at = new Date("2026-10-16T15:59:59.999Z"); // 台北時間 10/16（五）23:59
    expect(formatNextDeadline({ at, daysLeft: 5 })).toBe("10/16（五）23:59 · 剩 5 天");
  });

  it("剩 0 天 → 今天截止", () => {
    const at = new Date("2026-10-16T15:59:59.999Z");
    expect(formatNextDeadline({ at, daysLeft: 0 })).toBe("10/16（五）23:59 · 今天截止");
  });
});

// 最終審查 M10：管理頁的「截止」一行之前拿的是期別表的「最後一期」，不是「下一期」。
describe("upcomingPeriod", () => {
  const periods = [
    { seq: 1, deadline: new Date("2026-10-01T15:59:59.999Z") },
    { seq: 2, deadline: new Date("2026-10-15T15:59:59.999Z") },
    { seq: 3, deadline: new Date("2026-10-29T15:59:59.999Z") },
  ];

  it("回傳還沒截止、最早的那一期", async () => {
    const { upcomingPeriod } = await import("./dashboard");
    expect(upcomingPeriod(periods, new Date("2026-10-05T00:00:00Z"))?.seq).toBe(2);
  });

  it("全部都截止了 → null", async () => {
    const { upcomingPeriod } = await import("./dashboard");
    expect(upcomingPeriod(periods, new Date("2026-11-01T00:00:00Z"))).toBeNull();
  });
});
