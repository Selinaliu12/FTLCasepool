import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { SubmittedToast, markSubmittedToast } from "./submitted-toast";

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args) } }));

// Fix round 1：原本這個元件靠 URL 上的 ?submitted=1 決定要不要跳 toast，跳完再
// router.replace() 把參數拿掉——這是造成 submit-progress.spec.ts flake 的根因（見
// submitted-toast.tsx／progress-form.tsx 的註解）。改成單純的 sessionStorage 旗標之後，
// 這裡直接測這個旗標的合約：有旗標才跳、跳完旗標要被清掉、沒有旗標不跳，不需要再依賴
// useSearchParams／router，也就不需要再導第二次頁。
describe("SubmittedToast", () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    sessionStorage.clear();
  });

  afterEach(() => cleanup());

  it("sessionStorage 有旗標時顯示一次 toast，並清掉旗標", async () => {
    markSubmittedToast();
    expect(sessionStorage.getItem("ftl:submitted-toast")).toBe("1");

    render(<SubmittedToast />);

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("已送出，2 小時內可以修改"));
    expect(sessionStorage.getItem("ftl:submitted-toast")).toBeNull();
  });

  it("沒有旗標時不顯示 toast（例如重新整理組頁、或分享網址進來）", () => {
    render(<SubmittedToast />);
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
