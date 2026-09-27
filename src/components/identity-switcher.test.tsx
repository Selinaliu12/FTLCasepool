import { describe, it, expect, vi, afterEach } from "vitest";
import { Component, type ReactNode } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { IdentitySwitcher } from "./identity-switcher";
import type { Identity } from "@/domain/access";

const switchIdentity = vi.fn();
vi.mock("@/server/actions/identity", () => ({ switchIdentity: (...args: unknown[]) => switchIdentity(...args) }));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

// startTransition 裡丟出的錯誤會交給最近的 error boundary（React 19）；用它確認導頁錯誤是
// 「被重新丟出去」交給 Next 處理，而不是被吞掉變成 toast。
class Boundary extends Component<{ children: ReactNode; onError: (e: unknown) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    this.props.onError(e);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function redirectError(): Error {
  // Next 的 redirect() 例外是靠 digest 辨認的，訊息內容不重要（F1：不能靠比對 message 字串）。
  return Object.assign(new Error("whatever"), { digest: "NEXT_REDIRECT;push;/my-group;307;" });
}

const g1: Identity = { memberId: "m1", role: "student", groupId: "g1", label: "第1組專案生" };
const g3: Identity = { memberId: "m3", role: "student", groupId: "g3", label: "第3組專案生" };
const pm: Identity = { memberId: "p", role: "pm", groupId: null, label: "專案幹部" };

describe("IdentitySwitcher", () => {
  afterEach(() => {
    cleanup();
    switchIdentity.mockReset();
    toastError.mockReset();
  });

  it("只有一個身份：不顯示", () => {
    const { container } = render(<IdentitySwitcher identities={[g1]} activeId="m1" />);
    expect(container.textContent).toBe("");
  });

  it("多於一個身份：按鈕文字「身份：{目前身份} ▾」", () => {
    render(<IdentitySwitcher identities={[pm, g1, g3]} activeId="m1" />);
    expect(screen.getByRole("button", { name: "身份：第1組專案生 ▾" })).toBeTruthy();
  });

  it("打開選單列出所有身份，點另一個身份呼叫 switchIdentity(該身份 id)", async () => {
    switchIdentity.mockResolvedValue(undefined);
    render(<IdentitySwitcher identities={[pm, g1, g3]} activeId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: "身份：第1組專案生 ▾" }));
    const items = await screen.findAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual(["專案幹部", "第1組專案生", "第3組專案生"]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "第3組專案生" }));
    await waitFor(() => expect(switchIdentity).toHaveBeenCalledWith("m3"));
  });

  it("switchIdentity 丟一般錯誤 → toast「切換身份失敗，請重試」", async () => {
    switchIdentity.mockRejectedValue(new Error("boom"));
    render(<IdentitySwitcher identities={[pm, g1]} activeId="m1" />);
    fireEvent.click(screen.getByRole("button", { name: "身份：第1組專案生 ▾" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "專案幹部" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("切換身份失敗，請重試"));
  });

  it("Next 的導頁例外（用 digest 辨認，不看 message）→ 重新丟出去，不顯示 toast", async () => {
    switchIdentity.mockRejectedValue(redirectError());
    const caught = vi.fn();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Boundary onError={caught}>
        <IdentitySwitcher identities={[pm, g1]} activeId="m1" />
      </Boundary>
    );
    fireEvent.click(screen.getByRole("button", { name: "身份：第1組專案生 ▾" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "專案幹部" }));
    await waitFor(() => expect(caught).toHaveBeenCalled());
    expect((caught.mock.calls[0][0] as { digest?: string }).digest).toMatch(/^NEXT_REDIRECT/);
    expect(toastError).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
