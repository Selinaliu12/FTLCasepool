import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import CompetitionsLoading from "./competitions/(lobby)/loading";
import CompetitionsError from "./competitions/error";
import MyGroupLoading from "./my-group/(overview)/loading";
import MyGroupError from "./my-group/error";
import EntryError from "./my-group/competitions/[entryId]/error";
import GroupError from "./groups/[groupId]/error";

// Final review minor 6：這四條路由讀取失敗時顯示訊息＋重試（error.tsx），不是整頁白畫面；
// /competitions 與 /my-group 資料還沒讀完時顯示骨架（loading.tsx）。
//
// /groups/[groupId] 與 /my-group/competitions/[entryId] 刻意「沒有」loading.tsx：這兩頁會
// notFound()，而有 loading.tsx 的區段會串流、在 notFound() 跑到之前就送出 200（controller
// ruling 4，commit fdf856f）。/competitions、/my-group 的 loading.tsx 也因此放在 (lobby)／
// (overview) route group 裡，只包住大廳／組頁本身，不包住底下會 404 的子路由。
const loadings = [
  { name: "/competitions", Loading: CompetitionsLoading },
  { name: "/my-group", Loading: MyGroupLoading },
];

const errors = [
  { name: "/competitions", ErrorView: CompetitionsError, title: "競賽大廳" },
  { name: "/my-group", ErrorView: MyGroupError, title: "我的組" },
  { name: "/my-group/competitions/[entryId]", ErrorView: EntryError, title: "報名頁" },
  { name: "/groups/[groupId]", ErrorView: GroupError, title: "組別內容" },
];

describe.each(loadings)("$name loading", ({ Loading }) => {
  afterEach(() => cleanup());

  it("顯示骨架（有 aria-busy）", () => {
    const { container } = render(<Loading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

describe.each(errors)("$name error", ({ ErrorView, title }) => {
  afterEach(() => cleanup());

  it("顯示標題、讀取失敗訊息，按重試呼叫 reset", () => {
    const reset = vi.fn();
    render(<ErrorView error={new Error("boom")} reset={reset} />);
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(screen.getByText("資料讀取失敗，請稍後再試。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重試" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
