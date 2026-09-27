import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StageReview } from "./stage-review";
import type { StageSubmissionDetail } from "@/server/queries/competition-lines";

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
});
