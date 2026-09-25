import { describe, it, expect } from "vitest";
import { worstLight, sortGroupCards, buildGroupCard, type GroupCard } from "./dashboard";
import { systemLight, reporterLight, displayLight, type Deliverable } from "./lights";
import { onTimeRate } from "./on-time";
import { daysUntil } from "./time";

function card(overrides: Partial<GroupCard> = {}): GroupCard {
  return {
    groupId: "g1",
    groupName: "第一組",
    projectName: "專案 A",
    lines: [{ lineId: "l1", kind: "project", light: "green", source: "組員回報", onTime: 1 }],
    stage: "第 2 期",
    nextDeadline: null,
    ...overrides,
  };
}

describe("worstLight", () => {
  it("回傳卡片中最差的燈號", () => {
    const c = card({
      lines: [
        { lineId: "l1", kind: "project", light: "green", source: "s", onTime: 1 },
        { lineId: "l2", kind: "project", light: "red", source: "s", onTime: 0 },
      ],
    });
    expect(worstLight(c)).toBe("red");
  });
});

describe("sortGroupCards", () => {
  it("紅燈組排最前，其次黃，再來綠；同色依組名", () => {
    const red = card({ groupId: "r", groupName: "紅組", lines: [{ lineId: "l1", kind: "project", light: "red", source: "s", onTime: 0 }] });
    const yellow = card({ groupId: "y", groupName: "黃組", lines: [{ lineId: "l1", kind: "project", light: "yellow", source: "s", onTime: 0.5 }] });
    const greenB = card({ groupId: "gb", groupName: "B組", lines: [{ lineId: "l1", kind: "project", light: "green", source: "s", onTime: 1 }] });
    const greenA = card({ groupId: "ga", groupName: "A組", lines: [{ lineId: "l1", kind: "project", light: "green", source: "s", onTime: 1 }] });
    const input = [greenB, yellow, greenA, red];
    const sorted = sortGroupCards(input);
    expect(sorted.map((c) => c.groupId)).toEqual(["r", "y", "ga", "gb"]);
  });

  it("不改變原本傳入的陣列", () => {
    const red = card({ groupId: "r", groupName: "紅組", lines: [{ lineId: "l1", kind: "project", light: "red", source: "s", onTime: 0 }] });
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
      { lineId: "l1", kind: "project", light: expectedDisplay.light, source: expectedDisplay.source, onTime: expectedOnTime },
    ]);
  });
});
