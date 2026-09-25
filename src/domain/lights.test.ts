import { describe, it, expect } from "vitest";
import { systemLight, reporterLight, displayLight, type Deliverable } from "./lights";

describe("systemLight", () => {
  it("沒有到期項目 → 綠，reason null", () => {
    const now = new Date("2026-10-14T23:00:00Z");
    const ds: Deliverable[] = [];
    expect(systemLight(ds, now, { redAfterHours: 72 })).toEqual({ light: "green", reason: null });
  });

  it("過截止 1 小時未交 → 黃，『系統：第 2 期逾期 1 小時』", () => {
    const deadline = new Date("2026-10-14T00:00:00Z");
    const now = new Date("2026-10-14T01:00:00Z");
    const ds: Deliverable[] = [{ label: "第 2 期", deadline, submittedAt: null }];
    expect(systemLight(ds, now, { redAfterHours: 72 })).toEqual({
      light: "yellow",
      reason: "系統：第 2 期逾期 1 小時",
    });
  });

  it("過截止 71 小時 59 分 → 黃", () => {
    const deadline = new Date("2026-10-14T00:00:00Z");
    const now = new Date("2026-10-16T23:59:00Z"); // 71h59m later
    const ds: Deliverable[] = [{ label: "第 2 期", deadline, submittedAt: null }];
    expect(systemLight(ds, now, { redAfterHours: 72 }).light).toBe("yellow");
  });

  it("過截止剛好 72 小時 → 紅，『系統：第 2 期逾期 3 天』", () => {
    const deadline = new Date("2026-10-14T00:00:00Z");
    const now = new Date("2026-10-17T00:00:00Z"); // exactly 72h
    const ds: Deliverable[] = [{ label: "第 2 期", deadline, submittedAt: null }];
    expect(systemLight(ds, now, { redAfterHours: 72 })).toEqual({
      light: "red",
      reason: "系統：第 2 期逾期 3 天",
    });
  });

  it("門檻改成 48 → 過 48 小時就紅", () => {
    const deadline = new Date("2026-10-14T00:00:00Z");
    const now = new Date("2026-10-16T00:00:00Z"); // 48h later
    const ds: Deliverable[] = [{ label: "第 2 期", deadline, submittedAt: null }];
    expect(systemLight(ds, now, { redAfterHours: 48 }).light).toBe("red");
  });

  it("逾期但已補交 → 綠（補交立即重新判定）", () => {
    const deadline = new Date("2026-10-14T00:00:00Z");
    const now = new Date("2026-10-17T00:00:00Z");
    const ds: Deliverable[] = [{ label: "第 2 期", deadline, submittedAt: new Date("2026-10-16T00:00:00Z") }];
    expect(systemLight(ds, now, { redAfterHours: 72 })).toEqual({ light: "green", reason: null });
  });

  it("兩期都欠，取最嚴重那期當 reason", () => {
    const now = new Date("2026-10-17T00:00:00Z");
    const ds: Deliverable[] = [
      { label: "第 1 期", deadline: new Date("2026-10-16T00:00:00Z"), submittedAt: null }, // 24h -> yellow
      { label: "第 2 期", deadline: new Date("2026-10-14T00:00:00Z"), submittedAt: null }, // 72h -> red
    ];
    expect(systemLight(ds, now, { redAfterHours: 72 })).toEqual({
      light: "red",
      reason: "系統：第 2 期逾期 3 天",
    });
  });

  it("returned: true → 黃，『系統：第 2 期被退回』", () => {
    const now = new Date("2026-10-14T00:00:00Z");
    const ds: Deliverable[] = [
      { label: "第 2 期", deadline: new Date("2026-10-20T00:00:00Z"), submittedAt: new Date("2026-10-10T00:00:00Z"), returned: true },
    ];
    expect(systemLight(ds, now, { redAfterHours: 72 })).toEqual({
      light: "yellow",
      reason: "系統：第 2 期被退回",
    });
  });

  it("還沒到截止、未交 → 綠", () => {
    const now = new Date("2026-10-14T00:00:00Z");
    const ds: Deliverable[] = [{ label: "第 2 期", deadline: new Date("2026-10-20T00:00:00Z"), submittedAt: null }];
    expect(systemLight(ds, now, { redAfterHours: 72 })).toEqual({ light: "green", reason: null });
  });
});

describe("reporterLight", () => {
  it("沒有回報 → null", () => {
    expect(reporterLight([])).toBeNull();
  });

  it("取時間最新的一筆，不管是雙週進度還是中間週", () => {
    const events = [
      { light: "red" as const, at: new Date("2026-10-01T00:00:00Z") },
      { light: "green" as const, at: new Date("2026-10-10T00:00:00Z") },
      { light: "yellow" as const, at: new Date("2026-10-05T00:00:00Z") },
    ];
    expect(reporterLight(events)).toBe("green");
  });
});

describe("displayLight", () => {
  it("回報紅、系統綠 → 紅，來源『組員回報』", () => {
    expect(displayLight("red", { light: "green", reason: null })).toEqual({
      light: "red",
      source: "組員回報",
    });
  });

  it("回報綠、系統紅 → 紅，來源『系統：第 2 期逾期 3 天』", () => {
    expect(displayLight("green", { light: "red", reason: "系統：第 2 期逾期 3 天" })).toEqual({
      light: "red",
      source: "系統：第 2 期逾期 3 天",
    });
  });

  it("一樣嚴重（都黃）→ 來源『組員回報＋系統：第 2 期逾期 1 天』", () => {
    expect(displayLight("yellow", { light: "yellow", reason: "系統：第 2 期逾期 1 天" })).toEqual({
      light: "yellow",
      source: "組員回報＋系統：第 2 期逾期 1 天",
    });
  });

  it("沒有回報、系統綠 → 綠，來源『系統：沒有欠交』", () => {
    expect(displayLight(null, { light: "green", reason: null })).toEqual({
      light: "green",
      source: "系統：沒有欠交",
    });
  });

  it("都綠 → 綠，來源『組員回報』", () => {
    expect(displayLight("green", { light: "green", reason: null })).toEqual({
      light: "green",
      source: "組員回報",
    });
  });
});
