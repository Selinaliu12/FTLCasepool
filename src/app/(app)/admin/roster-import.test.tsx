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

  it("importRoster 丟例外時，錯誤訊息要顯示出來", async () => {
    importRoster.mockRejectedValue(new Error("只有系統管理員可以這樣做"));
    render(<RosterImport semesterId="s1" alreadyImported={false} />);

    fireEvent.change(screen.getByLabelText("貼上名單 CSV"), { target: { value: "email,姓名,角色,組別,專案名稱" } });
    fireEvent.click(screen.getByRole("button", { name: "匯入名單" }));

    await waitFor(() => expect(screen.getByText("只有系統管理員可以這樣做")).toBeTruthy());
  });
});
