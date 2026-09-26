"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/server/session";
import { createServiceSupabase } from "@/server/supabase";
import { validateCheckin } from "@/domain/progress";
import type { Light } from "@/domain/lights";

const REJECTED = "只有專案生可以點燈號";

// 中間週點燈號：任何組員都可以點，不限交進度的那個人；沒有截止日，選填。跟 submitProgress
// 一樣，line_id／created_by 完全由伺服器根據 access 決定，呼叫端不能指定要寫進哪一條線，
// 所以天生不會有「幫別組點燈」這種攻擊面。
export async function submitCheckin(
  input: { light: Light | null; note?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await getAccess();
  if (access.kind !== "ok" || !access.member || access.member.role !== "student" || !access.member.groupId) {
    return { ok: false, error: REJECTED };
  }

  const note = input.note ?? "";
  const validation = validateCheckin({ light: input.light, note });
  if (!validation.ok) return { ok: false, error: validation.error };

  const db = createServiceSupabase();
  const { data: line, error: lineError } = await db
    .from("lines")
    .select("id")
    .eq("group_id", access.member.groupId)
    .eq("kind", "project")
    .single();
  if (lineError) throw lineError;

  const trimmedNote = note.trim();
  // 紅燈一定有非空白說明（上面 validateCheckin 已經擋過）；黃燈／綠燈沒填就存 null，
  // 不存空字串，跟 progress_reports 的慣例一致。
  const noteToStore = input.light !== "red" && trimmedNote === "" ? null : trimmedNote;

  const { error: insertError } = await db.from("checkins").insert({
    line_id: line.id,
    light: input.light,
    note: noteToStore,
    created_by: access.email,
  });
  if (insertError) throw insertError;

  revalidatePath("/my-group");
  return { ok: true };
}
