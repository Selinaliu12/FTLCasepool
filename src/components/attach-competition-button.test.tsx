import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AttachCompetitionButton } from "./attach-competition-button";

const attachCompetition = vi.fn();
vi.mock("@/server/actions/entries", () => ({ attachCompetition: (...args: unknown[]) => attachCompetition(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() } }));

describe("AttachCompetitionButton", () => {
  afterEach(() => cleanup());

  // Final review minor 5：attachCompetition 丟出未預期的例外時跳 toast，按鈕恢復可按。
  it("attachCompetition 丟例外 → toast，按鈕恢復", async () => {
    attachCompetition.mockRejectedValue(new Error("boom"));
    render(<AttachCompetitionButton competitionId="c1" entryId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "掛到我們組" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("操作失敗，請重試"));
    expect((screen.getByRole("button", { name: "掛到我們組" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("已經掛過：顯示連到報名頁的「已掛到你們組」", () => {
    render(<AttachCompetitionButton competitionId="c1" entryId="e1" />);
    expect(screen.getByRole("link", { name: "已掛到你們組" }).getAttribute("href")).toBe("/my-group/competitions/e1");
  });
});
