"use client";

import { createBrowserClient } from "@supabase/ssr";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function LoginPage() {
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
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card
        className="w-full max-w-sm gap-8 !py-8"
        style={{ boxShadow: "var(--card-shadow)" }}
      >
        <CardHeader className="px-8">
          <CardTitle className="text-center font-heading text-3xl font-bold text-foreground">
            FTL 競賽池
          </CardTitle>
        </CardHeader>
        <CardContent className="px-8">
          <Button size="lg" className="h-11 w-full text-base" onClick={handleLogin}>
            用學校 Google 帳號登入
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
