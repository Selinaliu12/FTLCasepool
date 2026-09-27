import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { CompetitionCard } from "@/domain/competition";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/server/actions/entries", () => ({ attachCompetition: vi.fn() }));
const loadLobby = vi.fn();
vi.mock("@/server/queries/competitions", () => ({ loadLobby: (...args: unknown[]) => loadLobby(...args) }));

import CompetitionsPage from "./page";

function card(id: string, name: string, signupDeadline: string): CompetitionCard {
  return {
    id,
    name,
    organizer: null,
    theme: null,
    eligibility: null,
    teamSize: null,
    prize: null,
    url: "https://example.com",
    signupDeadline: new Date(signupDeadline),
    submissionDeadline: null,
    finalDate: null,
    status: "published",
  };
}

// Final review minor 13：已截止區的卡片，如果這組已經掛了（還沒退出），仍然顯示「已掛到你們組」
// 連到報名頁；沒掛過的已截止卡片不顯示「掛到我們組」（已經不能掛了）。
describe("CompetitionsPage：已截止區", () => {
  afterEach(() => cleanup());

  it("已掛的已截止卡片顯示已掛到你們組連結；沒掛的不顯示掛到我們組", async () => {
    loadLobby.mockResolvedValue({
      open: [],
      closed: [card("c1", "已掛的舊比賽", "2020-01-01T15:59:59.999Z"), card("c2", "沒掛的舊比賽", "2020-01-02T15:59:59.999Z")],
      drafts: [],
      canEdit: false,
      isStudent: true,
      myGroupAttached: { c1: "entry-1" },
    });

    render(await CompetitionsPage());
    const closed = screen.getByRole("heading", { name: "已截止" }).closest("section")!;
    const link = within(closed).getByRole("link", { name: "已掛到你們組" });
    expect(link.getAttribute("href")).toBe("/my-group/competitions/entry-1");
    expect(within(closed).getAllByRole("link", { name: "已掛到你們組" })).toHaveLength(1);
    expect(within(closed).queryByRole("button", { name: "掛到我們組" })).toBeNull();
  });
});
