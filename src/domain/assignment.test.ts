import { describe, it, expect } from "vitest";
import { assignmentLabel, validateAssignment, validateSubmissionNote, assignmentDeliverables, parseNeedsConfirm } from "./assignment";
import { systemLight } from "./lights";
import { onTimeRate } from "./on-time";

const base = { title: "市場調查", description: "", deadline: new Date("2026-10-10T15:59:59.999Z"), groupIds: ["g1"] };

describe("validateAssignment", () => {
  it("合法", () => expect(validateAssignment(base)).toEqual({ ok: true }));
  it("標題空白、太長", () => {
    expect(validateAssignment({ ...base, title: "  " })).toEqual({ ok: false, error: "請填寫標題" });
    expect(validateAssignment({ ...base, title: "x".repeat(101) }).ok).toBe(false);
  });
  it("沒有截止、沒有組", () => {
    expect(validateAssignment({ ...base, deadline: null })).toEqual({ ok: false, error: "請填寫截止日期與時間" });
    expect(validateAssignment({ ...base, groupIds: [] })).toEqual({ ok: false, error: "至少要派給一組" });
  });
  it("說明太長", () => expect(validateAssignment({ ...base, description: "x".repeat(2001) }).ok).toBe(false));
});

describe("validateSubmissionNote", () => {
  it("選填，2000 字內", () => {
    expect(validateSubmissionNote("")).toEqual({ ok: true });
    expect(validateSubmissionNote("x".repeat(2001)).ok).toBe(false);
  });
});

describe("作業算進專案線（§17-6）", () => {
  const deadline = new Date("2026-10-01T00:00:00Z");
  it("逾期未交 2 天 → 黃燈，來源寫作業名稱", () => {
    const ds = assignmentDeliverables([{ title: "市場調查", deadline, submittedAt: null }]);
    expect(systemLight(ds, new Date("2026-10-03T00:00:00Z"), { redAfterHours: 72 })).toEqual({
      light: "yellow",
      reason: "系統：作業「市場調查」逾期 2 天",
    });
  });
  it("滿 72 小時 → 紅燈", () => {
    const ds = assignmentDeliverables([{ title: "市場調查", deadline, submittedAt: null }]);
    expect(systemLight(ds, new Date("2026-10-04T00:00:00Z"), { redAfterHours: 72 }).light).toBe("red");
  });
  it("準時率含作業", () => {
    const ds = assignmentDeliverables([
      { title: "A", deadline, submittedAt: new Date("2026-09-30T00:00:00Z") },
      { title: "B", deadline, submittedAt: new Date("2026-10-02T00:00:00Z") },
    ]);
    expect(onTimeRate(ds, new Date("2026-10-05T00:00:00Z"))).toBe(0.5);
  });
});

it("assignmentLabel／parseNeedsConfirm", () => {
  expect(assignmentLabel("X")).toBe("作業「X」");
  expect(parseNeedsConfirm("needs_confirm:3")).toBe(3);
  expect(parseNeedsConfirm("其他錯誤")).toBeNull();
});
