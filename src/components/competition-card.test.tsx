import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CompetitionCard } from "./competition-card";
import type { CompetitionCard as CompetitionCardData } from "@/domain/competition";

function createTestCard(overrides?: Partial<CompetitionCardData>): CompetitionCardData {
  return {
    id: "test-1",
    name: "Test Competition",
    organizer: "Test Org",
    theme: null,
    eligibility: null,
    teamSize: null,
    prize: null,
    url: "https://example.com",
    signupDeadline: new Date("2026-12-31T23:59:59Z"),
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

const NOW = new Date("2026-09-28T00:00:00Z");

describe("CompetitionCard", () => {
  afterEach(() => cleanup());

  it("報名截止值為 danger 色並顯示剩 N 天", () => {
    const card = createTestCard();

    render(<CompetitionCard card={card} now={NOW} />);

    expect(screen.getByText("報名截止")).toBeTruthy();
    const deadlineValue = screen.getByText(/剩 \d+ 天/).closest("p");
    expect(deadlineValue).toBeTruthy();
    expect(deadlineValue?.classList.contains("text-[var(--danger)]")).toBe(true);
  });

  it("有推薦 → 顯示幹部推薦標記", () => {
    render(<CompetitionCard card={createTestCard({ recommended: true })} now={NOW} />);
    expect(screen.getByText("幹部推薦")).toBeTruthy();
  });

  it("沒有推薦 → 不顯示幹部推薦標記", () => {
    render(<CompetitionCard card={createTestCard({ recommended: false })} now={NOW} />);
    expect(screen.queryByText("幹部推薦")).toBeNull();
  });

  it("標籤依傳入的清單順序顯示，使用 outline 樣式的 Badge", () => {
    // 呼叫端（domain 層 normalizeTags）已經依 COMPETITION_TAGS 清單順序排好，元件只負責照給定順序渲染。
    render(<CompetitionCard card={createTestCard({ tags: ["企業出題", "ESG", "行銷"] })} now={NOW} />);
    const badges = screen.getAllByText(/^(企業出題|ESG|行銷)$/);
    expect(badges.map((b) => b.textContent)).toEqual(["企業出題", "ESG", "行銷"]);
    for (const b of badges) {
      expect(b.classList.contains("border-border")).toBe(true);
    }
  });

  it("沒填最高獎金、隊伍 → 該格不出現", () => {
    render(<CompetitionCard card={createTestCard({ maxPrize: null, teamSize: null })} now={NOW} />);
    expect(screen.queryByText("最高獎金")).toBeNull();
    expect(screen.queryByText("隊伍")).toBeNull();
  });

  it("有填最高獎金、隊伍 → 顯示對應格子", () => {
    render(<CompetitionCard card={createTestCard({ maxPrize: 100000, teamSize: "3-5 人" })} now={NOW} />);
    expect(screen.getByText("最高獎金")).toBeTruthy();
    expect(screen.getByText("NT$100,000")).toBeTruthy();
    expect(screen.getByText("隊伍")).toBeTruthy();
    expect(screen.getByText("3-5 人")).toBeTruthy();
  });

  it("有填報名與決賽日期 → 賽制顯示報名 → 決賽", () => {
    render(
      <CompetitionCard
        card={createTestCard({ finalDate: new Date("2026-11-01T15:59:59.999Z") })}
        now={NOW}
      />
    );
    expect(screen.getByText("賽制")).toBeTruthy();
    expect(screen.getByText("報名 → 決賽")).toBeTruthy();
  });

  it("沒有掛上的組 → 不顯示底部那一行", () => {
    render(<CompetitionCard card={createTestCard()} now={NOW} attachedGroups={[]} />);
    expect(screen.queryByText(/已掛上/)).toBeNull();
  });

  it("有掛上的組 → 底部顯示組名，用、分隔", () => {
    render(<CompetitionCard card={createTestCard()} now={NOW} attachedGroups={["第2組", "第5組"]} />);
    expect(screen.getByText("第2組、第5組已掛上")).toBeTruthy();
  });

  it("整張卡片可點，連到 /competitions/{id}", () => {
    render(<CompetitionCard card={createTestCard({ id: "abc-123" })} now={NOW} />);
    const links = screen.getAllByRole("link");
    const detailLink = links.find((l) => l.getAttribute("href") === "/competitions/abc-123");
    expect(detailLink).toBeTruthy();
  });

  it("官方連結按鈕仍可獨立點擊，不是進詳細頁連結的子元素", () => {
    render(<CompetitionCard card={createTestCard({ id: "abc-123" })} now={NOW} />);
    const officialLink = screen.getByRole("link", { name: "官方連結" });
    expect(officialLink.getAttribute("href")).toBe("https://example.com");

    const links = screen.getAllByRole("link");
    const detailLink = links.find((l) => l.getAttribute("href") === "/competitions/abc-123")!;
    expect(detailLink.contains(officialLink)).toBe(false);
    expect(officialLink.contains(detailLink)).toBe(false);
  });

  it("編輯按鈕仍可獨立點擊，不是進詳細頁連結的子元素", () => {
    render(<CompetitionCard card={createTestCard({ id: "abc-123" })} now={NOW} canEdit />);
    const editLink = screen.getByRole("link", { name: "編輯" });
    const links = screen.getAllByRole("link");
    const detailLink = links.find((l) => l.getAttribute("href") === "/competitions/abc-123")!;
    expect(detailLink.contains(editLink)).toBe(false);
    expect(editLink.contains(detailLink)).toBe(false);
  });

  it("舊比賽（所有新欄位為 null）仍能正常渲染，不出現 null 字樣", () => {
    const { container } = render(<CompetitionCard card={createTestCard()} now={NOW} />);
    expect(container.textContent).not.toMatch(/null/i);
    expect(screen.getByText("Test Competition")).toBeTruthy();
  });

  // Task 3 review parked note（折進 Task 8）：organizer 是批次 2 就有的舊欄位，舊比賽也可能
  // 從沒填過（不是只有模板新欄位會是 null）——上面那個測試預設卡片的 organizer 是 "Test Org"，
  // 沒有真的蓋到「organizer 也是 null」這個舊資料情境，這裡另外補一個。
  it("舊比賽（含 organizer 為 null）仍能正常渲染，不出現 null 字樣", () => {
    const { container } = render(<CompetitionCard card={createTestCard({ organizer: null })} now={NOW} />);
    expect(container.textContent).not.toMatch(/null/i);
    expect(screen.getByText("Test Competition")).toBeTruthy();
  });

  it("主辦顯示在名稱下方獨立一行", () => {
    render(<CompetitionCard card={createTestCard({ organizer: "某某系學會" })} now={NOW} />);
    expect(screen.getByText(/某某系學會/)).toBeTruthy();
  });
});
