import { describe, it, expect } from "vitest";
import { mapSubmitStageError, mapReplaceStageError, mapWithdrawStageError, STAGE_ERRORS } from "./stage-errors";

// Final review minor 11：RPC 錯誤一律精確比對（raise exception '<代碼>' 的 message 就是代碼
// 本身），23505 只有撞到「同一階段同時只能有一份待審／已通過」（one_active_submission_per_stage）
// 或版號重複（stage_submissions_line_id_stage_version_key）才算「這個階段已經交了」。
describe("mapSubmitStageError", () => {
  it("精確的代碼：stage_active／ended／invalid_ticket", () => {
    expect(mapSubmitStageError({ message: "stage_active" })).toEqual({ error: STAGE_ERRORS.stageActive, deleteUpload: true });
    expect(mapSubmitStageError({ message: "ended" })).toEqual({ error: STAGE_ERRORS.ended, deleteUpload: true });
    expect(mapSubmitStageError({ message: "invalid_ticket" })).toEqual({ error: STAGE_ERRORS.stageActive, deleteUpload: false });
  });

  it("子字串不算：含有 ended／stage_active 字樣的其他錯誤不會被誤判", () => {
    expect(mapSubmitStageError({ message: 'relation "weekended" does not exist' })).toBeNull();
    expect(mapSubmitStageError({ message: "stage_active_extra" })).toBeNull();
  });

  it("23505 撞到階段的兩個限制 → 這個階段已經交了，刪掉上傳的物件", () => {
    for (const constraint of ["one_active_submission_per_stage", "stage_submissions_line_id_stage_version_key"]) {
      expect(
        mapSubmitStageError({ code: "23505", message: `duplicate key value violates unique constraint "${constraint}"` })
      ).toEqual({ error: STAGE_ERRORS.stageActive, deleteUpload: true });
    }
  });

  it("23505 撞到別的限制（例如 pdf_key）→ 上傳失敗，不刪物件", () => {
    expect(
      mapSubmitStageError({ code: "23505", message: 'duplicate key value violates unique constraint "stage_submissions_pdf_key_key"' })
    ).toEqual({ error: STAGE_ERRORS.uploadFailed, deleteUpload: false });
  });
});

describe("mapReplaceStageError", () => {
  it("精確的代碼", () => {
    expect(mapReplaceStageError({ message: "LOCKED" })).toEqual({ error: STAGE_ERRORS.locked, deleteUpload: true });
    expect(mapReplaceStageError({ message: "stale_write" })).toEqual({ error: STAGE_ERRORS.staleWrite, deleteUpload: true });
    expect(mapReplaceStageError({ message: "submission_not_found" })).toEqual({ error: STAGE_ERRORS.notFound, deleteUpload: true });
    expect(mapReplaceStageError({ message: "ended" })).toEqual({ error: STAGE_ERRORS.ended, deleteUpload: true });
    expect(mapReplaceStageError({ message: "invalid_ticket" })).toEqual({ error: STAGE_ERRORS.uploadFailed, deleteUpload: false });
    expect(mapReplaceStageError({ message: "NOT_LOCKED" })).toBeNull();
  });
});

describe("mapWithdrawStageError", () => {
  it("精確的代碼", () => {
    expect(mapWithdrawStageError({ message: "LOCKED" })).toBe(STAGE_ERRORS.locked);
    expect(mapWithdrawStageError({ message: "submission_not_found" })).toBe(STAGE_ERRORS.notFound);
    expect(mapWithdrawStageError({ message: "NOT_LOCKED" })).toBeNull();
  });
});
