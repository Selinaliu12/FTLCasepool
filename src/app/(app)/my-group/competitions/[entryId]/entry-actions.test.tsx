import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { EntryActions } from "./entry-actions";
import type { EntryDetail } from "@/server/queries/entries";

const setEntryMembers = vi.fn();
const confirmEntry = vi.fn();
const withdrawEntry = vi.fn();
vi.mock("@/server/actions/entries", () => ({
  setEntryMembers: (...args: unknown[]) => setEntryMembers(...args),
  confirmEntry: (...args: unknown[]) => confirmEntry(...args),
  withdrawEntry: (...args: unknown[]) => withdrawEntry(...args),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push }) }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() } }));

function confirmedEntryWithMovedOutMember(): EntryDetail {
  return {
    entryId: "entry-1",
    competitionName: "黑客松",
    competitionUrl: "https://example.com",
    status: "in_progress",
    confirmedAt: new Date(),
    withdrawnAt: null,
    result: null,
    groupStudents: [
      { id: "a1", name: "甲一" },
      { id: "a3", name: "甲三" },
    ],
    selectedMemberIds: ["a1", "a2"],
    selectedMembers: [
      { id: "a1", name: "甲一", movedOut: false, left: false },
      { id: "a2", name: "甲二", movedOut: true, left: false },
    ],
    lineId: null,
    stages: [],
    submissions: [],
  };
}

describe("EntryActions：換組成員與編輯參賽成員", () => {
  beforeEach(() => {
    setEntryMembers.mockReset();
    confirmEntry.mockReset();
    withdrawEntry.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  // Fix round 2：selected 的初始值（以及取消編輯時的還原值）如果直接沿用
  // entry.selectedMemberIds，會永遠含著已換組成員的 id——但候選名單（groupStudents）只有
  // 現在的組員，換組的人不會出現在checkbox 列表裡，導致這個 id 永遠沒辦法被勾掉，
  // 每次儲存都會被 update_entry_members() 拒絕（只能勾選自己組的專案生）。
  it("進入編輯模式時，已換組成員不在候選名單裡；儲存只送出目前組員的 id，並顯示提示", async () => {
    setEntryMembers.mockResolvedValue({ ok: true });
    render(<EntryActions entry={confirmedEntryWithMovedOutMember()} myMemberId="a1" />);

    fireEvent.click(screen.getByRole("button", { name: "編輯參賽成員" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "儲存" })).toBeTruthy());
    // 已換組的甲二不會出現在勾選候選名單裡（只有 groupStudents：甲一、甲三）。
    expect(screen.queryByText("甲二", { exact: true })).toBeNull();
    // 顯示提示：已換組的同學儲存後會從參賽名單移除。
    expect(screen.getByText("已換組的同學（甲二）儲存後會從參賽名單移除")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => expect(setEntryMembers).toHaveBeenCalledTimes(1));
    const [, memberIds] = setEntryMembers.mock.calls[0];
    expect((memberIds as string[]).sort()).toEqual(["a1"]);
  });

  it("取消編輯後還原的候選狀態也不含已換組成員", async () => {
    render(<EntryActions entry={confirmedEntryWithMovedOutMember()} myMemberId="a1" />);

    fireEvent.click(screen.getByRole("button", { name: "編輯參賽成員" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toBeTruthy());

    // 額外勾選甲三，再按取消——應該完全還原（甲一勾選、甲三不勾選），不含甲二。
    fireEvent.click(screen.getByText("甲三", { exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    // 回到唯讀畫面：仍然顯示（已換組）的甲二（顯示不受影響，只有可編輯候選名單受影響）。
    expect(screen.getByText("甲一、甲二（已換組）")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "編輯參賽成員" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存" })).toBeTruthy());
    setEntryMembers.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => expect(setEntryMembers).toHaveBeenCalledTimes(1));
    const [, memberIds] = setEntryMembers.mock.calls[0];
    expect((memberIds as string[]).sort()).toEqual(["a1"]);
  });

  it("沒有已換組成員時不顯示提示", async () => {
    const entry: EntryDetail = {
      ...confirmedEntryWithMovedOutMember(),
      selectedMemberIds: ["a1"],
      selectedMembers: [{ id: "a1", name: "甲一", movedOut: false, left: false }],
    };
    render(<EntryActions entry={entry} myMemberId="a1" />);
    fireEvent.click(screen.getByRole("button", { name: "編輯參賽成員" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存" })).toBeTruthy());
    expect(screen.queryByText(/已換組的同學/)).toBeNull();
  });

  // Fix round 2（cosmetic）：entry_members 指到的成員如果整列都被刪掉了（不是換組，是真的
  // 不在名單上了），movedOut 還是 true 但名字會是空字串——不該顯示「（已換組）」配空白。
  it("成員資料整列都不見時，顯示（已不在名單）而不是空白名字＋已換組", () => {
    const entry: EntryDetail = {
      ...confirmedEntryWithMovedOutMember(),
      selectedMemberIds: ["a1", "ghost"],
      selectedMembers: [
        { id: "a1", name: "甲一", movedOut: false, left: false },
        { id: "ghost", name: "", movedOut: true, left: false },
      ],
    };
    render(<EntryActions entry={entry} myMemberId="a1" />);
    expect(screen.getByText("甲一、（已不在名單）")).toBeTruthy();
  });
});

// Task 7：已離開的參賽成員照樣列在名單上，標「（已離開）」；編輯時不在候選名單、不能再勾，
// 儲存後從參賽名單移除（跟已換組的人一樣，先提醒）。
describe("EntryActions：已離開的參賽成員", () => {
  afterEach(() => cleanup());

  function entryWithLeftMember(): EntryDetail {
    return {
      ...confirmedEntryWithMovedOutMember(),
      groupStudents: [{ id: "a1", name: "甲一" }],
      selectedMemberIds: ["a1", "a2"],
      selectedMembers: [
        { id: "a1", name: "甲一", movedOut: false, left: false },
        { id: "a2", name: "甲二", movedOut: false, left: true },
      ],
    };
  }

  it("唯讀畫面顯示 甲二（已離開）", () => {
    render(<EntryActions entry={entryWithLeftMember()} myMemberId="a1" />);
    expect(screen.getByText("甲一、甲二（已離開）")).toBeTruthy();
  });

  it("編輯時已離開的人不能勾、儲存只送還在的人，並提醒", async () => {
    setEntryMembers.mockReset();
    setEntryMembers.mockResolvedValue({ ok: true });
    render(<EntryActions entry={entryWithLeftMember()} myMemberId="a1" />);
    fireEvent.click(screen.getByRole("button", { name: "編輯參賽成員" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存" })).toBeTruthy());
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText("已離開的同學（甲二）儲存後會從參賽名單移除")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => expect(setEntryMembers).toHaveBeenCalledTimes(1));
    expect(setEntryMembers.mock.calls[0][1]).toEqual(["a1"]);
  });
});

function unconfirmedEntry(): EntryDetail {
  return {
    ...confirmedEntryWithMovedOutMember(),
    status: "unconfirmed",
    confirmedAt: null,
    selectedMemberIds: [],
    selectedMembers: [],
  };
}

// Final review minor 4：還沒確認的報名可以「移除」（withdrawEntry 對未確認的報名是整筆刪除），
// 要先跳確認對話框。
describe("EntryActions：移除未確認的報名", () => {
  beforeEach(() => {
    withdrawEntry.mockReset();
    push.mockReset();
    toastError.mockReset();
  });
  afterEach(() => cleanup());

  it("按移除先跳確認對話框，確定後呼叫 withdrawEntry 並回到我的組", async () => {
    withdrawEntry.mockResolvedValue({ ok: true });
    render(<EntryActions entry={unconfirmedEntry()} myMemberId="a1" />);

    fireEvent.click(screen.getByRole("button", { name: "移除" }));
    expect(withdrawEntry).not.toHaveBeenCalled();
    expect(screen.getByText("確定要移除這場比賽嗎？")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "確定移除" }));
    await waitFor(() => expect(withdrawEntry).toHaveBeenCalledWith("entry-1"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/my-group"));
  });

  it("確認對話框按再想想：不呼叫 withdrawEntry", () => {
    render(<EntryActions entry={unconfirmedEntry()} myMemberId="a1" />);
    fireEvent.click(screen.getByRole("button", { name: "移除" }));
    fireEvent.click(screen.getByRole("button", { name: "再想想" }));
    expect(withdrawEntry).not.toHaveBeenCalled();
  });
});

// Final review minor 5：server action 丟出未預期的例外（網路中斷等）時要跳 toast，不能靜靜吞掉。
describe("EntryActions：例外時跳 toast", () => {
  beforeEach(() => {
    confirmEntry.mockReset();
    setEntryMembers.mockReset();
    withdrawEntry.mockReset();
    toastError.mockReset();
  });
  afterEach(() => cleanup());

  it("確認報名丟例外 → toast", async () => {
    confirmEntry.mockRejectedValue(new Error("boom"));
    render(<EntryActions entry={unconfirmedEntry()} myMemberId="a1" />);
    fireEvent.click(screen.getByRole("button", { name: "確認報名" }));
    fireEvent.click(screen.getByRole("button", { name: "確定" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("操作失敗，請重試"));
  });

  it("儲存參賽成員丟例外 → toast", async () => {
    setEntryMembers.mockRejectedValue(new Error("boom"));
    render(<EntryActions entry={confirmedEntryWithMovedOutMember()} myMemberId="a1" />);
    fireEvent.click(screen.getByRole("button", { name: "編輯參賽成員" }));
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("操作失敗，請重試"));
  });

  it("取消報名丟例外 → toast", async () => {
    withdrawEntry.mockRejectedValue(new Error("boom"));
    render(<EntryActions entry={confirmedEntryWithMovedOutMember()} myMemberId="a1" />);
    fireEvent.click(screen.getByRole("button", { name: "取消報名" }));
    fireEvent.click(screen.getByRole("button", { name: "確定取消報名" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("操作失敗，請重試"));
  });
});
