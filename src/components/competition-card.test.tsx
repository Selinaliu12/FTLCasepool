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

describe("CompetitionCard", () => {
  afterEach(() => cleanup());

  it("should render signup deadline with danger color styling", () => {
    const card = createTestCard();
    const now = new Date("2026-09-28T00:00:00Z");

    render(<CompetitionCard card={card} now={now} />);

    // Find the signup deadline line - it should contain the formatted date
    const deadlineText = screen.getByText(/報名截止：/);
    const deadlineParagraph = deadlineText.closest("p");

    expect(deadlineParagraph).toBeTruthy();

    // Check that the paragraph has the text-[var(--danger)] class
    // This class will color the deadline text in the danger color
    expect(deadlineParagraph?.classList.contains("text-[var(--danger)]")).toBe(true);
  });
});
