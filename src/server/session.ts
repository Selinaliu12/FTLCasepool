import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase, createServiceSupabase } from "./supabase";
import { env } from "./env";
import { cookies } from "next/headers";
import {
  parseAdminEmails,
  resolveAccess,
  isTrustedProvider,
  IDENTITY_COOKIE,
  type Access,
  type RosterRow,
} from "@/domain/access";

// cache()：同一個 RSC 請求裡 layout、頁面、查詢各自呼叫 getAccess()，只真的查一次 Supabase
// （getUser＋當前學期＋名單）。cache 的範圍是單一請求，不會跨使用者、跨請求共用結果。
export const getAccess = cache(async function getAccess(): Promise<Access> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  const rawEmail = data.user?.email;
  const adminEmails = parseAdminEmails(env.adminEmails);

  if (!rawEmail) {
    // 沒有登入的使用者也走同一套 resolveAccess，用一個不可能符合網域的空字串觸發 wrong_domain。
    return resolveAccess("", { adminEmails, semesterId: null, rows: [], preferred: null });
  }

  // 全域規則「只接受 Google 帳號」：就算 email 網域對、就算名單上有這個人，
  // provider 不是 google 一律當成 wrong_domain（本機測試登入例外）。
  const provider = data.user?.app_metadata?.provider as string | undefined;
  if (!isTrustedProvider(provider, env.enableTestLogin)) {
    return { kind: "wrong_domain" };
  }

  const service = createServiceSupabase();
  const email = rawEmail.trim().toLowerCase();

  const { data: semester } = await service.from("semesters").select("id").eq("is_current", true).maybeSingle();
  const semesterId = semester?.id ?? null;

  const rows: RosterRow[] = semesterId ? await loadRosterRows(service, semesterId, email) : [];
  const store = await cookies();
  const preferred = store.get(IDENTITY_COOKIE)?.value ?? null;

  return resolveAccess(email, { adminEmails, semesterId, rows, preferred });
});

export async function requireOk(): Promise<Extract<Access, { kind: "ok" } | { kind: "no_semester" }>> {
  const access = await getAccess();
  if (access.kind === "ok") return access;

  if (access.kind === "wrong_domain") {
    const supabase = await createServerSupabase();
    await supabase.auth.signOut();
    redirect("/login?error=domain");
  }
  if (access.kind === "not_in_roster") {
    redirect("/not-in-roster");
  }
  // no_semester：其他人看到「本學期尚未開放」（沿用 /not-in-roster 頁，用 reason 區分文案）。
  // 管理員則直接把 access 交回去，由呼叫者（/admin 自己）決定畫面：/admin 也在 (app) 底下、
  // 也會經過這個檢查，如果這裡硬導去 /admin 會變成對自己重導向，造成無限迴圈
  // （ERR_TOO_MANY_REDIRECTS）。/admin/page.tsx 在 semesterId 是 null 時只顯示「建立學期」卡片，
  // 其他頁面（RootPage）看到 isAdmin 會自己導去 /admin。
  if (!access.isAdmin) redirect("/not-in-roster?reason=no_semester");
  return access;
}

// 這個 email 在這學期的所有名單列（多重身份，規格 §14 第 2 點），連同組名（身份標籤「第N組專案生」
// 與排序要用）。用 service client：這時候還沒決定使用者是誰，不能靠 RLS。
export async function loadRosterRows(
  service: ReturnType<typeof createServiceSupabase>,
  semesterId: string,
  email: string
): Promise<RosterRow[]> {
  const { data, error } = await service
    .from("members")
    .select("id, semester_id, email, name, role, group_id, groups!members_group_id_fkey(name)")
    .eq("semester_id", semesterId)
    .eq("email", email);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const group = row.groups as unknown as { name: string } | null;
    return {
      id: row.id as string,
      semesterId: row.semester_id as string,
      email: row.email as string,
      name: row.name as string,
      role: row.role as RosterRow["role"],
      groupId: (row.group_id as string | null) ?? null,
      groupName: group?.name ?? null,
    };
  });
}
