import { redirect } from "next/navigation";
import { createServerSupabase, createServiceSupabase } from "./supabase";
import { env } from "./env";
import { parseAdminEmails, resolveAccess, type Access, type Member } from "@/domain/access";

export async function getAccess(): Promise<Access> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  const rawEmail = data.user?.email;
  const adminEmails = parseAdminEmails(env.adminEmails);

  if (!rawEmail) {
    // 沒有登入的使用者也走同一套 resolveAccess，用一個不可能符合網域的空字串觸發 wrong_domain。
    return resolveAccess("", { adminEmails, semesterId: null, member: null });
  }

  const service = createServiceSupabase();
  const email = rawEmail.trim().toLowerCase();

  const { data: semester } = await service.from("semesters").select("id").eq("is_current", true).maybeSingle();
  const semesterId = semester?.id ?? null;

  let member: Member | null = null;
  if (semesterId) {
    const { data: row } = await service
      .from("members")
      .select("id, semester_id, email, name, role, group_id")
      .eq("semester_id", semesterId)
      .eq("email", email)
      .maybeSingle();
    if (row) {
      member = {
        id: row.id,
        semesterId: row.semester_id,
        email: row.email,
        name: row.name,
        role: row.role,
        groupId: row.group_id,
      };
    }
  }

  return resolveAccess(email, { adminEmails, semesterId, member });
}

export async function requireOk(): Promise<Extract<Access, { kind: "ok" }>> {
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
  // no_semester：管理員先進去 /admin 開學期；其他人看到「本學期尚未開放」（沿用 /not-in-roster 頁，用 reason 區分文案）。
  redirect(access.isAdmin ? "/admin" : "/not-in-roster?reason=no_semester");
}
