import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { signOut } from "@/server/actions/auth";

// 用 <form action={serverAction}>：不需要 client JS 也能登出，按下去由伺服器清 cookie 再導去 /login。
export function SignOutButton({ className, variant = "ghost" }: { className?: string; variant?: "ghost" | "link" | "outline" }) {
  return (
    <form action={signOut} className={cn("contents", className)}>
      <Button type="submit" variant={variant} size="sm" className="h-9 px-3 text-sm">
        登出
      </Button>
    </form>
  );
}
