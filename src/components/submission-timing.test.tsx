import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SubmissionTiming } from "./submission-timing";

afterEach(() => cleanup());

describe("SubmissionTiming", () => {
  const deadline = "2026-10-16T15:59:59.999Z";

  it("截止前交 → 顯示「準時」", () => {
    render(<SubmissionTiming deadline={deadline} submittedAt="2026-10-16T10:00:00Z" />);
    expect(screen.getByText("準時")).toBeTruthy();
  });

  it("晚 3 天交 → 顯示「逾期 3 天」", () => {
    render(<SubmissionTiming deadline={deadline} submittedAt="2026-10-19T17:00:00Z" />);
    expect(screen.getByText("逾期 3 天")).toBeTruthy();
  });
});
