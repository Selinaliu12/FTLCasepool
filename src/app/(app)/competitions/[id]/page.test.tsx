import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { CompetitionCard } from "@/domain/competition";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/server/actions/entries", () => ({ attachCompetition: vi.fn() }));
const loadCompetitionDetail = vi.fn();
vi.mock("@/server/queries/competitions", () => ({
  loadCompetitionDetail: (...args: unknown[]) => loadCompetitionDetail(...args),
}));

import CompetitionDetailPage from "./page";

function card(overrides: Partial<CompetitionCard> = {}): CompetitionCard {
  return {
    id: "c1",
    name: "黑客松大賽",
    organizer: null,
    theme: null,
    eligibility: null,
    teamSize: null,
    prize: null,
    url: "https://example.com/comp",
    signupDeadline: new Date("2026-10-31T09:00:00.000Z"),
    submissionDeadline: null,
    finalDate: null,
    status: "published",
    summary: null,
    tags: [],
    maxPrize: null,
    perks: null,
    infoSessionAt: null,
    signupNote: null,
    submissionNote: null,
    finalNote: null,
    finalFormat: null,
    fee: null,
    documents: null,
    skills: null,
    recommended: false,
    staffNote: null,
    ...overrides,
  };
}

async function renderPage() {
  return render(await CompetitionDetailPage({ params: Promise.resolve({ id: "c1" }) }));
}

describe("CompetitionDetailPage：找不到頁面", () => {
  afterEach(() => cleanup());

  it("loadCompetitionDetail 回傳 null 時呼叫 notFound()", async () => {
    loadCompetitionDetail.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("CompetitionDetailPage：沒有內容的區塊整個不顯示（舊比賽，只有必填欄位）", () => {
  afterEach(() => cleanup());

  it("只顯示標題、賽程（報名）、報名方式；其他區塊都不出現", async () => {
    loadCompetitionDetail.mockResolvedValue({
      card: card(),
      canEdit: false,
      isStudent: false,
      attachedEntryId: null,
      attachedGroups: [],
    });

    await renderPage();

    expect(screen.getByText("黑客松大賽")).toBeTruthy();
    expect(screen.getByText("賽程與繳交")).toBeTruthy();
    expect(screen.getByText("報名方式")).toBeTruthy();
    expect(screen.getByText("10/31（六）17:00")).toBeTruthy();

    expect(screen.queryByText("參賽資格")).toBeNull();
    expect(screen.queryByText("獎勵與機會")).toBeNull();
    expect(screen.queryByText("組隊需求")).toBeNull();
    expect(screen.queryByText("幹部備註")).toBeNull();
    expect(screen.queryByText("已掛上的組別")).toBeNull();
    expect(screen.queryByText("說明會")).toBeNull();
    expect(screen.queryByText("繳件")).toBeNull();
    expect(screen.queryByText("決賽")).toBeNull();
  });
});

describe("CompetitionDetailPage：完整資料", () => {
  afterEach(() => cleanup());

  it("每一區都顯示對應內容", async () => {
    loadCompetitionDetail.mockResolvedValue({
      card: card({
        organizer: "資訊系學會",
        tags: ["ESG", "行銷"],
        recommended: true,
        summary: "一句話介紹內容",
        eligibility: "大學部學生皆可參加",
        infoSessionAt: new Date("2026-10-01T06:00:00.000Z"),
        submissionDeadline: new Date("2026-11-15T09:00:00.000Z"),
        submissionNote: "繳交企劃書 PDF",
        finalDate: new Date("2026-12-01T09:00:00.000Z"),
        finalNote: "決賽簡報",
        finalFormat: "線上進行",
        prize: "獎金＋實習機會",
        maxPrize: 100000,
        perks: "免費工作坊",
        teamSize: "3-5 人",
        skills: "程式、簡報",
        fee: "免費",
        documents: "身分證影本",
        staffNote: "第一行\n第二行",
      }),
      canEdit: false,
      isStudent: false,
      attachedEntryId: null,
      attachedGroups: ["第2組", "第10組"],
    });

    await renderPage();

    expect(screen.getByText("主辦：資訊系學會")).toBeTruthy();
    expect(screen.getByText("ESG")).toBeTruthy();
    expect(screen.getByText("行銷")).toBeTruthy();
    expect(screen.getByText("幹部推薦")).toBeTruthy();
    expect(screen.getByText("一句話介紹內容")).toBeTruthy();
    expect(screen.getByText("參賽資格")).toBeTruthy();
    expect(screen.getByText("大學部學生皆可參加")).toBeTruthy();

    expect(screen.getByText("說明會")).toBeTruthy();
    expect(screen.getByText("繳交企劃書 PDF")).toBeTruthy();
    expect(screen.getByText("決賽簡報")).toBeTruthy();
    expect(screen.getByText("線上進行")).toBeTruthy();

    expect(screen.getByText("獎勵與機會")).toBeTruthy();
    expect(screen.getByText("獎金＋實習機會")).toBeTruthy();
    expect(screen.getByText("NT$100,000")).toBeTruthy();
    expect(screen.getByText("免費工作坊")).toBeTruthy();

    expect(screen.getByText("組隊需求")).toBeTruthy();
    expect(screen.getByText("3-5 人")).toBeTruthy();
    expect(screen.getByText("程式、簡報")).toBeTruthy();

    expect(screen.getByText("報名方式")).toBeTruthy();
    expect(screen.getByText("免費")).toBeTruthy();
    expect(screen.getByText("身分證影本")).toBeTruthy();
    expect(screen.getByRole("link", { name: "官方連結" })).toBeTruthy();

    const staffNote = screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "第一行\n第二行");
    expect(staffNote.className).toContain("whitespace-pre-wrap");

    expect(screen.getByText("第2組、第10組")).toBeTruthy();
  });
});

describe("CompetitionDetailPage：報名截止日紅字與剩餘天數", () => {
  afterEach(() => cleanup());

  it("報名截止日文字用 --danger 色，並顯示剩 N 天", async () => {
    loadCompetitionDetail.mockResolvedValue({
      card: card({ signupDeadline: new Date("2099-10-31T09:00:00.000Z") }),
      canEdit: false,
      isStudent: false,
      attachedEntryId: null,
      attachedGroups: [],
    });

    await renderPage();

    const deadline = screen.getByText((_, el) => el?.tagName === "SPAN" && (el?.textContent?.startsWith("10/31") ?? false));
    expect(deadline.className).toContain("text-[var(--danger)]");
    expect(deadline.textContent).toMatch(/（剩 \d+ 天）/);
  });
});

describe("CompetitionDetailPage：學生看到掛到我們組，幹部看到編輯", () => {
  afterEach(() => cleanup());

  it("學生（未掛）看到掛到我們組按鈕", async () => {
    loadCompetitionDetail.mockResolvedValue({
      card: card(),
      canEdit: false,
      isStudent: true,
      attachedEntryId: null,
      attachedGroups: [],
    });

    await renderPage();
    expect(screen.getByRole("button", { name: "掛到我們組" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "編輯" })).toBeNull();
  });

  it("學生（已掛）看到已掛到你們組連結", async () => {
    loadCompetitionDetail.mockResolvedValue({
      card: card(),
      canEdit: false,
      isStudent: true,
      attachedEntryId: "entry-1",
      attachedGroups: [],
    });

    await renderPage();
    const link = screen.getByRole("link", { name: "已掛到你們組" });
    expect(link.getAttribute("href")).toBe("/my-group/competitions/entry-1");
  });

  it("幹部看到編輯連結，沒有掛到我們組按鈕", async () => {
    loadCompetitionDetail.mockResolvedValue({
      card: card(),
      canEdit: true,
      isStudent: false,
      attachedEntryId: null,
      attachedGroups: [],
    });

    await renderPage();
    const link = screen.getByRole("link", { name: "編輯" });
    expect(link.getAttribute("href")).toBe("/competitions/c1/edit");
    expect(screen.queryByRole("button", { name: "掛到我們組" })).toBeNull();
  });
});
