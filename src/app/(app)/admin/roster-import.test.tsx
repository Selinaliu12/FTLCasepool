import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { RosterImport } from "./roster-import";

const importRoster = vi.fn();
vi.mock("@/server/actions/admin", () => ({ importRoster: (...args: unknown[]) => importRoster(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("RosterImport", () => {
  beforeEach(() => {
    importRoster.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("已匯入：提示學期中的異動請用「成員」區塊", () => {
    render(<RosterImport semesterId="s1" alreadyImported={true} />);
    expect(screen.getByText("本學期已匯入名單；學期中的異動請用下面的「成員」區塊。")).toBeTruthy();
    expect(screen.queryByText(/換組/)).toBeNull();
  });

  it("importRoster 丟例外時，錯誤訊息要顯示出來", async () => {
    importRoster.mockRejectedValue(new Error("只有系統管理員可以這樣做"));
    render(<RosterImport semesterId="s1" alreadyImported={false} />);

    fireEvent.change(screen.getByLabelText("貼上名單 CSV"), { target: { value: "email,姓名,角色,學號,系級,組別,專案名稱" } });
    fireEvent.click(screen.getByRole("button", { name: "匯入名單" }));

    await waitFor(() => expect(screen.getByText("只有系統管理員可以這樣做")).toBeTruthy());
  });
});
