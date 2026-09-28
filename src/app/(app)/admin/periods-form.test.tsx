import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PeriodsForm } from "./periods-form";

const savePeriods = vi.fn();
const previewPeriodDeletion = vi.fn();
vi.mock("@/server/actions/admin", () => ({
  savePeriods: (...args: unknown[]) => savePeriods(...args),
  previewPeriodDeletion: (...args: unknown[]) => previewPeriodDeletion(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("PeriodsForm", () => {
  beforeEach(() => {
    savePeriods.mockReset();
    savePeriods.mockResolvedValue({ ok: true });
    previewPeriodDeletion.mockReset();
    previewPeriodDeletion.mockResolvedValue([]);
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

    await waitFor(() =>
      expect(savePeriods).toHaveBeenCalledWith("s1", [{ date: "2026-10-01", time: "23:59", suggestion: "" }])
    );
  });

  // 改寫自「已有人交件的期別只能看、不能改或刪」（規格 §14 第 8 點：任何一期都能改）。
  it("每一期都能改日期、都有刪除鈕；不再標「已有人交件」", async () => {
    render(
      <PeriodsForm
        semesterId="s1"
        initialRows={[
          { id: "p1", date: "2026-10-01", time: "23:59" },
          { id: "p2", date: "2026-11-01", time: "23:59" },
        ]}
      />
    );

    expect(screen.getByLabelText("第 1 期日期")).toBeTruthy();
    expect(screen.getByRole("button", { name: "刪除第 1 期" })).toBeTruthy();
    expect(screen.queryByText("已有人交件")).toBeNull();

    fireEvent.change(screen.getByLabelText("第 1 期日期"), { target: { value: "2026-10-03" } });
    fireEvent.change(screen.getByLabelText("第 2 期日期"), { target: { value: "2026-11-15" } });
    fireEvent.click(screen.getByRole("button", { name: "新增一期" }));
    fireEvent.change(screen.getByLabelText("第 3 期日期"), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存期別" }));

    await waitFor(() =>
      expect(savePeriods).toHaveBeenCalledWith("s1", [
        { id: "p1", date: "2026-10-03", time: "23:59", suggestion: "" },
        { id: "p2", date: "2026-11-15", time: "23:59", suggestion: "" },
        { date: "2026-12-01", time: "23:59", suggestion: "" },
      ])
    );
    expect(previewPeriodDeletion).not.toHaveBeenCalled();
  });

  it("刪掉沒人交件的期別：先查一次，沒有交件就直接儲存，不跳確認視窗", async () => {
    previewPeriodDeletion.mockResolvedValue([{ periodId: "p2", seq: 2, reportCount: 0 }]);
    render(
      <PeriodsForm
        semesterId="s1"
        initialRows={[
          { id: "p1", date: "2026-10-01", time: "23:59" },
          { id: "p2", date: "2026-11-01", time: "23:59" },
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "刪除第 2 期" }));
    fireEvent.click(screen.getByRole("button", { name: "儲存期別" }));

    await waitFor(() =>
      expect(savePeriods).toHaveBeenCalledWith("s1", [{ id: "p1", date: "2026-10-01", time: "23:59", suggestion: "" }])
    );
    expect(previewPeriodDeletion).toHaveBeenCalledWith(["p2"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("刪掉有人交件的期別：跳確認視窗列出每一期，打「刪除」才能按確定，確定後帶確認旗標儲存", async () => {
    previewPeriodDeletion.mockResolvedValue([
      { periodId: "p1", seq: 1, reportCount: 3 },
      { periodId: "p2", seq: 2, reportCount: 1 },
    ]);
    render(
      <PeriodsForm
        semesterId="s1"
        initialRows={[
          { id: "p1", date: "2026-10-01", time: "23:59" },
          { id: "p2", date: "2026-11-01", time: "23:59" },
          { id: "p3", date: "2026-12-01", time: "23:59" },
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "刪除第 1 期" }));
    fireEvent.click(screen.getByRole("button", { name: "刪除第 1 期" }));
    fireEvent.click(screen.getByRole("button", { name: "儲存期別" }));

    const dialog = await screen.findByRole("dialog");
    expect(previewPeriodDeletion).toHaveBeenCalledWith(["p1", "p2"]);
    expect(savePeriods).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain("第 1 期有 3 組交了進度，刪除會一併刪掉這些進度與檔案");
    expect(dialog.textContent).toContain("第 2 期有 1 組交了進度，刪除會一併刪掉這些進度與檔案");

    const confirm = screen.getByRole("button", { name: "確定刪除" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("輸入「刪除」確認"), { target: { value: "刪" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("輸入「刪除」確認"), { target: { value: "刪除" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(savePeriods).toHaveBeenCalledWith(
        "s1",
        [{ id: "p3", date: "2026-12-01", time: "23:59", suggestion: "" }],
        { confirmDeleteWithReports: true }
      )
    );
  });

  it("確認視窗按取消：不儲存，列表維持編輯中的樣子", async () => {
    previewPeriodDeletion.mockResolvedValue([{ periodId: "p1", seq: 1, reportCount: 2 }]);
    render(
      <PeriodsForm
        semesterId="s1"
        initialRows={[
          { id: "p1", date: "2026-10-01", time: "23:59" },
          { id: "p2", date: "2026-11-01", time: "23:59" },
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "刪除第 1 期" }));
    fireEvent.click(screen.getByRole("button", { name: "儲存期別" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(savePeriods).not.toHaveBeenCalled();
    expect(screen.getAllByLabelText(/期日期/)).toHaveLength(1);
  });

  it("savePeriods 丟例外時，錯誤訊息要顯示出來", async () => {
    savePeriods.mockRejectedValue(new Error("已經有組別交了進度，不能再改期別"));
    render(<PeriodsForm semesterId="s1" initialRows={[]} />);
    fireEvent.change(screen.getByLabelText("第 1 期日期"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存期別" }));

    await waitFor(() => expect(screen.getByText("已經有組別交了進度，不能再改期別")).toBeTruthy());
  });

  it("每列有「建議內容（選填）」多行文字欄，送出時帶上", async () => {
    render(<PeriodsForm semesterId="s1" initialRows={[{ id: "p1", date: "2026-10-01", time: "23:59" }]} />);

    const textarea = screen.getByLabelText("第 1 期建議內容（選填）");
    fireEvent.change(textarea, { target: { value: "這期建議交截圖" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存期別" }));

    await waitFor(() =>
      expect(savePeriods).toHaveBeenCalledWith("s1", [
        { id: "p1", date: "2026-10-01", time: "23:59", suggestion: "這期建議交截圖" },
      ])
    );
  });
});
