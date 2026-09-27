import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StageUploads } from "./stage-uploads";
import type { Stage } from "@/domain/competition-line";
import type { StageSubmission } from "@/server/queries/entries";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/actions/upload", () => ({ requestPdfUpload: vi.fn() }));
vi.mock("@/server/actions/stages", () => ({
  submitStage: vi.fn(),
  replaceStagePdf: vi.fn(),
  withdrawStage: vi.fn(),
}));

afterEach(cleanup);

function stage(overrides: Partial<Stage> = {}): Stage {
  return {
    key: "signup",
    label: "報名",
    deadline: new Date("2026-10-01T15:59:59.999Z"),
    required: true,
    firstSubmittedAt: null,
    latest: null,
    completedAt: null,
    ...overrides,
  };
}

describe("StageUploads", () => {
  it("還沒交過：顯示上傳按鈕與替換提醒", () => {
    render(<StageUploads entryId="e1" stages={[stage()]} submissions={[]} ended={false} />);
    expect(screen.getByRole("button", { name: "上傳" })).toBeTruthy();
    expect(screen.getByText("⚠️ 替換檔案後，繳交時間以新檔案為準。")).toBeTruthy();
  });

  it("2 小時內、pending：顯示換 PDF／撤回與可修改到", () => {
    const submittedAt = new Date().toISOString();
    const submissions: StageSubmission[] = [
      { id: "s1", stage: "signup", version: 1, reviewStatus: "pending", pdfUploadedAt: submittedAt, comment: null },
    ];
    render(
      <StageUploads
        entryId="e1"
        stages={[stage({ latest: { version: 1, status: "pending", locked: false } })]}
        submissions={submissions}
        ended={false}
      />
    );
    expect(screen.getByRole("button", { name: "換 PDF" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "撤回" })).toBeTruthy();
    expect(screen.getByText(/可修改到/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "上傳" })).toBeNull();
  });

  it("已鎖定、pending：顯示已鎖定，等待審核，沒有換 PDF／撤回按鈕", () => {
    const submissions: StageSubmission[] = [
      { id: "s1", stage: "signup", version: 1, reviewStatus: "pending", pdfUploadedAt: new Date().toISOString(), comment: null },
    ];
    render(
      <StageUploads
        entryId="e1"
        stages={[stage({ latest: { version: 1, status: "pending", locked: true } })]}
        submissions={submissions}
        ended={false}
      />
    );
    expect(screen.getByText("已鎖定，等待審核")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "換 PDF" })).toBeNull();
    expect(screen.queryByRole("button", { name: "撤回" })).toBeNull();
  });

  it("被退回：顯示上傳按鈕（可以重交）與退回原因", () => {
    const submissions: StageSubmission[] = [
      {
        id: "s1",
        stage: "signup",
        version: 1,
        reviewStatus: "returned",
        pdfUploadedAt: new Date().toISOString(),
        comment: "格式不對",
      },
    ];
    render(
      <StageUploads
        entryId="e1"
        stages={[stage({ latest: { version: 1, status: "returned", locked: true } })]}
        submissions={submissions}
        ended={false}
      />
    );
    expect(screen.getByRole("button", { name: "上傳" })).toBeTruthy();
    expect(screen.getByText(/格式不對/)).toBeTruthy();
  });

  // Final review minor 1：PM 通過時附的評語，組員在報名頁也看得到。
  it("已通過的版本顯示通過評語", () => {
    const submissions: StageSubmission[] = [
      {
        id: "s1",
        stage: "signup",
        version: 1,
        reviewStatus: "approved",
        pdfUploadedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        comment: "做得很好",
      },
    ];
    render(
      <StageUploads
        entryId="e1"
        stages={[stage({ latest: { version: 1, status: "approved", locked: true } })]}
        submissions={submissions}
        ended={false}
      />
    );
    expect(screen.getByText(/做得很好/)).toBeTruthy();
  });

  it("比賽已結束、還沒交過：不顯示上傳按鈕，改顯示已結束", () => {
    render(<StageUploads entryId="e1" stages={[stage()]} submissions={[]} ended={true} />);
    expect(screen.queryByRole("button", { name: "上傳" })).toBeNull();
    expect(screen.getByText("這場比賽已經結束")).toBeTruthy();
  });

  // controller ruling 6（fix round 1）：線已結束、但還有一版 pending 且還沒鎖定——撤回仍然
  // 允許（withdrawStage 不擋），換 PDF 不允許（replaceStagePdf 擋），按鈕要分開處理。
  it("比賽已結束、有一版 pending 且還沒鎖定：隱藏換 PDF，保留撤回", () => {
    const submissions: StageSubmission[] = [
      { id: "s1", stage: "signup", version: 1, reviewStatus: "pending", pdfUploadedAt: new Date().toISOString(), comment: null },
    ];
    render(
      <StageUploads
        entryId="e1"
        stages={[stage({ latest: { version: 1, status: "pending", locked: false } })]}
        submissions={submissions}
        ended={true}
      />
    );
    expect(screen.queryByRole("button", { name: "換 PDF" })).toBeNull();
    expect(screen.getByRole("button", { name: "撤回" })).toBeTruthy();
  });
});
