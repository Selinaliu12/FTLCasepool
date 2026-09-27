import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { StageReview } from "./stage-review";
import type { StageSubmissionDetail } from "@/server/queries/competition-lines";
import { reviewStage } from "@/server/actions/stages";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/actions/stages", () => ({ reviewStage: vi.fn() }));
vi.mock("@/server/actions/download", () => ({ getStagePdfDownloadUrl: vi.fn() }));

function submission(overrides: Partial<StageSubmissionDetail> = {}): StageSubmissionDetail {
  return {
    id: "sub-1",
    stage: "signup",
    version: 1,
    reviewStatus: "pending",
    pdfUploadedAt: new Date("2026-09-26T10:00:00Z"),
    locked: true,
    comment: null,
    ...overrides,
  };
}

describe("StageReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // fix round 1 Minor 4（controller ruling）：線已經結束時，即使最新一版還是已鎖定、pending，
  // 也不顯示通過／退回按鈕——不能只靠 reviewStage() 擋下來，PM 不該先看到按鈕才發現點了沒用。
  it("線已結束（ended）：即使最新一版已鎖定、pending，也不顯示通過／退回按鈕", () => {
    render(<StageReview submissions={[submission()]} canReview={true} ended={true} />);

    expect(screen.queryByRole("button", { name: "通過" })).toBeNull();
    expect(screen.queryByRole("button", { name: "退回" })).toBeNull();
  });

  it("線還沒結束、PM 看得到、已鎖定、pending：顯示通過／退回按鈕", () => {
    render(<StageReview submissions={[submission()]} canReview={true} ended={false} />);

    expect(screen.queryByRole("button", { name: "通過" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "退回" })).not.toBeNull();
  });

  it("不是 PM（canReview=false）：即使線沒結束、已鎖定、pending，也不顯示按鈕", () => {
    render(<StageReview submissions={[submission()]} canReview={false} ended={false} />);

    expect(screen.queryByRole("button", { name: "通過" })).toBeNull();
    expect(screen.queryByRole("button", { name: "退回" })).toBeNull();
  });

  it("已經審核過（非 pending）：不顯示按鈕", () => {
    render(
      <StageReview submissions={[submission({ reviewStatus: "approved" })]} canReview={true} ended={false} />
    );

    expect(screen.queryByRole("button", { name: "通過" })).toBeNull();
    expect(screen.queryByRole("button", { name: "退回" })).toBeNull();
  });

  it("還沒鎖定：不顯示按鈕", () => {
    render(<StageReview submissions={[submission({ locked: false })]} canReview={true} ended={false} />);

    expect(screen.queryByRole("button", { name: "通過" })).toBeNull();
    expect(screen.queryByRole("button", { name: "退回" })).toBeNull();
  });

  // Final review minor 1：通過也可以附選填評語，組員跟 PM 都看得到通過的評語。
  it("按通過跳出對話框，可以填選填評語，確定後把評語一起送出", async () => {
    vi.mocked(reviewStage).mockResolvedValue({ ok: true });
    render(<StageReview submissions={[submission()]} canReview={true} ended={false} />);

    fireEvent.click(screen.getByRole("button", { name: "通過" }));
    fireEvent.change(screen.getByLabelText("通過評語（選填）"), { target: { value: "做得很好" } });
    fireEvent.click(screen.getByRole("button", { name: "確定通過" }));

    await waitFor(() => expect(reviewStage).toHaveBeenCalledWith("sub-1", "approved", "做得很好"));
  });

  it("通過時評語留空，送出 null", async () => {
    vi.mocked(reviewStage).mockResolvedValue({ ok: true });
    render(<StageReview submissions={[submission()]} canReview={true} ended={false} />);

    fireEvent.click(screen.getByRole("button", { name: "通過" }));
    fireEvent.click(screen.getByRole("button", { name: "確定通過" }));

    await waitFor(() => expect(reviewStage).toHaveBeenCalledWith("sub-1", "approved", null));
  });

  it("已通過的版本顯示通過評語", () => {
    render(
      <StageReview
        submissions={[submission({ reviewStatus: "approved", comment: "做得很好" })]}
        canReview={false}
        ended={false}
      />
    );
    expect(screen.getByText(/做得很好/)).toBeTruthy();
  });
});
