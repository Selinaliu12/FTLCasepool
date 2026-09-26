import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CheckinHistory } from "./checkin-history";
import type { CheckinHistoryEntry } from "@/domain/checkin-history";

describe("CheckinHistory", () => {
  afterEach(() => cleanup());

  it("沒有燈號歷程時顯示『還沒有組員點燈』", () => {
    render(<CheckinHistory checkins={[]} />);
    expect(screen.getByText("還沒有組員點燈")).toBeTruthy();
  });

  it("列出每筆燈號、誰、何時；紅燈的說明（note）一起顯示", () => {
    const checkins: CheckinHistoryEntry[] = [
      { light: "red", note: "卡在資料串接", by: "甲一", at: new Date("2026-09-27T00:46:00Z") },
      { light: "green", note: null, by: "乙一", at: new Date("2026-09-26T00:00:00Z") },
    ];
    render(<CheckinHistory checkins={checkins} />);
    expect(screen.getByText("紅燈")).toBeTruthy();
    expect(screen.getByText("卡在資料串接")).toBeTruthy();
    expect(screen.getByText("綠燈")).toBeTruthy();
    expect(screen.getByText(/甲一/)).toBeTruthy();
  });
});
