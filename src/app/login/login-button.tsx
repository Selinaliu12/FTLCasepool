"use client";

import { createBrowserClient } from "@supabase/ssr";
import { Button } from "@/components/ui/button";

export function LoginButton() {
  async function handleLogin() {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    await supabase.auth.signInWithOAuth({
      provider: "google",
      // 不限網域（§17-16）：任何 Google 帳號都能登入，名單上有這個信箱才放行（getAccess）。
      options: {
        redirectTo: `${location.origin}/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
    });
  }

  return (
    <Button size="lg" className="h-11 w-full text-base" onClick={handleLogin}>
      用 Google 帳號登入
    </Button>
  );
}
