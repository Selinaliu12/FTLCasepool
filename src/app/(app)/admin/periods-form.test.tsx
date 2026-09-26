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

  it("已有人交件的期別只能看、不能改或刪，旁邊標「已有人交件」；其他期別照常可編輯", async () => {
    render(
      <PeriodsForm
        semesterId="s1"
        initialRows={[
          { id: "p1", date: "2026-10-01", time: "23:59", readOnly: true, hasReports: true },
          { id: "p2", date: "2026-11-01", time: "23:59", readOnly: false, hasReports: false },
        ]}
      />
    );

    expect(screen.queryByLabelText("第 1 期日期")).toBeNull();
    expect(screen.queryByRole("button", { name: "刪除第 1 期" })).toBeNull();
    expect(screen.getByText("已有人交件")).toBeTruthy();
    expect(screen.getByText("10/01（四）23:59")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("第 2 期日期"), { target: { value: "2026-11-15" } });
    fireEvent.click(screen.getByRole("button", { name: "新增一期" }));
    fireEvent.change(screen.getByLabelText("第 3 期日期"), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存期別" }));

    await waitFor(() =>
      expect(savePeriods).toHaveBeenCalledWith("s1", [
        { id: "p1", date: "2026-10-01", time: "23:59" },
        { id: "p2", date: "2026-11-15", time: "23:59" },
        { date: "2026-12-01", time: "23:59" },
      ])
    );
  });

  it("savePeriods 丟例外時，錯誤訊息要顯示出來", async () => {
    savePeriods.mockRejectedValue(new Error("已經有組別交了進度，不能再改期別"));
    render(<PeriodsForm semesterId="s1" initialRows={[]} />);
    fireEvent.change(screen.getByLabelText("第 1 期日期"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存期別" }));

    await waitFor(() => expect(screen.getByText("已經有組別交了進度，不能再改期別")).toBeTruthy());
  });
});
