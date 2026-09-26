import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CheckinDialog } from "./checkin-dialog";

const submitCheckin = vi.fn();
vi.mock("@/server/actions/checkin", () => ({ submitCheckin: (...args: unknown[]) => submitCheckin(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "點一下這週燈號" }));
}

describe("CheckinDialog", () => {
  beforeEach(() => {
    submitCheckin.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("預設不顯示『卡在哪裡』；選紅燈才出現", async () => {
    render(<CheckinDialog />);
    openDialog();

    await waitFor(() => expect(screen.getByRole("button", { name: "綠燈" })).toBeTruthy());
    expect(screen.queryByLabelText("卡在哪裡")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "紅燈" }));
    expect(screen.getByLabelText("卡在哪裡")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "綠燈" }));
    expect(screen.queryByLabelText("卡在哪裡")).toBeNull();
  });

  it("沒選燈號按『送出』→ 顯示『請選燈號』，不呼叫 submitCheckin", async () => {
    render(<CheckinDialog />);
    openDialog();

    await waitFor(() => expect(screen.getByRole("button", { name: "送出" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "送出" }));

    expect(screen.getByText("請選燈號")).toBeTruthy();
    expect(submitCheckin).not.toHaveBeenCalled();
  });

  it("紅燈沒填『卡在哪裡』送出 → 顯示『紅燈請補一句卡在哪裡』，不呼叫 submitCheckin", async () => {
    render(<CheckinDialog />);
    openDialog();

    await waitFor(() => expect(screen.getByRole("button", { name: "紅燈" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "紅燈" }));
    fireEvent.click(screen.getByRole("button", { name: "送出" }));

    expect(screen.getByText("紅燈請補一句卡在哪裡")).toBeTruthy();
    expect(submitCheckin).not.toHaveBeenCalled();
  });

  it("選黃燈送出成功 → 呼叫 submitCheckin({ light: 'yellow', note: '' })", async () => {
    submitCheckin.mockResolvedValue({ ok: true });
    render(<CheckinDialog />);
    openDialog();

    await waitFor(() => expect(screen.getByRole("button", { name: "黃燈" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "黃燈" }));
    fireEvent.click(screen.getByRole("button", { name: "送出" }));

    await waitFor(() => expect(submitCheckin).toHaveBeenCalledWith({ light: "yellow", note: "" }));
  });

  it("送出失敗時，錯誤訊息顯示在對話框裡", async () => {
    submitCheckin.mockResolvedValue({ ok: false, error: "只有專案生可以點燈號" });
    render(<CheckinDialog />);
    openDialog();

    await waitFor(() => expect(screen.getByRole("button", { name: "綠燈" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "綠燈" }));
    fireEvent.click(screen.getByRole("button", { name: "送出" }));

    await waitFor(() => expect(screen.getByText("只有專案生可以點燈號")).toBeTruthy());
  });
});
