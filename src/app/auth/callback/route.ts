import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/server/supabase";
import { getAccess } from "@/server/session";
import { homeFor } from "@/domain/access";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const supabase = await createServerSupabase();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL("/login?error=auth", req.url));
    }
  }

  const access = await getAccess();
  let dest = "/login?error=domain";
  if (access.kind === "ok") {
    // 登入後進上次用的身份（cookie ftl_identity，getAccess 已驗證過；沒有或不合法就是第一個）。
    dest = homeFor(access.active);
  } else if (access.kind === "not_in_roster") {
    dest = "/not-in-roster";
  } else if (access.kind === "no_semester") {
    dest = access.isAdmin ? "/admin" : "/not-in-roster?reason=no_semester";
  } else {
    // wrong_domain：跟 requireOk() 一樣，先登出再導去登入頁，避免留著一個不該被信任的 session。
    await supabase.auth.signOut();
  }

  return NextResponse.redirect(new URL(dest, req.url));
}
