import { describe, it, expect } from "vitest";
import { validateProgress, lateBy, validateCheckin, submissionTiming, type ProgressInput } from "./progress";

const validInput: ProgressInput = {
  light: "green",
  did: "寫完了報告",
  blocked: "沒有卡關",
  nextSteps: "下一步整理簡報",
  hasPdf: true,
};

describe("validateProgress", () => {
  it("沒選燈號 → 錯誤『請選燈號』", () => {
    const result = validateProgress({ ...validInput, light: null });
    expect(result).toEqual({ ok: false, errors: { light: "請選燈號" } });
  });

  it("三句話任一句空白（含只打空白）→ 錯誤『請填寫這一句』", () => {
    const result = validateProgress({ ...validInput, did: "   " });
    expect(result).toEqual({ ok: false, errors: { did: "請填寫這一句" } });
  });

  it("blocked 空白 → 錯誤", () => {
    const result = validateProgress({ ...validInput, blocked: "" });
    expect(result).toEqual({ ok: false, errors: { blocked: "請填寫這一句" } });
  });

  it("nextSteps 空白 → 錯誤", () => {
    const result = validateProgress({ ...validInput, nextSteps: "" });
    expect(result).toEqual({ ok: false, errors: { nextSteps: "請填寫這一句" } });
  });

  it("沒附 PDF → 錯誤『請附上 PDF』", () => {
    const result = validateProgress({ ...validInput, hasPdf: false });
    expect(result).toEqual({ ok: false, errors: { hasPdf: "請附上 PDF" } });
  });

  it("都填齊 → ok", () => {
    expect(validateProgress(validInput)).toEqual({ ok: true });
  });

  it("多個欄位同時錯 → 一次回傳所有錯誤", () => {
    const result = validateProgress({ light: null, did: "", blocked: "  ", nextSteps: "x", hasPdf: false });
    expect(result).toEqual({
      ok: false,
      errors: {
        light: "請選燈號",
        did: "請填寫這一句",
        blocked: "請填寫這一句",
        hasPdf: "請附上 PDF",
      },
    });
  });
});

describe("lateBy", () => {
  it("23:59 截止、23:59:40 交 → 不算逾期", () => {
    const deadline = new Date("2026-10-16T15:59:59.999Z"); // Taipei 23:59:59.999
    const submittedAt = new Date("2026-10-16T15:59:40.000Z");
    expect(lateBy(deadline, submittedAt)).toEqual({ late: false });
  });

  it("隔天 00:00:01 交 → 逾期，hours = 0", () => {
    const deadline = new Date("2026-10-16T15:59:59.999Z");
    const submittedAt = new Date("2026-10-16T16:00:01.000Z"); // 1s after Taipei 23:59:59.999
    expect(lateBy(deadline, submittedAt)).toEqual({ late: true, hours: 0 });
  });

  it("晚 50 小時 → hours = 50", () => {
    const deadline = new Date("2026-10-16T15:59:59.999Z");
    const submittedAt = new Date(deadline.getTime() + 50 * 3_600_000);
    expect(lateBy(deadline, submittedAt)).toEqual({ late: true, hours: 50 });
  });
});

describe("validateCheckin", () => {
  it("紅燈沒寫卡在哪裡 → 錯誤『紅燈請補一句卡在哪裡』", () => {
    expect(validateCheckin({ light: "red", note: "" })).toEqual({
      ok: false,
      error: "紅燈請補一句卡在哪裡",
    });
  });

  it("紅燈只打空白也算沒寫", () => {
    expect(validateCheckin({ light: "red", note: "   " })).toEqual({
      ok: false,
      error: "紅燈請補一句卡在哪裡",
    });
  });

  it("黃燈不用寫 note", () => {
    expect(validateCheckin({ light: "yellow", note: "" })).toEqual({ ok: true });
  });

  it("綠燈不用寫 note", () => {
    expect(validateCheckin({ light: "green", note: "" })).toEqual({ ok: true });
  });

  it("紅燈有寫 → ok", () => {
    expect(validateCheckin({ light: "red", note: "卡在資料庫" })).toEqual({ ok: true });
  });

  it("沒選燈號 → 錯誤", () => {
    expect(validateCheckin({ light: null, note: "" })).toEqual({ ok: false, error: "請選燈號" });
  });
});

// 最終審查 #3：規格 §4.4「截止後仍可補交，系統標記逾期天數」——已交的期別要標示準時或逾期多久。
describe("submissionTiming", () => {
  const deadline = new Date("2026-10-16T15:59:59.999Z"); // 台北 10/16 23:59:59.999

  it("截止前（含剛好截止）交 → 準時", () => {
    expect(submissionTiming(deadline, new Date("2026-10-16T15:00:00Z"))).toEqual({ late: false, label: "準時" });
    expect(submissionTiming(deadline, deadline)).toEqual({ late: false, label: "準時" });
  });

  it("晚 5 小時 → 逾期 5 小時", () => {
    expect(submissionTiming(deadline, new Date(deadline.getTime() + 5 * 3_600_000 + 60_000))).toEqual({
      late: true,
      label: "逾期 5 小時",
    });
  });

  it("晚 50 小時 → 逾期 2 天", () => {
    expect(submissionTiming(deadline, new Date(deadline.getTime() + 50 * 3_600_000))).toEqual({
      late: true,
      label: "逾期 2 天",
    });
  });

  it("晚不到 1 小時 → 逾期不到 1 小時（不顯示「逾期 0 小時」）", () => {
    expect(submissionTiming(deadline, new Date(deadline.getTime() + 1000))).toEqual({
      late: true,
      label: "逾期不到 1 小時",
    });
  });
});
