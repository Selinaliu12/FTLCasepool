import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { GroupCard } from "./group-card";
import type { GroupCard as GroupCardData } from "@/domain/dashboard";

function card(overrides: Partial<GroupCardData> = {}): GroupCardData {
  return {
    groupId: "g1",
    groupName: "第2組",
    projectName: "專案B",
    lines: [{ lineId: "l1", kind: "project", light: "red", source: "系統：第 1 期逾期 4 天", onTime: 0.5 }],
    stage: "第 2 期",
    nextDeadline: { at: new Date("2026-10-16T15:59:59.999Z"), daysLeft: 5 },
    ...overrides,
  };
}

describe("GroupCard", () => {
  afterEach(() => cleanup());

  it("顯示組名、專案名、燈號＋來源、階段、下一個截止日、準時率", () => {
    render(<GroupCard card={card()} isMine={false} />);
    expect(screen.getByText("第2組")).toBeTruthy();
    expect(screen.getByText("專案B")).toBeTruthy();
    expect(screen.getByText("系統：第 1 期逾期 4 天")).toBeTruthy();
    expect(screen.getByText("第 2 期")).toBeTruthy();
    expect(screen.getByText("10/16（五）23:59 · 剩 5 天")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("準時率 null 顯示 —", () => {
    render(<GroupCard card={card({ lines: [{ lineId: "l1", kind: "project", light: "green", source: "s", onTime: null }] })} isMine={false} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("isMine 為 true 時顯示『你負責』標記，否則不顯示", () => {
    render(<GroupCard card={card()} isMine={true} />);
    expect(screen.getByText("你負責")).toBeTruthy();
    cleanup();
    render(<GroupCard card={card()} isMine={false} />);
    expect(screen.queryByText("你負責")).toBeNull();
  });

  it("canViewContent 為 true 時顯示『看內容』連到 /groups/[id]，否則不顯示", () => {
    render(<GroupCard card={card()} isMine={false} canViewContent={true} />);
    const link = screen.getByRole("link", { name: "看內容" });
    expect(link.getAttribute("href")).toBe("/groups/g1");
    cleanup();
    render(<GroupCard card={card()} isMine={false} canViewContent={false} />);
    expect(screen.queryByRole("link", { name: "看內容" })).toBeNull();
  });
});
