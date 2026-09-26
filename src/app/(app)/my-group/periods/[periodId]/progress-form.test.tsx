import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ProgressForm } from "./progress-form";

const requestPdfUpload = vi.fn();
const submitProgress = vi.fn();
vi.mock("@/server/actions/upload", () => ({ requestPdfUpload: (...args: unknown[]) => requestPdfUpload(...args) }));
vi.mock("@/server/actions/progress", () => ({ submitProgress: (...args: unknown[]) => submitProgress(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function pdfFile(name = "report.pdf", size = 1024) {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

describe("ProgressForm", () => {
  beforeEach(() => {
    requestPdfUpload.mockReset();
    submitProgress.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("沒填齊時按『送出』，各欄顯示錯誤，不呼叫 requestPdfUpload", () => {
    render(<ProgressForm periodId="p1" />);

    fireEvent.click(screen.getByRole("button", { name: "送出" }));

    expect(screen.getByText("請選燈號")).toBeTruthy();
    expect(screen.getAllByText("請填寫這一句").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("請附上 PDF")).toBeTruthy();
    expect(requestPdfUpload).not.toHaveBeenCalled();
  });

  it("選了非 PDF 檔立刻顯示『只收 PDF』", () => {
    render(<ProgressForm periodId="p1" />);

    const input = screen.getByLabelText(/PDF/) as HTMLInputElement;
    const badFile = new File(["x"], "report.docx", { type: "application/msword" });
    fireEvent.change(input, { target: { files: [badFile] } });

    expect(screen.getByText("只收 PDF")).toBeTruthy();
  });

  it("上傳中按鈕顯示『上傳中…』且不能重按", async () => {
    // 故意讓 requestPdfUpload 永遠不 resolve：這個測試只需要確認送出後、拿到上傳網址前，
    // 按鈕會變成「上傳中…」且被 disabled，不需要真的跑完整個上傳流程。
    requestPdfUpload.mockReturnValue(new Promise(() => {}));

    render(<ProgressForm periodId="p1" />);

    fireEvent.click(screen.getByRole("button", { name: "綠燈" }));
    fireEvent.change(screen.getByLabelText("這兩週做了什麼"), { target: { value: "做了 A" } });
    fireEvent.change(screen.getByLabelText("卡在哪裡"), { target: { value: "沒有" } });
    fireEvent.change(screen.getByLabelText("接下來要做什麼"), { target: { value: "做 B" } });
    fireEvent.change(screen.getByLabelText(/PDF/), { target: { files: [pdfFile()] } });

    fireEvent.click(screen.getByRole("button", { name: "送出" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "上傳中…" })).toBeTruthy());
    const button = screen.getByRole("button", { name: "上傳中…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
