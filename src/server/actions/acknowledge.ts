"use server";

import { redirect } from "next/navigation";
import { getAccess } from "@/server/session";
import { createServiceSupabase } from "@/server/supabase";

// 每學期第一次登入要按過「我已了解」（規格 4.2）才能用系統。這裡只接受 kind "ok"：
// wrong_domain／not_in_roster 沒有帳號可以承認；no_semester 沒有學期可以承認。
export async function acknowledge(): Promise<void> {
  const access = await getAccess();
  if (access.kind !== "ok") {
    throw new Error("只有正式使用者才需要按「我已了解」");
  }

  const db = createServiceSupabase();
  // 用 ignoreDuplicates（on conflict do nothing）而不是一般 upsert（會 merge／更新）：
  // 按第二次一定不能改到第一次留下的 acknowledged_at，也不能多出第二筆。
  const { error } = await db
    .from("acknowledgements")
    .upsert({ semester_id: access.semesterId, email: access.email }, { onConflict: "semester_id,email", ignoreDuplicates: true });
  if (error) throw error;

  redirect("/");
}

export async function hasAcknowledged(semesterId: string, email: string): Promise<boolean> {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("acknowledgements")
    .select("semester_id")
    .eq("semester_id", semesterId)
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}
