import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MembersSection } from "./members-section";
import type { MemberListRow } from "@/domain/member-list";

const addMember = vi.fn();
vi.mock("@/server/actions/admin", () => ({ addMember: (...args: unknown[]) => addMember(...args) }));
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
    refresh.mockReset();
    toastSuccess.mockReset();
  });
  afterEach(() => cleanup());

  it("每個人一列：姓名、信箱、學號、系級、所有身份；預設不列已離開的人", () => {
    render(<MembersSection rows={rows} groups={groups} />);
    expect(bodyRows()).toHaveLength(2);
    const wang = screen.getByText("王小明").closest("tr")!;
    expect(within(wang).getByText("wang@g.nccu.edu.tw")).toBeTruthy();
    expect(within(wang).getByText("110701001")).toBeTruthy();
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

  it("名單是空的：顯示空狀態", () => {
    render(<MembersSection rows={[]} groups={groups} />);
    expect(screen.getByText(/名單上還沒有任何人/)).toBeTruthy();
  });

  it("新增成員：送出表單呼叫 addMember，錯誤顯示在表單裡", async () => {
    addMember.mockResolvedValue({ ok: false, error: "這個人已經有這個身份" });
    render(<MembersSection rows={rows} groups={groups} />);
    fireEvent.click(screen.getByRole("button", { name: "新增成員" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("學校信箱"), { target: { value: "wang@g.nccu.edu.tw" } });
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
});
