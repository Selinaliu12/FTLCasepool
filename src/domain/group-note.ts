// 組別備註（「訂題後的主題」，規格 §14 第 6 點）：選填，最多 200 字（Unicode code point，不是
// UTF-16 code unit），空白存成 null。updateGroupNote server action 與換組頁的字數計數器共用。
export const MAX_GROUP_NOTE_LENGTH = 200;

export type ValidateGroupNoteResult = { ok: true; note: string | null } | { ok: false; error: string };

export function validateGroupNote(raw: string): ValidateGroupNoteResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, note: null };
  if ([...trimmed].length > MAX_GROUP_NOTE_LENGTH) {
    return { ok: false, error: "備註最多 200 字" };
  }
  return { ok: true, note: trimmed };
}
