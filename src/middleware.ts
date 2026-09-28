import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/auth/callback", "/not-in-roster", "/test-login", "/privacy"];

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const isPublic = PUBLIC.some((p) => req.nextUrl.pathname === p || req.nextUrl.pathname.startsWith(p + "/"));

  let hasUser = false;
  try {
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    });
    const { data, error } = await supabase.auth.getUser();
    hasUser = !error && !!data.user;
  } catch {
    // Supabase 無法連線（例如本機沒有跑 supabase start）：視為未登入，安全地擋到登入頁。
    hasUser = false;
  }

  if (!hasUser && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
