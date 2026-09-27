// 比賽階段上傳 RPC（submit_stage／replace_stage_pdf／withdraw_stage）錯誤 → 回給組員的訊息。
//
// Final review minor 11：資料庫用 raise exception '<代碼>' 丟出的自訂錯誤，message 就是代碼本身，
// 一律精確比對——子字串比對會把 NOT_LOCKED 誤判成 LOCKED、把任何含 "ended" 的訊息誤判成比賽
// 已結束。23505 只有撞到這兩個限制才算「這個階段已經交了」（跟 progress.ts 只認
// progress_reports_line_id_period_id_key 同一個做法）：
//   - one_active_submission_per_stage：同一階段同時只能有一份待審／已通過
//   - stage_submissions_line_id_stage_version_key：同一階段版號重複（併發重交）
// 其他 23505（例如 pdf_key 撞到）代表這把 key 這次沒有真的拿去交，不刪物件，回上傳失敗。
export const STAGE_ERRORS = {
  notFound: "找不到這筆繳交",
  uploadFailed: "檔案沒有上傳成功，請重新選擇 PDF",
  locked: "已超過 2 小時，已鎖定不能修改",
  ended: "這場比賽已經結束，不能再上傳",
  stageActive: "這個階段已經交了，等審核結果或被退回後再重交",
  staleWrite: "這個階段的繳交剛剛被組員改過，請重新整理",
} as const;

type RpcError = { code?: string; message: string };
// deleteUpload：這次請求上傳的物件是不是孤兒（票務已經證明是呼叫者的、但沒有被用上），要刪。
export type MappedStageError = { error: string; deleteUpload: boolean };

const STAGE_UNIQUE_CONSTRAINTS = ["one_active_submission_per_stage", "stage_submissions_line_id_stage_version_key"];

function isStageUniqueViolation(err: RpcError): boolean {
  return err.code === "23505" && STAGE_UNIQUE_CONSTRAINTS.some((c) => err.message.includes(`"${c}"`));
}

export function mapSubmitStageError(err: RpcError): MappedStageError | null {
  if (err.message === "stage_active") return { error: STAGE_ERRORS.stageActive, deleteUpload: true };
  if (err.message === "ended") return { error: STAGE_ERRORS.ended, deleteUpload: true };
  if (isStageUniqueViolation(err)) return { error: STAGE_ERRORS.stageActive, deleteUpload: true };
  // 票被搶先用掉：這把 key 可能是別的併發請求真正用掉的那份，不刪。
  if (err.message === "invalid_ticket") return { error: STAGE_ERRORS.stageActive, deleteUpload: false };
  if (err.code === "23505") return { error: STAGE_ERRORS.uploadFailed, deleteUpload: false };
  return null;
}

export function mapReplaceStageError(err: RpcError): MappedStageError | null {
  if (err.message === "LOCKED") return { error: STAGE_ERRORS.locked, deleteUpload: true };
  if (err.message === "stale_write") return { error: STAGE_ERRORS.staleWrite, deleteUpload: true };
  if (err.message === "submission_not_found") return { error: STAGE_ERRORS.notFound, deleteUpload: true };
  if (err.message === "ended") return { error: STAGE_ERRORS.ended, deleteUpload: true };
  if (err.code === "23505" || err.message === "invalid_ticket") return { error: STAGE_ERRORS.uploadFailed, deleteUpload: false };
  return null;
}

export function mapWithdrawStageError(err: RpcError): string | null {
  if (err.message === "LOCKED") return STAGE_ERRORS.locked;
  if (err.message === "submission_not_found") return STAGE_ERRORS.notFound;
  return null;
}
