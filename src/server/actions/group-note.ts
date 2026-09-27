"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/server/session";
import { createServiceSupabase } from "@/server/supabase";
import { validateGroupNote } from "@/domain/group-note";

const REJECTED = "只有專案生可以修改組別備註";

// 組別備註：以「目前身份」判斷——任一屬於該組的專案生身份都可以改（規格 §14 第 6 點）。
// group_id 完全由伺服器依目前身份決定，呼叫端不能指定要改哪一組，天生不會有「幫別組改
// 備註」這種攻擊面。寫入走 update_group_note() SECURITY DEFINER 函式（只給 service_role），
// 姓名用 access.name（名單上的姓名，同一信箱各列一致）。
export async function updateGroupNote(note: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await getAccess();
  if (access.kind !== "ok" || access.active.role !== "student" || !access.active.groupId) {
    return { ok: false, error: REJECTED };
  }

  const validation = validateGroupNote(note);
  if (!validation.ok) return validation;

  const db = createServiceSupabase();
  const { error } = await db.rpc("update_group_note", {
    p_group_id: access.active.groupId,
    p_note: validation.note,
    p_updated_by: access.name ?? access.email,
  });
  if (error) throw error;

  revalidatePath("/dashboard");
  revalidatePath("/my-group");
  revalidatePath(`/groups/${access.active.groupId}`);
  return { ok: true };
}
