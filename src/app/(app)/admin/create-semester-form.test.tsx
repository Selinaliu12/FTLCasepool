import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CreateSemesterForm } from "./create-semester-form";

const createSemester = vi.fn();
vi.mock("@/server/actions/admin", () => ({ createSemester: (...args: unknown[]) => createSemester(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// 最終審查 #7：已經有當前學期時，按一下「建立學期」就會讓目前學期的所有成員再也登不進來。
// 改成：表單收在「開始新學期…」後面，送出前要在確認視窗裡再打一次新學期名稱。
describe("CreateSemesterForm", () => {
  beforeEach(() => {
    createSemester.mockReset();
    createSemester.mockResolvedValue({ ok: true, semesterId: "s2" });
  });

  afterEach(() => cleanup());

  it("還沒有任何學期：直接顯示表單，按「建立學期」就建立（不需要確認）", async () => {
    render(<CreateSemesterForm currentSemesterName={null} />);
    fireEvent.change(screen.getByLabelText("學期名稱"), { target: { value: "115-1" } });
    fireEvent.click(screen.getByRole("button", { name: "建立學期" }));
    await waitFor(() => expect(createSemester).toHaveBeenCalledWith("115-1"));
  });

  // 最終審查 M4：驗證錯誤用回傳值 { ok:false, error } 帶回來（正式環境 server action 丟出的例外訊息
  // 會被換成通用訊息），表單要把它顯示在欄位下面。
  it("createSemester 回 { ok:false, error } → 錯誤訊息顯示在表單裡，表單保留輸入", async () => {
    createSemester.mockResolvedValue({ ok: false, error: "學期名稱不能有「/」" });
    render(<CreateSemesterForm currentSemesterName={null} />);
    fireEvent.change(screen.getByLabelText("學期名稱"), { target: { value: "115/1" } });
    fireEvent.click(screen.getByRole("button", { name: "建立學期" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("學期名稱不能有「/」"));
    expect((screen.getByLabelText("學期名稱") as HTMLInputElement).value).toBe("115/1");
  });

  it("已有當前學期：表單收在「開始新學期…」後面", () => {
    render(<CreateSemesterForm currentSemesterName="115-1" />);
    expect(screen.queryByLabelText("學期名稱")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "開始新學期…" }));
    expect(screen.getByLabelText("學期名稱")).toBeTruthy();
  });

  it("已有當前學期：要在確認視窗打對新學期名稱，「確定建立」才按得下去", async () => {
    render(<CreateSemesterForm currentSemesterName="115-1" />);
    fireEvent.click(screen.getByRole("button", { name: "開始新學期…" }));
    fireEvent.change(screen.getByLabelText("學期名稱"), { target: { value: "115-2" } });
    fireEvent.click(screen.getByRole("button", { name: "建立學期" }));

    await waitFor(() =>
      expect(
        screen.getByText("建立新學期後，目前學期「115-1」的所有成員都無法再登入，這個動作無法從網站復原。")
      ).toBeTruthy()
    );
    expect(createSemester).not.toHaveBeenCalled();

    const confirm = screen.getByRole("button", { name: "確定建立" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const typed = screen.getByLabelText("再輸入一次新學期名稱");
    fireEvent.change(typed, { target: { value: "115-" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(typed, { target: { value: "115-1" } });
    expect(confirm.disabled).toBe(true);

    fireEvent.change(typed, { target: { value: "115-2" } });
    expect(confirm.disabled).toBe(false);

    fireEvent.click(confirm);
    await waitFor(() => expect(createSemester).toHaveBeenCalledWith("115-2"));
  });
});
