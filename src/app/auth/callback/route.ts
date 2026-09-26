import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/server/supabase";
import { getAccess } from "@/server/session";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createServerSupabase();
    await supabase.auth.exchangeCodeForSession(code);
  }

  const access = await getAccess();
  let dest = "/login?error=domain";
  if (access.kind === "ok") {
    if (access.isAdmin) dest = "/admin";
    else if (access.member?.role === "pm" || access.member?.role === "officer") dest = "/dashboard";
    else dest = "/my-group";
  } else if (access.kind === "not_in_roster") {
    dest = "/not-in-roster";
  } else if (access.kind === "no_semester") {
    dest = access.isAdmin ? "/admin" : "/not-in-roster?reason=no_semester";
  }

  return NextResponse.redirect(new URL(dest, req.url));
}
