import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Link from "next/link";
import { LoginButton } from "./login-button";

// /auth/callback 與 requireOk() 失敗時會帶 ?error= 導回這裡；沒有這段文案時，使用者只會看到登入頁
// 「又出現一次」，不知道是帳號網域不對還是登入流程出錯。
const LOGIN_ERRORS: Record<string, string> = {
  domain: "請用 @g.nccu.edu.tw 學校帳號登入",
  auth: "登入失敗，請再試一次",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const { error } = await searchParams;
  const message = typeof error === "string" ? LOGIN_ERRORS[error] : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm gap-8 !py-8" style={{ boxShadow: "var(--card-shadow)" }}>
        <CardHeader className="px-8">
          <CardTitle className="text-center font-heading text-3xl font-bold text-foreground">FTL 競賽池</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-8">
          {message && (
            <Alert
              variant="destructive"
              className="rounded-[var(--r-sm,12px)] border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-[var(--danger)]"
            >
              <AlertDescription className="text-[var(--danger)]">{message}</AlertDescription>
            </Alert>
          )}
          <LoginButton />
          <Link href="/privacy" className="text-center text-sm text-muted-foreground underline underline-offset-4">
            隱私權說明
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
