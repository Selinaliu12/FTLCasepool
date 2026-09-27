import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import CompetitionsLoading from "./competitions/loading";
import CompetitionsError from "./competitions/error";
import MyGroupLoading from "./my-group/loading";
import MyGroupError from "./my-group/error";
import EntryLoading from "./my-group/competitions/[entryId]/loading";
import EntryError from "./my-group/competitions/[entryId]/error";
import GroupLoading from "./groups/[groupId]/loading";
import GroupError from "./groups/[groupId]/error";

// Final review minor 6：這四條路由都要有 loading.tsx（資料還沒讀完時的骨架）與 error.tsx
// （讀取失敗時顯示訊息＋重試，不是整頁白畫面）。
const cases = [
  { name: "/competitions", Loading: CompetitionsLoading, ErrorView: CompetitionsError, title: "競賽大廳" },
  { name: "/my-group", Loading: MyGroupLoading, ErrorView: MyGroupError, title: "我的組" },
  { name: "/my-group/competitions/[entryId]", Loading: EntryLoading, ErrorView: EntryError, title: "報名頁" },
  { name: "/groups/[groupId]", Loading: GroupLoading, ErrorView: GroupError, title: "組別內容" },
];

describe.each(cases)("$name loading／error", ({ Loading, ErrorView, title }) => {
  afterEach(() => cleanup());

  it("loading 顯示骨架（有 aria-busy）", () => {
    const { container } = render(<Loading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("error 顯示標題、讀取失敗訊息，按重試呼叫 reset", () => {
    const reset = vi.fn();
    render(<ErrorView error={new Error("boom")} reset={reset} />);
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(screen.getByText("資料讀取失敗，請稍後再試。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重試" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
