"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/server/supabase";

// 登出：清掉 Supabase session cookie，回登入頁。沒登入時呼叫也無害（signOut 對沒有 session 是 no-op），
// 所以 /not-in-roster 這種公開頁面也能放同一顆按鈕。
export async function signOut(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
