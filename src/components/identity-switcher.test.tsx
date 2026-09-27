import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { IdentitySwitcher } from "./identity-switcher";
import type { Identity } from "@/domain/access";

const switchIdentity = vi.fn();
vi.mock("@/server/actions/identity", () => ({ switchIdentity: (...args: unknown[]) => switchIdentity(...args) }));

const g1: Identity = { memberId: "m1", role: "student", groupId: "g1", label: "第1組專案生" };
const g3: Identity = { memberId: "m3", role: "student", groupId: "g3", label: "第3組專案生" };
const pm: Identity = { memberId: "p", role: "pm", groupId: null, label: "專案幹部" };

describe("IdentitySwitcher", () => {
  afterEach(() => {
    cleanup();
    switchIdentity.mockReset();
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
});
