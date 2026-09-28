import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/server/supabase";

export const dynamic = "force-dynamic";

// 定時喚醒用（.github/workflows/keep-alive.yml）：真的查一次資料庫，Supabase 免費專案才不會
// 因為一週沒活動而暫停。只回 ok／失敗，不回任何資料；不用登入（見 middleware 的 PUBLIC）。
export async function GET() {
  const { error } = await createServiceSupabase().from("semesters").select("id", { head: true, count: "exact" });
  return NextResponse.json({ ok: !error }, { status: error ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
