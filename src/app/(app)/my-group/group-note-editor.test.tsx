import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { GroupNoteEditor } from "./group-note-editor";
import { MAX_GROUP_NOTE_LENGTH } from "@/domain/group-note";

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

  // Fix round 1 F4：計數器超過 200 字時變成 --danger 紅色，存檔前就先提示。
  it("超過 200 字時計數器變成 --danger 紅色，200 字以內是灰色", () => {
    render(<GroupNoteEditor note={null} updatedBy={null} updatedAt={null} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "字".repeat(MAX_GROUP_NOTE_LENGTH) } });
    expect(screen.getByText(`${MAX_GROUP_NOTE_LENGTH}/${MAX_GROUP_NOTE_LENGTH}`).className).toContain("text-muted-foreground");

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "字".repeat(MAX_GROUP_NOTE_LENGTH + 1) } });
    const counter = screen.getByText(`${MAX_GROUP_NOTE_LENGTH + 1}/${MAX_GROUP_NOTE_LENGTH}`);
    expect(counter.className).toContain("--danger");
    expect(counter.className).not.toContain("text-muted-foreground");
  });

  // Fix round 1 F3：存檔成功後，文字框同步成「真正存進資料庫的值」（trim 過），不是輸入框裡
  // 沒 trim 的原始內容。
  it("儲存成功後，文字框同步成 trim 過的值，計數器也跟著變", async () => {
    updateGroupNote.mockResolvedValue({ ok: true });
    render(<GroupNoteEditor note={null} updatedBy={null} updatedAt={null} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  智慧記帳系統  " } });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("智慧記帳系統");
    expect(screen.getByText("6/200")).toBeTruthy();
  });

  // Fix round 1 F3：note prop 換了（例如父層 router.refresh() 之後拿到別的組員剛存的新值），
  // 文字框要跟著同步，不能停在舊的本地 state。
  it("note prop 換了之後，文字框同步成新的值", () => {
    const { rerender } = render(<GroupNoteEditor note="舊主題" updatedBy={null} updatedAt={null} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("舊主題");

    rerender(<GroupNoteEditor note="新主題" updatedBy="乙一" updatedAt={new Date("2026-09-20T03:00:00Z")} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("新主題");
  });
});
