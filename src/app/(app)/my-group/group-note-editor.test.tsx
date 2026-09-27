import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { GroupNoteEditor } from "./group-note-editor";

const updateGroupNote = vi.fn();
vi.mock("@/server/actions/group-note", () => ({ updateGroupNote: (...args: unknown[]) => updateGroupNote(...args) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("GroupNoteEditor", () => {
  beforeEach(() => {
    updateGroupNote.mockReset();
    refresh.mockReset();
    vi.mocked(toast.success).mockReset();
  });

  afterEach(() => cleanup());

  it("顯示目前的備註內容與字數計數器", () => {
    render(<GroupNoteEditor note="智慧記帳系統" updatedBy={null} updatedAt={null} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("智慧記帳系統");
    expect(screen.getByText("6/200")).toBeTruthy();
  });

  it("沒有備註時文字框是空的，計數器 0/200", () => {
    render(<GroupNoteEditor note={null} updatedBy={null} updatedAt={null} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByText("0/200")).toBeTruthy();
  });

  it("輸入時即時更新字數計數器", () => {
    render(<GroupNoteEditor note={null} updatedBy={null} updatedAt={null} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "新主題" } });
    expect(screen.getByText("3/200")).toBeTruthy();
  });

  it("有最後修改者與時間時顯示『最後由 {姓名} 於 {時間} 更新』", () => {
    render(<GroupNoteEditor note="X" updatedBy="甲二" updatedAt={new Date("2026-09-20T03:00:00Z")} />);
    // formatTaipei：9/20（日）11:00
    expect(screen.getByText(/最後由 甲二 於 .+ 更新/)).toBeTruthy();
  });

  it("沒有修改紀錄時不顯示『最後由』字樣", () => {
    render(<GroupNoteEditor note={null} updatedBy={null} updatedAt={null} />);
    expect(screen.queryByText(/最後由/)).toBeNull();
  });

  it("儲存成功：呼叫 updateGroupNote、顯示成功提示、router.refresh()", async () => {
    updateGroupNote.mockResolvedValue({ ok: true });
    render(<GroupNoteEditor note={null} updatedBy={null} updatedAt={null} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "新主題" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => expect(updateGroupNote).toHaveBeenCalledWith("新主題"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("儲存中顯示中的按鈕文字與 disabled", async () => {
    let resolve!: (v: { ok: true }) => void;
    updateGroupNote.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<GroupNoteEditor note={null} updatedBy={null} updatedAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "儲存中…" })).toBeTruthy());
    const button = screen.getByRole("button", { name: "儲存中…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    resolve({ ok: true });
  });

  it("儲存失敗：顯示錯誤訊息，不顯示成功提示", async () => {
    updateGroupNote.mockResolvedValue({ ok: false, error: "備註最多 200 字" });
    render(<GroupNoteEditor note={null} updatedBy={null} updatedAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => expect(screen.getByText("備註最多 200 字")).toBeTruthy());
    expect(toast.success).not.toHaveBeenCalled();
  });
});
