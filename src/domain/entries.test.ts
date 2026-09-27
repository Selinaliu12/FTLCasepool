import { describe, it, expect } from "vitest";
import { entryDisplayStatus } from "./entries";
import { competitionStages, type EntryInput, type StageSubmissionInput } from "./competition-line";

const comp = {
  signupDeadline: new Date("2026-10-01T15:59:59.999Z"),
  submissionDeadline: new Date("2026-11-01T15:59:59.999Z"),
  finalDate: null,
};
const now = new Date("2026-10-05T00:00:00Z");
const confirmed: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: null, result: null };

// Final review IMPORTANT 3：報名頁的「報名狀態」在比賽線建立之後改用 competitionStatus
// （準備中／已報名／已繳件／晉級／得獎／未入選／已退出），確認前才顯示「未確認」。
describe("entryDisplayStatus", () => {
  it("確認前（沒有比賽線）→ 未確認", () => {
    expect(
      entryDisplayStatus({ lineId: null, stages: [], confirmedAt: null, withdrawnAt: null, result: null })
    ).toBe("未確認");
  });

  it("有比賽線、報名階段通過 → 已報名", () => {
    const subs: StageSubmissionInput[] = [
      { stage: "signup", version: 1, pdfUploadedAt: new Date("2026-09-20T00:00:00Z"), reviewStatus: "approved" },
    ];
    const stages = competitionStages(comp, confirmed, subs, now);
    expect(entryDisplayStatus({ lineId: "l1", stages, ...confirmed })).toBe("已報名");
  });

  it("有比賽線、結果填了晉級 → 晉級", () => {
    const entry: EntryInput = { ...confirmed, result: "advanced" };
    const stages = competitionStages(comp, entry, [], now);
    expect(entryDisplayStatus({ lineId: "l1", stages, ...entry })).toBe("晉級");
  });

  it("有比賽線、還沒有任何階段通過 → 準備中", () => {
    const stages = competitionStages(comp, confirmed, [], now);
    expect(entryDisplayStatus({ lineId: "l1", stages, ...confirmed })).toBe("準備中");
  });
});
