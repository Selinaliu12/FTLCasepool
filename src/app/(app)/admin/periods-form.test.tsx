import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PeriodsForm } from "./periods-form";

const savePeriods = vi.fn();
vi.mock("@/server/actions/admin", () => ({ savePeriods: (...args: unknown[]) => savePeriods(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("PeriodsForm", () => {
  beforeEach(() => {
    savePeriods.mockReset();
    savePeriods.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("按「新增一期」多一列；時間預設 23:59", () => {
    render(<PeriodsForm semesterId="s1" initialRows={[]} />);
    expect(screen.getAllByLabelText(/期日期/)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "新增一期" }));

    const dateInputs = screen.getAllByLabelText(/期日期/);
    const timeInputs = screen.getAllByLabelText<HTMLInputElement>(/期時間/);
    expect(dateInputs).toHaveLength(2);
    expect(timeInputs[1].value).toBe("23:59");
  });

  it("送出時呼叫 savePeriods 並帶正確資料", async () => {
    render(<PeriodsForm semesterId="s1" initialRows={[]} />);
    fireEvent.change(screen.getByLabelText("第 1 期日期"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存期別" }));

    await waitFor(() => expect(savePeriods).toHaveBeenCalledWith("s1", [{ date: "2026-10-01", time: "23:59" }]));
  });
});
