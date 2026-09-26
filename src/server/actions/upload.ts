"use server";

import { getAccess } from "@/server/session";
import { createServiceSupabase } from "@/server/supabase";
import { validatePdfMeta } from "@/domain/pdf";
import { presignPdfPut } from "@/server/r2";

// 只有「登入成功（kind ok）且是專案生（role student）且有 groupId」的人可以拿到上傳網址：
// PM／其他幹部沒有 groupId 可以歸檔，wrong_domain／not_in_roster／no_semester 沒有正式帳號。
export async function requestPdfUpload(f: {
  name: string;
  type: string;
  size: number;
}): Promise<{ ok: true; key: string; url: string } | { ok: false; error: string }> {
  const access = await getAccess();
  if (access.kind !== "ok" || !access.member || access.member.role !== "student" || !access.member.groupId) {
    return { ok: false, error: "只有專案生可以上傳" };
  }

  const meta = validatePdfMeta(f);
  if (!meta.ok) return meta;

  const db = createServiceSupabase();
  const { data: semester, error } = await db
    .from("semesters")
    .select("name")
    .eq("id", access.semesterId)
    .single();
  if (error) throw error;

  const key = `${semester.name}/${access.member.groupId}/${crypto.randomUUID()}.pdf`;

  // 留一張票，記錄這把 key 是誰申請的：submitProgress() 之後只認「自己申請、還沒用過」的
  // key，防止有人拿別人（或自己更早）申請好的 key 去交別的期別、或在真正的擁有者交出去之後
  // 重放同一把 key（見 supabase/migrations/20260927000006_upload_tickets.sql）。
  const { error: ticketError } = await db
    .from("upload_tickets")
    .insert({ key, issuer_email: access.email });
  if (ticketError) throw ticketError;

  const url = await presignPdfPut(key, f.size);
  return { ok: true, key, url };
}
