import { describe, it, expect } from "vitest";
import {
  competitionStages,
  competitionLineLight,
  competitionOnTime,
  competitionStatus,
  type EntryInput,
  type CompetitionDeadlines,
  type StageSubmissionInput,
} from "./competition-line";

const comp: CompetitionDeadlines = {
  signupDeadline: new Date("2026-10-01T15:59:59.999Z"),
  submissionDeadline: new Date("2026-11-01T15:59:59.999Z"),
  finalDate: new Date("2026-12-01T15:59:59.999Z"),
};

const confirmedEntry: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: null, result: null };

describe("competitionStages", () => {
  it("截止日為 null 的階段一律 required=false，不判逾期", () => {
    const noFinalDeadline: CompetitionDeadlines = { ...comp, finalDate: null };
    const stages = competitionStages(noFinalDeadline, confirmedEntry, [], new Date("2027-01-01T00:00:00Z"));
    const final = stages.find((s) => s.key === "final")!;
    expect(final.deadline).toBeNull();
    expect(final.required).toBe(false);
  });

  it("未確認報名的階段不 required", () => {
    const unconfirmed: EntryInput = { confirmedAt: null, withdrawnAt: null, result: null };
    const stages = competitionStages(comp, unconfirmed, [], new Date("2026-10-15T00:00:00Z"));
    expect(stages.every((s) => s.required === false)).toBe(true);
  });

  it("已退出的報名，三個階段一律不 required", () => {
    const withdrawn: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: new Date("2026-09-15T00:00:00Z"), result: null };
    const stages = competitionStages(comp, withdrawn, [], new Date("2026-10-15T00:00:00Z"));
    expect(stages.every((s) => s.required === false)).toBe(true);
  });

  it("未入選之後，還沒交的決賽階段不 required；已經交過的報名階段仍 required", () => {
    const notSelected: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: null, result: "not_selected" };
    const submissions: StageSubmissionInput[] = [
      { stage: "signup", version: 1, pdfUploadedAt: new Date("2026-09-20T00:00:00Z"), reviewStatus: "approved" },
    ];
    const stages = competitionStages(comp, notSelected, submissions, new Date("2026-11-15T00:00:00Z"));
    expect(stages.find((s) => s.key === "final")!.required).toBe(false);
    expect(stages.find((s) => s.key === "submission")!.required).toBe(false);
    expect(stages.find((s) => s.key === "signup")!.required).toBe(true);
  });

  it("得獎（晉級到底）之後，決賽階段不 required", () => {
    const awarded: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: null, result: "awarded" };
    const stages = competitionStages(comp, awarded, [], new Date("2026-12-15T00:00:00Z"));
    expect(stages.find((s) => s.key === "final")!.required).toBe(false);
  });

  it("result=advanced（晉級中）時決賽仍 required", () => {
    const advanced: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: null, result: "advanced" };
    const stages = competitionStages(comp, advanced, [], new Date("2026-11-15T00:00:00Z"));
    expect(stages.find((s) => s.key === "final")!.required).toBe(true);
  });

  it("firstSubmittedAt 是該階段最早一次送出的時間，退回重交不會改變它", () => {
    const submissions: StageSubmissionInput[] = [
      { stage: "signup", version: 1, pdfUploadedAt: new Date("2026-09-10T00:00:00Z"), reviewStatus: "returned" },
      { stage: "signup", version: 2, pdfUploadedAt: new Date("2026-09-25T00:00:00Z"), reviewStatus: "approved" },
    ];
    const stages = competitionStages(comp, confirmedEntry, submissions, new Date("2026-09-30T00:00:00Z"));
    const signup = stages.find((s) => s.key === "signup")!;
    expect(signup.firstSubmittedAt).toEqual(new Date("2026-09-10T00:00:00Z"));
    expect(signup.latest).toEqual({ version: 2, status: "approved", locked: true });
    expect(signup.completedAt).toEqual(new Date("2026-09-25T00:00:00Z"));
  });

  it("被退回且沒有更新版本：latest.status = returned，completedAt 為 null", () => {
    const submissions: StageSubmissionInput[] = [
      { stage: "submission", version: 1, pdfUploadedAt: new Date("2026-10-20T00:00:00Z"), reviewStatus: "returned" },
    ];
    const stages = competitionStages(comp, confirmedEntry, submissions, new Date("2026-10-21T00:00:00Z"));
    const submission = stages.find((s) => s.key === "submission")!;
    expect(submission.latest?.status).toBe("returned");
    expect(submission.completedAt).toBeNull();
  });

  it("locked：上傳滿 2 小時才算鎖定", () => {
    const submissions: StageSubmissionInput[] = [
      { stage: "signup", version: 1, pdfUploadedAt: new Date("2026-09-10T00:00:00Z"), reviewStatus: "pending" },
    ];
    const justUnder = competitionStages(comp, confirmedEntry, submissions, new Date("2026-09-10T01:59:00Z"));
    expect(justUnder.find((s) => s.key === "signup")!.latest?.locked).toBe(false);
    const over = competitionStages(comp, confirmedEntry, submissions, new Date("2026-09-10T02:00:01Z"));
    expect(over.find((s) => s.key === "signup")!.latest?.locked).toBe(true);
  });

  // Review Focus 1：截止日被改早後，以新截止日計算逾期／準時，不是幹部改之前記錄的舊值。
  it("Review Focus 1：截止日被改早之後（還沒送出），用新截止日判斷逾期", () => {
    // 原本報名截止日 10/1，現在 (9/16) 還沒到期、不會判逾期。
    const now = new Date("2026-09-16T00:00:00Z");
    const before = competitionStages(comp, confirmedEntry, [], now);
    expect(competitionLineLight("測試賽", before, now, { redAfterHours: 72 })).toEqual({ light: "green", reason: null });

    // 幹部把報名截止日改早到 9/15：同一個 now (9/16) 用新截止日算，已經逾期 8 小時。
    const movedEarlier: CompetitionDeadlines = { ...comp, signupDeadline: new Date("2026-09-15T15:59:59.999Z") };
    const after = competitionStages(movedEarlier, confirmedEntry, [], now);
    const signup = after.find((s) => s.key === "signup")!;
    expect(signup.deadline).toEqual(movedEarlier.signupDeadline);

    const light = competitionLineLight("測試賽", after, now, { redAfterHours: 72 });
    expect(light.light).toBe("yellow");
    expect(light.reason).toBe("系統：測試賽 報名逾期 8 小時");
  });

  it("Review Focus 1：已送出的階段不受截止日改早影響（light 只看是否已送出，不看送出是否已晚）", () => {
    const submittedAt = new Date("2026-10-05T00:00:00Z");
    const submissions: StageSubmissionInput[] = [
      { stage: "signup", version: 1, pdfUploadedAt: submittedAt, reviewStatus: "approved" },
    ];
    const movedEarlier: CompetitionDeadlines = { ...comp, signupDeadline: new Date("2026-09-01T15:59:59.999Z") };
    const now = new Date("2026-10-06T00:00:00Z");
    const stages = competitionStages(movedEarlier, confirmedEntry, submissions, now);
    const signup = stages.find((s) => s.key === "signup")!;
    expect(signup.deadline).toEqual(movedEarlier.signupDeadline);
    expect(signup.firstSubmittedAt).toEqual(submittedAt);

    const light = competitionLineLight("測試賽", stages, now, { redAfterHours: 72 });
    expect(light).toEqual({ light: "green", reason: null });
    // 但準時率仍要看新截止日：9/1 截止、10/5 才交 → 不準時。
    expect(competitionOnTime(stages, now)).toBe(0);
  });
});

describe("competitionLineLight", () => {
  it("沒有任何必要階段逾期或被退回 → 綠燈", () => {
    const stages = competitionStages(comp, confirmedEntry, [], new Date("2026-09-15T00:00:00Z"));
    const light = competitionLineLight("測試賽", stages, new Date("2026-09-15T00:00:00Z"), { redAfterHours: 72 });
    expect(light).toEqual({ light: "green", reason: null });
  });

  it("逾期未滿 72 小時 → 黃燈，原因帶比賽名與階段名", () => {
    const now = new Date(comp.signupDeadline.getTime() + 10 * 3_600_000);
    const stages = competitionStages(comp, confirmedEntry, [], now);
    const light = competitionLineLight("黑客松", stages, now, { redAfterHours: 72 });
    expect(light.light).toBe("yellow");
    expect(light.reason).toBe("系統：黑客松 報名逾期 10 小時");
  });

  it("逾期滿 72 小時 → 紅燈", () => {
    const now = new Date(comp.signupDeadline.getTime() + 96 * 3_600_000);
    const stages = competitionStages(comp, confirmedEntry, [], now);
    const light = competitionLineLight("黑客松", stages, now, { redAfterHours: 72 });
    expect(light.light).toBe("red");
    expect(light.reason).toBe("系統：黑客松 報名逾期 4 天");
  });

  it("退回未重交 → 黃燈，即使還沒到截止日", () => {
    const submissions: StageSubmissionInput[] = [
      { stage: "signup", version: 1, pdfUploadedAt: new Date("2026-09-10T00:00:00Z"), reviewStatus: "returned" },
    ];
    const now = new Date("2026-09-15T00:00:00Z"); // 早於 signupDeadline 10/1
    const stages = competitionStages(comp, confirmedEntry, submissions, now);
    const light = competitionLineLight("黑客松", stages, now, { redAfterHours: 72 });
    expect(light.light).toBe("yellow");
    expect(light.reason).toBe("系統：黑客松 報名被退回");
  });

  it("已退出的報名不判燈（一律綠）", () => {
    const withdrawn: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: new Date("2026-09-15T00:00:00Z"), result: null };
    const now = new Date(comp.signupDeadline.getTime() + 96 * 3_600_000);
    const stages = competitionStages(comp, withdrawn, [], now);
    const light = competitionLineLight("黑客松", stages, now, { redAfterHours: 72 });
    expect(light).toEqual({ light: "green", reason: null });
  });

  it("未入選之後，還沒交的決賽階段不判逾期", () => {
    const notSelected: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: null, result: "not_selected" };
    const now = new Date(comp.finalDate.getTime() + 96 * 3_600_000);
    const stages = competitionStages(comp, notSelected, [], now);
    const light = competitionLineLight("黑客松", stages, now, { redAfterHours: 72 });
    expect(light).toEqual({ light: "green", reason: null });
  });
});

describe("competitionOnTime", () => {
  it("沒有任何必要階段到期 → null", () => {
    const stages = competitionStages(comp, confirmedEntry, [], new Date("2026-09-01T00:00:00Z"));
    expect(competitionOnTime(stages, new Date("2026-09-01T00:00:00Z"))).toBeNull();
  });

  it("只看 firstSubmittedAt，退回重交不影響準時率", () => {
    const submissions: StageSubmissionInput[] = [
      { stage: "signup", version: 1, pdfUploadedAt: new Date("2026-09-10T00:00:00Z"), reviewStatus: "returned" },
      { stage: "signup", version: 2, pdfUploadedAt: new Date("2026-10-10T00:00:00Z"), reviewStatus: "approved" },
    ];
    const now = new Date("2026-10-15T00:00:00Z");
    const stages = competitionStages(comp, confirmedEntry, submissions, now);
    // firstSubmittedAt (9/10) 早於截止日 (10/1) → 準時，即使最後通過的版本 (10/10) 已經過了截止日。
    expect(competitionOnTime(stages, now)).toBe(1);
  });
});

describe("competitionStatus", () => {
  it("已退出優先於其他狀態", () => {
    const withdrawn: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: new Date(), result: "awarded" };
    const stages = competitionStages(comp, withdrawn, [], new Date());
    expect(competitionStatus(stages, withdrawn)).toBe("已退出");
  });

  it("result 得獎／未入選／晉級直接對應", () => {
    for (const [result, label] of [
      ["awarded", "得獎"],
      ["not_selected", "未入選"],
      ["advanced", "晉級"],
    ] as const) {
      const entry: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: null, result };
      const stages = competitionStages(comp, entry, [], new Date());
      expect(competitionStatus(stages, entry)).toBe(label);
    }
  });

  it("繳件階段通過 → 已繳件", () => {
    const submissions: StageSubmissionInput[] = [
      { stage: "signup", version: 1, pdfUploadedAt: new Date("2026-09-20T00:00:00Z"), reviewStatus: "approved" },
      { stage: "submission", version: 1, pdfUploadedAt: new Date("2026-10-20T00:00:00Z"), reviewStatus: "approved" },
    ];
    const stages = competitionStages(comp, confirmedEntry, submissions, new Date("2026-10-21T00:00:00Z"));
    expect(competitionStatus(stages, confirmedEntry)).toBe("已繳件");
  });

  it("只有報名階段通過 → 已報名", () => {
    const submissions: StageSubmissionInput[] = [
      { stage: "signup", version: 1, pdfUploadedAt: new Date("2026-09-20T00:00:00Z"), reviewStatus: "approved" },
    ];
    const stages = competitionStages(comp, confirmedEntry, submissions, new Date("2026-09-21T00:00:00Z"));
    expect(competitionStatus(stages, confirmedEntry)).toBe("已報名");
  });

  it("還沒有任何階段通過 → 準備中", () => {
    const stages = competitionStages(comp, confirmedEntry, [], new Date("2026-09-05T00:00:00Z"));
    expect(competitionStatus(stages, confirmedEntry)).toBe("準備中");
  });

  it("報名階段 pending（送出但還沒審）→ 仍是準備中，不是已報名", () => {
    const submissions: StageSubmissionInput[] = [
      { stage: "signup", version: 1, pdfUploadedAt: new Date("2026-09-20T00:00:00Z"), reviewStatus: "pending" },
    ];
    const stages = competitionStages(comp, confirmedEntry, submissions, new Date("2026-09-21T00:00:00Z"));
    expect(competitionStatus(stages, confirmedEntry)).toBe("準備中");
  });
});
