import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { PdfDownloadButton } from "./pdf-download-button";

const getPdfDownloadUrl = vi.fn();
vi.mock("@/server/actions/download", () => ({ getPdfDownloadUrl: (...args: unknown[]) => getPdfDownloadUrl(...args) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe("PdfDownloadButton", () => {
  beforeEach(() => {
    getPdfDownloadUrl.mockReset();
    vi.mocked(toast.error).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("點擊按鈕拿到網址後導頁下載", async () => {
    getPdfDownloadUrl.mockResolvedValue({ ok: true, url: "https://example.com/x.pdf" });
    const assign = vi.fn();
    // vi.stubGlobal：用假的 location 物件頂替 window.location，只監看 assign 有沒有被呼叫，
    // 不用真的觸發瀏覽器導頁；afterEach 的 vi.unstubAllGlobals() 會自動還原。
    vi.stubGlobal("location", { ...window.location, assign });

    render(<PdfDownloadButton reportId="r1" />);
    fireEvent.click(screen.getByRole("button", { name: "下載 PDF" }));

    await waitFor(() => expect(getPdfDownloadUrl).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://example.com/x.pdf"));
  });

  it("失敗時顯示錯誤 toast，不導頁", async () => {
    getPdfDownloadUrl.mockResolvedValue({ ok: false, error: "找不到這份進度" });

    render(<PdfDownloadButton reportId="r1" />);
    fireEvent.click(screen.getByRole("button", { name: "下載 PDF" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("找不到這份進度"));
  });

  it("server action 丟出未預期例外時顯示通用錯誤 toast，不會整頁掛掉", async () => {
    getPdfDownloadUrl.mockRejectedValue(new Error("network down"));

    render(<PdfDownloadButton reportId="r1" />);
    fireEvent.click(screen.getByRole("button", { name: "下載 PDF" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("下載失敗，請再試一次"));
  });
});
