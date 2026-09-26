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
  const url = await presignPdfPut(key, f.size);
  return { ok: true, key, url };
}
