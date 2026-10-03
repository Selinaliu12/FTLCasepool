import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MembersSection } from "./members-section";
import type { MemberListRow } from "@/domain/member-list";

const addMember = vi.fn();
const removeIdentity = vi.fn();
const removePerson = vi.fn();
vi.mock("@/server/actions/admin", () => ({
  addMember: (...args: unknown[]) => addMember(...args),
  removeIdentity: (...args: unknown[]) => removeIdentity(...args),
  removePerson: (...args: unknown[]) => removePerson(...args),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn() } }));

const rows: MemberListRow[] = [
  { id: "m1", email: "wang@g.nccu.edu.tw", name: "王小明", role: "student", groupName: "第1組", studentId: "110701001", deptYear: "資科三", leftAt: null },
  { id: "m2", email: "wang@g.nccu.edu.tw", name: "王小明", role: "officer", groupName: null, studentId: "110701001", deptYear: "資科三", leftAt: null },
  { id: "m3", email: "chen@g.nccu.edu.tw", name: "陳幹部", role: "pm", groupName: null, studentId: "109", deptYear: "企管四", leftAt: null },
  { id: "m4", email: "lin@g.nccu.edu.tw", name: "林離開", role: "student", groupName: "第2組", studentId: "111", deptYear: null, leftAt: "2026-09-29T00:00:00Z" },
];
const groups = [
  { id: "g1", name: "第1組" },
  { id: "g2", name: "第2組" },
];

function bodyRows() {
  return screen.getAllByRole("row").slice(1);
}

describe("MembersSection（管理員頁成員區塊）", () => {
  beforeEach(() => {
    addMember.mockReset();
    removeIdentity.mockReset();
    removePerson.mockReset();
    refresh.mockReset();
    toastSuccess.mockReset();
  });
  afterEach(() => cleanup());

  it("每個人一列：姓名、信箱、學號、系級、所有身份；預設不列已離開的人", () => {
    render(<MembersSection rows={rows} groups={groups} />);
    expect(bodyRows()).toHaveLength(2);
    const wang = screen.getByText("王小明").closest("tr")!;
    expect(within(wang).getByText("wang@g.nccu.edu.tw")).toBeTruthy();
    // 學號在桌機欄與手機行各出現一次（CSS 決定顯示哪個）
    expect(within(wang).getAllByText("110701001").length).toBeGreaterThan(0);
    expect(within(wang).getByText("資科三")).toBeTruthy();
    expect(within(wang).getByText("其他幹部")).toBeTruthy();
    expect(within(wang).getByText("第1組專案生")).toBeTruthy();
    expect(screen.queryByText("林離開")).toBeNull();
  });

  it("勾選「顯示已離開」→ 已離開的人出現並標已離開", () => {
    render(<MembersSection rows={rows} groups={groups} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "顯示已離開" }));
    const lin = screen.getByText("林離開").closest("tr")!;
    expect(within(lin).getByText(/已離開/)).toBeTruthy();
    expect(bodyRows()).toHaveLength(3);
  });

  it("用姓名或學號搜尋", () => {
    render(<MembersSection rows={rows} groups={groups} />);
    const search = screen.getByRole("searchbox", { name: "搜尋姓名或學號" });
    fireEvent.change(search, { target: { value: "陳" } });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText("陳幹部")).toBeTruthy();
    fireEvent.change(search, { target: { value: "110701" } });
    expect(screen.getByText("王小明")).toBeTruthy();
    expect(screen.queryByText("陳幹部")).toBeNull();
    fireEvent.change(search, { target: { value: "沒有" } });
    expect(screen.getByText("找不到符合的成員")).toBeTruthy();
  });

  // 最終審查 I2：還沒匯入名單前不能用「新增成員」（先加人會讓之後的整批匯入被擋下來）。
  it("名單是空的（還沒匯入）：不顯示「新增成員」按鈕，改顯示先匯入名單的提示", () => {
    render(<MembersSection rows={[]} groups={groups} />);
    expect(screen.queryByRole("button", { name: "新增成員" })).toBeNull();
    expect(screen.getByText("名單上還沒有任何人。請先用上面的「名單匯入」匯入名單，再用「新增成員」補人。")).toBeTruthy();
  });

  it("名單上只剩已離開的人：名單已匯入過，仍顯示「新增成員」按鈕（用來重新加回）", () => {
    render(<MembersSection rows={[rows[3]]} groups={groups} />);
    expect(screen.getByRole("button", { name: "新增成員" })).toBeTruthy();
  });

  it("新增成員：送出表單呼叫 addMember，錯誤顯示在表單裡", async () => {
    addMember.mockResolvedValue({ ok: false, error: "這個人已經有這個身份" });
    render(<MembersSection rows={rows} groups={groups} />);
    fireEvent.click(screen.getByRole("button", { name: "新增成員" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("信箱"), { target: { value: "wang@g.nccu.edu.tw" } });
    fireEvent.change(within(dialog).getByLabelText("姓名"), { target: { value: "王小明" } });
    fireEvent.change(within(dialog).getByLabelText("學號"), { target: { value: "110701001" } });
    fireEvent.change(within(dialog).getByLabelText("系級"), { target: { value: "資科三" } });
    // 預設角色是專案生，組別選單要出現
    expect(within(dialog).getByRole("combobox", { name: "組別" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "新增" }));

    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe("這個人已經有這個身份"));
    expect(addMember).toHaveBeenCalledWith({
      email: "wang@g.nccu.edu.tw", name: "王小明", role: "專案生", studentId: "110701001", deptYear: "資科三", groupId: "",
    });
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("新增成功：跳 toast、關閉視窗、重新整理", async () => {
    addMember.mockResolvedValue({ ok: true, memberId: "new", restored: false });
    render(<MembersSection rows={rows} groups={groups} />);
    fireEvent.click(screen.getByRole("button", { name: "新增成員" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("姓名"), { target: { value: "新同學" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "新增" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("已新增新同學"));
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("恢復已離開的身份：toast 說已重新加回", async () => {
    addMember.mockResolvedValue({ ok: true, memberId: "m4", restored: true });
    render(<MembersSection rows={rows} groups={groups} />);
    fireEvent.click(screen.getByRole("button", { name: "新增成員" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("姓名"), { target: { value: "林離開" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "新增" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("已把林離開重新加回名單"));
  });

  it("角色改成幹部：組別選單消失，送出的組別是空的", async () => {
    addMember.mockResolvedValue({ ok: true, memberId: "new", restored: false });
    render(<MembersSection rows={rows} groups={groups} />);
    fireEvent.click(screen.getByRole("button", { name: "新增成員" }));
    const dialog = await screen.findByRole("dialog");
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole("combobox", { name: "角色" }));
    await user.click(await screen.findByRole("option", { name: "其他幹部" }));
    await waitFor(() => expect(within(dialog).queryByRole("combobox", { name: "組別" })).toBeNull());
    fireEvent.change(within(dialog).getByLabelText("姓名"), { target: { value: "新幹部" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "新增" }));
    await waitFor(() => expect(addMember).toHaveBeenCalledWith(expect.objectContaining({ role: "其他幹部", groupId: "" })));
  });

  it("(a) 所有人都已離開、沒勾顯示已離開 → 顯示「目前沒有在名單上的成員」，不是匯入提示", () => {
    render(<MembersSection rows={[rows[3]]} groups={groups} />);
    expect(screen.getByText("目前沒有在名單上的成員")).toBeTruthy();
    expect(screen.queryByText(/名單上還沒有任何人/)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "顯示已離開" }));
    expect(screen.getByText("林離開")).toBeTruthy();
  });

  it("每個還在的身份有移除按鈕；已離開的身份沒有；按下先跳確認視窗寫出影響，確認才呼叫", async () => {
    removeIdentity.mockResolvedValue({ ok: true });
    render(<MembersSection rows={rows} groups={groups} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "顯示已離開" }));
    expect(screen.queryByRole("button", { name: "移除林離開的第2組專案生身份" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "移除王小明的第1組專案生身份" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("王小明的第1組專案生身份會標成已離開，之前交的進度保留")).toBeTruthy();
    expect(removeIdentity).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "確認移除" }));
    await waitFor(() => expect(removeIdentity).toHaveBeenCalledWith("m1"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("已移除王小明的第1組專案生身份"));
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("專案幹部身份：確認視窗說明負責組別會一起移除", async () => {
    render(<MembersSection rows={rows} groups={groups} />);
    fireEvent.click(screen.getByRole("button", { name: "移除陳幹部的專案幹部身份" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("陳幹部的專案幹部身份會標成已離開，負責的組別也會一併移除；之前的紀錄保留")).toBeTruthy();
  });

  it("按取消不會移除", async () => {
    render(<MembersSection rows={rows} groups={groups} />);
    fireEvent.click(screen.getByRole("button", { name: "移除王小明的第1組專案生身份" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(removeIdentity).not.toHaveBeenCalled();
  });

  it("移除整個人：確認視窗寫出影響，確認後呼叫 removePerson(email)", async () => {
    removePerson.mockResolvedValue({ ok: true });
    render(<MembersSection rows={rows} groups={groups} />);
    const wang = screen.getByText("王小明").closest("tr")!;
    fireEvent.click(within(wang).getByRole("button", { name: "移除整個人" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("王小明的所有身份都會標成已離開，之後不能再登入使用；之前交的進度保留")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "確認移除" }));
    await waitFor(() => expect(removePerson).toHaveBeenCalledWith("wang@g.nccu.edu.tw"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("已移除王小明"));
  });

  it("已經全部離開的人沒有「移除整個人」", () => {
    render(<MembersSection rows={rows} groups={groups} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "顯示已離開" }));
    const lin = screen.getByText("林離開").closest("tr")!;
    expect(within(lin).queryByRole("button", { name: "移除整個人" })).toBeNull();
  });

  it("移除失敗：錯誤顯示在確認視窗裡，視窗留著", async () => {
    removePerson.mockResolvedValue({ ok: false, error: "找不到這個人" });
    render(<MembersSection rows={rows} groups={groups} />);
    const wang = screen.getByText("王小明").closest("tr")!;
    fireEvent.click(within(wang).getByRole("button", { name: "移除整個人" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "確認移除" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe("找不到這個人"));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
