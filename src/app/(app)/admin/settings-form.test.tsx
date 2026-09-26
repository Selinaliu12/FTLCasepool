import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SettingsForm } from "./settings-form";

vi.mock("@/server/actions/admin", () => ({ setRedAfterHours: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => cleanup());

// 最終審查 M10：紅燈門檻是「逾期超過幾小時」（規格 §4.5），不是「多久沒回應」。
describe("SettingsForm", () => {
  it("欄位名稱是「逾期超過幾小時轉紅燈」，不再出現「未回應」", () => {
    render(<SettingsForm semesterId="s1" initialHours={72} />);
    expect(screen.getByLabelText("逾期超過幾小時轉紅燈")).toBeTruthy();
    expect(screen.queryByText(/未回應/)).toBeNull();
  });
});
