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
      options: {
        redirectTo: `${location.origin}/auth/callback`,
        queryParams: { hd: "g.nccu.edu.tw", prompt: "select_account" },
      },
    });
  }

  return (
    <Button size="lg" className="h-11 w-full text-base" onClick={handleLogin}>
      用學校 Google 帳號登入
    </Button>
  );
}
