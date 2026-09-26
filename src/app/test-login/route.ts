import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { createServerSupabase, createServiceSupabase } from "@/server/supabase";
import { assertLocalSupabaseUrl } from "@/server/local-only";

// 本機測試專用密碼，只在 ENABLE_TEST_LOGIN=true（本機／CI，VERCEL!=1）時才會用到。
// 與 tests/integration/helpers.ts 的 TEST_PASSWORD 保持一致，方便 e2e 用同一批帳號登入。
const TEST_PASSWORD = "local-test-password-only!";

export async function GET(req: NextRequest) {
  if (!env.enableTestLogin) {
    return new Response(null, { status: 404 });
  }

  try {
    assertLocalSupabaseUrl(env.supabaseUrl);
  } catch {
    // 就算不小心在非本機環境把 ENABLE_TEST_LOGIN 開起來，只要連的不是本機 Supabase 就一律 404。
    return new Response(null, { status: 404 });
  }

  const email = req.nextUrl.searchParams.get("email");
  if (!email) {
    return new Response("缺少 email 參數", { status: 400 });
  }

  const service = createServiceSupabase();
  const { error: createError } = await service.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (createError && !createError.message.includes("already been registered")) {
    return new Response(createError.message, { status: 500 });
  }

  const supabase = await createServerSupabase();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (signInError) {
    return new Response(signInError.message, { status: 500 });
  }

  return NextResponse.redirect(new URL("/", req.url));
}
