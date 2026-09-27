import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ResultSelect } from "./result-select";

const setResult = vi.fn();
vi.mock("@/server/actions/entries", () => ({ setResult: (...args: unknown[]) => setResult(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("ResultSelect：比賽結果選單與確認對話框", () => {
  beforeEach(() => {
    setResult.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("預設依照目前結果選取，四個選項都顯示", () => {
    render(<ResultSelect entryId="entry-1" result="advanced" />);
    expect(screen.getByText("尚未公布")).toBeTruthy();
    expect(screen.getByText("晉級")).toBeTruthy();
    expect(screen.getByText("得獎")).toBeTruthy();
    expect(screen.getByText("未入選")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "晉級" })).toHaveProperty("ariaChecked", "true");
  });

  it("選晉級後按儲存：直接呼叫 setResult，不彈確認對話框", async () => {
    setResult.mockResolvedValue({ ok: true });
    render(<ResultSelect entryId="entry-1" result={null} />);

    fireEvent.click(screen.getByText("晉級"));
    fireEvent.click(screen.getByRole("button", { name: "更新結果" }));

    await waitFor(() => expect(setResult).toHaveBeenCalledWith("entry-1", "advanced"));
    expect(screen.queryByText(/這場比賽會結束/)).toBeNull();
  });

  it("選得獎後按儲存：彈出確認對話框，說明比賽會結束；按確定才真的呼叫 setResult", async () => {
    setResult.mockResolvedValue({ ok: true });
    render(<ResultSelect entryId="entry-1" result={null} />);

    fireEvent.click(screen.getByText("得獎"));
    fireEvent.click(screen.getByRole("button", { name: "更新結果" }));

    await waitFor(() =>
      expect(
        screen.getByText("填了得獎或未入選後，這場比賽會結束，之後的階段不用再交。確定嗎？")
      ).toBeTruthy()
    );
    expect(setResult).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "確定" }));
    await waitFor(() => expect(setResult).toHaveBeenCalledWith("entry-1", "awarded"));
  });

  it("選未入選後按儲存：彈出同一個確認對話框", async () => {
    setResult.mockResolvedValue({ ok: true });
    render(<ResultSelect entryId="entry-1" result={null} />);

    fireEvent.click(screen.getByText("未入選"));
    fireEvent.click(screen.getByRole("button", { name: "更新結果" }));

    await waitFor(() =>
      expect(
        screen.getByText("填了得獎或未入選後，這場比賽會結束，之後的階段不用再交。確定嗎？")
      ).toBeTruthy()
    );
  });

  it("確認對話框按再想想：不呼叫 setResult，對話框關閉", async () => {
    render(<ResultSelect entryId="entry-1" result={null} />);

    fireEvent.click(screen.getByText("未入選"));
    fireEvent.click(screen.getByRole("button", { name: "更新結果" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "再想想" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "再想想" }));
    expect(setResult).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(/這場比賽會結束/)).toBeNull());
  });

  it("儲存失敗時顯示錯誤訊息", async () => {
    setResult.mockResolvedValue({ ok: false, error: "找不到這筆報名" });
    render(<ResultSelect entryId="entry-1" result={null} />);

    fireEvent.click(screen.getByText("晉級"));
    fireEvent.click(screen.getByRole("button", { name: "更新結果" }));

    await waitFor(() => expect(screen.getByText("找不到這筆報名")).toBeTruthy());
  });

  it("改回尚未公布：直接呼叫 setResult(entryId, null)，不彈確認對話框", async () => {
    setResult.mockResolvedValue({ ok: true });
    render(<ResultSelect entryId="entry-1" result="awarded" />);

    fireEvent.click(screen.getByText("尚未公布"));
    fireEvent.click(screen.getByRole("button", { name: "更新結果" }));

    await waitFor(() => expect(setResult).toHaveBeenCalledWith("entry-1", null));
  });
});
