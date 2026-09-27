import { describe, it, expect } from "vitest";
import {
  competitionStages,
  competitionLineLight,
  competitionLineDisplay,
  competitionOnTime,
  competitionStatus,
  isLineEnded,
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

  // fix round 1（controller ruling）：一旦結果是未入選，三個階段全部不再 required，不管
  // 有沒有交過——之前的版本讓「已經交過」的報名階段繼續 required，跟「線已經結束」矛盾。
  it("未入選之後，三個階段一律不 required（即使報名階段已經交過）", () => {
    const notSelected: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: null, result: "not_selected" };
    const submissions: StageSubmissionInput[] = [
      { stage: "signup", version: 1, pdfUploadedAt: new Date("2026-09-20T00:00:00Z"), reviewStatus: "approved" },
    ];
    const stages = competitionStages(comp, notSelected, submissions, new Date("2026-11-15T00:00:00Z"));
    expect(stages.every((s) => s.required === false)).toBe(true);
  });

  it("得獎之後，三個階段一律不 required", () => {
    const awarded: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: null, result: "awarded" };
    const stages = competitionStages(comp, awarded, [], new Date("2026-12-15T00:00:00Z"));
    expect(stages.every((s) => s.required === false)).toBe(true);
  });

  it("result=advanced（晉級中）時決賽仍 required", () => {
    const advanced: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: null, result: "advanced" };
    const stages = competitionStages(comp, advanced, [], new Date("2026-11-15T00:00:00Z"));
    expect(stages.find((s) => s.key === "final")!.required).toBe(true);
  });

  // fix round 1 #1：firstSubmittedAt 要用 Math.min 比實際時間，不能假設 version 遞增
  // 就等於時間遞增。
  it("firstSubmittedAt 是所有版本裡時間最早的一筆，不是 version 最小的那一筆", () => {
    const submissions: StageSubmissionInput[] = [
      { stage: "signup", version: 1, pdfUploadedAt: new Date("2026-09-25T00:00:00Z"), reviewStatus: "returned" },
      // version 2 的上傳時間反而比 version 1 早（例如時鐘校正、或審核延遲登記）——
      // firstSubmittedAt 該是這一筆 (9/10)，不是 version 1 的 9/25。
      { stage: "signup", version: 2, pdfUploadedAt: new Date("2026-09-10T00:00:00Z"), reviewStatus: "approved" },
    ];
    const stages = competitionStages(comp, confirmedEntry, submissions, new Date("2026-09-30T00:00:00Z"));
    const signup = stages.find((s) => s.key === "signup")!;
    expect(signup.firstSubmittedAt).toEqual(new Date("2026-09-10T00:00:00Z"));
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
    expect(competitionLineLight("測試賽", before, confirmedEntry, now, { redAfterHours: 72 })).toEqual({
      light: "green",
      reason: null,
    });

    // 幹部把報名截止日改早到 9/15：同一個 now (9/16) 用新截止日算，已經逾期 8 小時。
    const movedEarlier: CompetitionDeadlines = { ...comp, signupDeadline: new Date("2026-09-15T15:59:59.999Z") };
    const after = competitionStages(movedEarlier, confirmedEntry, [], now);
    const signup = after.find((s) => s.key === "signup")!;
    expect(signup.deadline).toEqual(movedEarlier.signupDeadline);

    const light = competitionLineLight("測試賽", after, confirmedEntry, now, { redAfterHours: 72 });
    expect(light!.light).toBe("yellow");
    expect(light!.reason).toBe("系統：測試賽 報名逾期 8 小時");
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

    const light = competitionLineLight("測試賽", stages, confirmedEntry, now, { redAfterHours: 72 });
    expect(light).toEqual({ light: "green", reason: null });
    // 但準時率仍要看新截止日：9/1 截止、10/5 才交 → 不準時。
    expect(competitionOnTime(stages, confirmedEntry, now)).toBe(0);
  });
});

describe("isLineEnded", () => {
  it("已退出、未入選、得獎都算結束；晉級中／準備中不算", () => {
    const base = { confirmedAt: new Date(), withdrawnAt: null as Date | null, result: null as EntryInput["result"] };
    expect(isLineEnded({ ...base, withdrawnAt: new Date() })).toBe(true);
    expect(isLineEnded({ ...base, result: "not_selected" })).toBe(true);
    expect(isLineEnded({ ...base, result: "awarded" })).toBe(true);
    expect(isLineEnded({ ...base, result: "advanced" })).toBe(false);
    expect(isLineEnded(base)).toBe(false);
  });
});

describe("competitionLineLight", () => {
  it("沒有任何必要階段逾期或被退回 → 綠燈", () => {
    const stages = competitionStages(comp, confirmedEntry, [], new Date("2026-09-15T00:00:00Z"));
    const light = competitionLineLight("測試賽", stages, confirmedEntry, new Date("2026-09-15T00:00:00Z"), { redAfterHours: 72 });
    expect(light).toEqual({ light: "green", reason: null });
  });

  it("逾期未滿 72 小時 → 黃燈，原因帶比賽名與階段名", () => {
    const now = new Date(comp.signupDeadline!.getTime() + 10 * 3_600_000);
    const stages = competitionStages(comp, confirmedEntry, [], now);
    const light = competitionLineLight("黑客松", stages, confirmedEntry, now, { redAfterHours: 72 });
    expect(light!.light).toBe("yellow");
    expect(light!.reason).toBe("系統：黑客松 報名逾期 10 小時");
  });

  it("逾期滿 72 小時 → 紅燈", () => {
    const now = new Date(comp.signupDeadline!.getTime() + 96 * 3_600_000);
    const stages = competitionStages(comp, confirmedEntry, [], now);
    const light = competitionLineLight("黑客松", stages, confirmedEntry, now, { redAfterHours: 72 });
    expect(light!.light).toBe("red");
    expect(light!.reason).toBe("系統：黑客松 報名逾期 4 天");
  });

  it("退回未重交 → 黃燈，即使還沒到截止日", () => {
    const submissions: StageSubmissionInput[] = [
      { stage: "signup", version: 1, pdfUploadedAt: new Date("2026-09-10T00:00:00Z"), reviewStatus: "returned" },
    ];
    const now = new Date("2026-09-15T00:00:00Z"); // 早於 signupDeadline 10/1
    const stages = competitionStages(comp, confirmedEntry, submissions, now);
    const light = competitionLineLight("黑客松", stages, confirmedEntry, now, { redAfterHours: 72 });
    expect(light!.light).toBe("yellow");
    expect(light!.reason).toBe("系統：黑客松 報名被退回");
  });

  // fix round 1（controller ruling）：已退出的線回傳 null，不是綠燈——兩者對 UI 的意義不同
  // （null＝不畫 LightBadge，改畫「已退出」徽章）。
  it("已退出的報名：light 為 null（不是綠燈）", () => {
    const withdrawn: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: new Date("2026-09-15T00:00:00Z"), result: null };
    const now = new Date(comp.signupDeadline!.getTime() + 96 * 3_600_000);
    const stages = competitionStages(comp, withdrawn, [], now);
    const light = competitionLineLight("黑客松", stages, withdrawn, now, { redAfterHours: 72 });
    expect(light).toBeNull();
  });

  // fix round 1：未入選之後 light 為 null，即使有一個階段被退回沒重交——已結束的線不再判燈，
  // 也不能因為「結束前最後一版被退回」而被排到紅／黃燈的排序前面。
  it("未入選、且有一個階段被退回沒重交：light 仍為 null（已結束不判燈）", () => {
    const notSelected: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: null, result: "not_selected" };
    const submissions: StageSubmissionInput[] = [
      { stage: "signup", version: 1, pdfUploadedAt: new Date("2026-09-20T00:00:00Z"), reviewStatus: "returned" },
    ];
    const now = new Date(comp.finalDate!.getTime() + 96 * 3_600_000);
    const stages = competitionStages(comp, notSelected, submissions, now);
    const light = competitionLineLight("黑客松", stages, notSelected, now, { redAfterHours: 72 });
    expect(light).toBeNull();
  });

  it("得獎：light 為 null", () => {
    const awarded: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: null, result: "awarded" };
    const now = new Date(comp.finalDate!.getTime() + 96 * 3_600_000);
    const stages = competitionStages(comp, awarded, [], now);
    const light = competitionLineLight("黑客松", stages, awarded, now, { redAfterHours: 72 });
    expect(light).toBeNull();
  });
});

describe("competitionLineDisplay", () => {
  it("綠燈時補上固定的『系統：沒有欠交』", () => {
    const stages = competitionStages(comp, confirmedEntry, [], new Date("2026-09-15T00:00:00Z"));
    const display = competitionLineDisplay("測試賽", stages, confirmedEntry, new Date("2026-09-15T00:00:00Z"), { redAfterHours: 72 });
    expect(display).toEqual({ light: "green", source: "系統：沒有欠交" });
  });

  it("黃／紅燈時 source 帶系統判定的理由", () => {
    const now = new Date(comp.signupDeadline!.getTime() + 96 * 3_600_000);
    const stages = competitionStages(comp, confirmedEntry, [], now);
    const display = competitionLineDisplay("黑客松", stages, confirmedEntry, now, { redAfterHours: 72 });
    expect(display).toEqual({ light: "red", source: "系統：黑客松 報名逾期 4 天" });
  });

  it("已結束的線：light 與 source 都是 null", () => {
    const awarded: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: null, result: "awarded" };
    const now = new Date();
    const stages = competitionStages(comp, awarded, [], now);
    const display = competitionLineDisplay("黑客松", stages, awarded, now, { redAfterHours: 72 });
    expect(display).toEqual({ light: null, source: null });
  });
});

describe("competitionOnTime", () => {
  it("沒有任何必要階段到期 → null", () => {
    const stages = competitionStages(comp, confirmedEntry, [], new Date("2026-09-01T00:00:00Z"));
    expect(competitionOnTime(stages, confirmedEntry, new Date("2026-09-01T00:00:00Z"))).toBeNull();
  });

  it("只看 firstSubmittedAt，退回重交不影響準時率", () => {
    const submissions: StageSubmissionInput[] = [
      { stage: "signup", version: 1, pdfUploadedAt: new Date("2026-09-10T00:00:00Z"), reviewStatus: "returned" },
      { stage: "signup", version: 2, pdfUploadedAt: new Date("2026-10-10T00:00:00Z"), reviewStatus: "approved" },
    ];
    const now = new Date("2026-10-15T00:00:00Z");
    const stages = competitionStages(comp, confirmedEntry, submissions, now);
    // firstSubmittedAt (9/10) 早於截止日 (10/1) → 準時，即使最後通過的版本 (10/10) 已經過了截止日。
    expect(competitionOnTime(stages, confirmedEntry, now)).toBe(1);
  });

  // fix round 1：未入選之後，已經交過、且截止日已過的階段仍要算進準時率——不能因為比賽
  // 結束（required 全部變 false）就讓 onTime 整個變成 null，抹掉歷史準時記錄。
  it("未入選之後：已經交過且截止日已過的階段仍算進準時率", () => {
    const notSelected: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: null, result: "not_selected" };
    const submissions: StageSubmissionInput[] = [
      // 報名準時交（9/20 早於 10/1 截止）。
      { stage: "signup", version: 1, pdfUploadedAt: new Date("2026-09-20T00:00:00Z"), reviewStatus: "approved" },
    ];
    const now = new Date("2026-11-15T00:00:00Z"); // 晚於繳件截止(11/1)、早於決賽(12/1)
    const stages = competitionStages(comp, notSelected, submissions, now);
    // 報名：準時交，算 1/1 due 且 onTime；繳件：沒交但截止日已過，required 已經是
    // false、也沒有 firstSubmittedAt → 不算進分母（未入選後不再要求繳件）；決賽：
    // 截止日還沒到，不算進分母。結果只有報名這一筆進分母，且準時 → 100%。
    expect(competitionOnTime(stages, notSelected, now)).toBe(1);
  });

  it("未入選之後：從沒交過的階段（決賽）不算進分母，不會被扣分", () => {
    const notSelected: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: null, result: "not_selected" };
    // 完全沒有任何送出紀錄；比較晚的時間點，三個截止日全部已過。
    const now = new Date("2027-01-01T00:00:00Z");
    const stages = competitionStages(comp, notSelected, [], now);
    expect(competitionOnTime(stages, notSelected, now)).toBeNull();
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
