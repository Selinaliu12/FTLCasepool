import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LightBadge } from "./light-badge";

describe("LightBadge", () => {
  it("顯示顏色圓點＋文字『紅燈』＋來源；有 aria-label『紅燈，系統：第 2 期逾期 3 天』", () => {
    render(<LightBadge light="red" source="系統：第 2 期逾期 3 天" />);
    const badge = screen.getByLabelText("紅燈，系統：第 2 期逾期 3 天");
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain("紅燈");
    expect(badge.textContent).toContain("系統：第 2 期逾期 3 天");
  });
});
