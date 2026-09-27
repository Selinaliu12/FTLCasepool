import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { CompetitionLineDetail } from "./competition-line-detail";
import { competitionStages, type EntryInput } from "@/domain/competition-line";
import type { CompetitionLineSummary } from "@/server/queries/competition-lines";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/actions/stages", () => ({ reviewStage: vi.fn() }));
vi.mock("@/server/actions/download", () => ({ getStagePdfDownloadUrl: vi.fn() }));

const now = new Date("2026-09-28T04:00:00Z");
const entry: EntryInput = { confirmedAt: new Date("2026-09-01T00:00:00Z"), withdrawnAt: null, result: null };

function line(overrides: Partial<CompetitionLineSummary> = {}): CompetitionLineSummary {
  const stages = competitionStages(
    {
      signupDeadline: new Date("2026-10-01T15:59:59.999Z"),
      submissionDeadline: new Date("2026-11-01T15:59:59.999Z"),
      finalDate: null,
    },
    entry,
    [],
    now
  );
  return {
    entryId: "e1",
    lineId: "line-1",
    competitionName: "黑客松",
    status: "準備中",
    stages,
    light: "green",
    source: "系統：沒有欠交",
    onTime: null,
    submissions: [],
    ...overrides,
  };
}

// Final review IMPORTANT 2（規格 4.6）＋ minor 9：/groups/[id] 的比賽線顯示目前狀態、下一個
// 截止日，三個階段（即使還沒有人上傳）都列出截止日；外層有 competition-<lineId> 錨點給
// 「待你審核」連結跳過來。
describe("CompetitionLineDetail", () => {
  afterEach(() => cleanup());

  it("三個階段都列出（包含還沒上傳、截止日沒填的階段）", () => {
    render(<CompetitionLineDetail line={line()} canReview={false} now={now} />);
    const signup = screen.getByTestId("stage-signup");
    expect(within(signup).getByText("報名")).toBeTruthy();
    expect(within(signup).getByText("10/01（四）23:59 · 剩 3 天")).toBeTruthy();
    expect(within(signup).getByText("未交")).toBeTruthy();

    const submission = screen.getByTestId("stage-submission");
    expect(within(submission).getByText("11/01（日）23:59 · 剩 34 天")).toBeTruthy();

    const final = screen.getByTestId("stage-final");
    expect(within(final).getByText("決賽")).toBeTruthy();
    expect(within(final).getByText("未設定截止日")).toBeTruthy();
  });

  it("顯示目前狀態與下一個必要階段的截止日", () => {
    render(<CompetitionLineDetail line={line()} canReview={false} now={now} />);
    expect(screen.getByText("準備中")).toBeTruthy();
    expect(screen.getByText("下一個截止：報名 10/01（四）23:59 · 剩 3 天")).toBeTruthy();
    // 截圖第一輪自我檢查：準時率還沒有值時，單獨一個「—」看不出是什麼，改成「準時 —」。
    expect(screen.getByText("準時 —")).toBeTruthy();
  });

  it("外層有 competition-<lineId> 錨點", () => {
    const { container } = render(<CompetitionLineDetail line={line()} canReview={false} now={now} />);
    expect(container.querySelector("#competition-line-1")).not.toBeNull();
  });
});
