import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CompetitionForm } from "./competition-form";
import { emptyCompetitionForm } from "./competition-form-defaults";

const createCompetition = vi.fn();
const updateCompetition = vi.fn();
const publishCompetition = vi.fn();
const unpublishCompetition = vi.fn();
vi.mock("@/server/actions/competitions", () => ({
  createCompetition: (...args: unknown[]) => createCompetition(...args),
  updateCompetition: (...args: unknown[]) => updateCompetition(...args),
  publishCompetition: (...args: unknown[]) => publishCompetition(...args),
  unpublishCompetition: (...args: unknown[]) => unpublishCompetition(...args),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

function filledForm() {
  return { ...emptyCompetitionForm(), name: "黑客松", url: "https://example.com", signupDate: "2026-12-01" };
}

describe("CompetitionForm", () => {
  beforeEach(() => {
    createCompetition.mockReset();
    updateCompetition.mockReset();
    publishCompetition.mockReset();
    unpublishCompetition.mockReset();
    push.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  // Minor 2（controller ruling，fix round 1）：在 /new（還沒有 competitionId）按「發布」，
  // 存草稿那一步成功、但緊接著的發布失敗——不能留在 /new（使用者可能誤以為整個都沒存到，
  // 再按一次「發布」用同一份表單內容建出重複的草稿）。應該導去剛剛建出來的草稿的編輯頁，
  // 並把錯誤訊息一起帶過去（用查詢字串），不是留在原地顯示錯誤。
  it("/new：存草稿成功但發布失敗，導去 /competitions/{id}/edit 並帶著錯誤訊息，不留在原地", async () => {
    createCompetition.mockResolvedValue({ ok: true, id: "new-id" });
    publishCompetition.mockRejectedValue(new Error("發布失敗：某種資料庫錯誤"));

    render(<CompetitionForm initial={filledForm()} />);
    fireEvent.click(screen.getByRole("button", { name: "發布" }));

    await waitFor(() => expect(publishCompetition).toHaveBeenCalledWith("new-id"));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        `/competitions/new-id/edit?publishError=${encodeURIComponent("發布失敗：某種資料庫錯誤")}`
      )
    );
    // 不會留在 /new 顯示錯誤——沒有呼叫 push("/competitions") 也沒有停在原地顯示文字。
    expect(push).not.toHaveBeenCalledWith("/competitions");
  });

  it("編輯既有草稿：存草稿成功但發布失敗，停在原地顯示錯誤（不會重複建立，因為已經有 competitionId）", async () => {
    updateCompetition.mockResolvedValue({ ok: true });
    publishCompetition.mockRejectedValue(new Error("發布失敗"));

    render(<CompetitionForm competitionId="existing-id" initial={filledForm()} />);
    fireEvent.click(screen.getByRole("button", { name: "發布" }));

    await waitFor(() => expect(screen.getByText("發布失敗")).toBeTruthy());
    expect(createCompetition).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("initialError：編輯頁帶著查詢字串裡的發布錯誤，一開始就顯示出來", () => {
    render(<CompetitionForm competitionId="existing-id" initial={filledForm()} initialError="發布失敗：某種資料庫錯誤" />);
    expect(screen.getByText("發布失敗：某種資料庫錯誤")).toBeTruthy();
  });

  // Minor 3：已發布的卡片，「存草稿」按鈕改標成「儲存」（因為按下去不會把狀態改回草稿），
  // 旁邊另外有明確的「取消發布」按鈕才會真的呼叫 unpublishCompetition。
  it("狀態是 published 時，左邊按鈕顯示「儲存」，右邊是「取消發布」", () => {
    render(<CompetitionForm competitionId="existing-id" initial={filledForm()} status="published" />);
    expect(screen.getByRole("button", { name: "儲存" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消發布" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "存草稿" })).toBeNull();
  });

  it("狀態是 draft（或新增）時，左邊按鈕顯示「存草稿」，右邊是「發布」", () => {
    render(<CompetitionForm competitionId="existing-id" initial={filledForm()} status="draft" />);
    expect(screen.getByRole("button", { name: "存草稿" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "發布" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "儲存" })).toBeNull();
  });

  it("按「取消發布」呼叫 unpublishCompetition，不是 updateCompetition", async () => {
    unpublishCompetition.mockResolvedValue({ ok: true });
    render(<CompetitionForm competitionId="existing-id" initial={filledForm()} status="published" />);

    fireEvent.click(screen.getByRole("button", { name: "取消發布" }));

    await waitFor(() => expect(unpublishCompetition).toHaveBeenCalledWith("existing-id"));
    expect(updateCompetition).not.toHaveBeenCalled();
  });

  it("7 個標籤可多選：勾選後儲存時帶著選到的標籤", async () => {
    createCompetition.mockResolvedValue({ ok: true, id: "new-id" });
    render(<CompetitionForm initial={filledForm()} />);

    for (const tag of ["企業出題", "企劃提案", "創業", "金融科技", "ESG", "行銷", "數據分析"]) {
      expect(screen.getByRole("checkbox", { name: tag })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole("checkbox", { name: "ESG" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "創業" }));
    fireEvent.click(screen.getByRole("button", { name: "存草稿" }));

    await waitFor(() => expect(createCompetition).toHaveBeenCalled());
    const sentInput = createCompetition.mock.calls[0][0];
    expect(sentInput.tags).toEqual(expect.arrayContaining(["ESG", "創業"]));
    expect(sentInput.tags).toHaveLength(2);
  });

  it("幹部推薦是開關：切換後儲存時帶著 true", async () => {
    createCompetition.mockResolvedValue({ ok: true, id: "new-id" });
    render(<CompetitionForm initial={filledForm()} />);

    const toggle = screen.getByRole("switch", { name: "幹部推薦" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "存草稿" }));
    await waitFor(() => expect(createCompetition).toHaveBeenCalled());
    expect(createCompetition.mock.calls[0][0].recommended).toBe(true);
  });

  it("說明會有日期＋時間兩格", () => {
    render(<CompetitionForm initial={filledForm()} />);
    expect(screen.getByLabelText("說明會日期")).toBeTruthy();
    expect(screen.getByLabelText("說明會時間")).toBeTruthy();
  });

  it("字數超過時錯誤訊息出現在該欄下方（幹部備註 501 字）", async () => {
    createCompetition.mockResolvedValue({
      ok: false,
      errors: { staffNote: "幹部備註最多 500 字" },
    });
    render(<CompetitionForm initial={filledForm()} />);

    fireEvent.click(screen.getByRole("button", { name: "存草稿" }));

    await waitFor(() => expect(screen.getByText("幹部備註最多 500 字")).toBeTruthy());
  });
});
