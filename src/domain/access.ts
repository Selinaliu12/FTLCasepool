import type { Role } from "./roster-csv";

export type Member = { id: string; semesterId: string; email: string; name: string; role: Role; groupId: string | null };

export type Access =
  | { kind: "wrong_domain" }
  | { kind: "no_semester"; isAdmin: boolean }
  | { kind: "not_in_roster" }
  | { kind: "ok"; email: string; isAdmin: boolean; member: Member | null; semesterId: string };

export function parseAdminEmails(raw: string): string[] {
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// 全域規則「只接受 Google 帳號」：JWT 的 app_metadata.provider 必須是 google。
// 唯一例外是本機／CI 的 test-login（env.enableTestLogin），那些帳號是用 email+password 建立的。
export function isTrustedProvider(provider: string | undefined, enableTestLogin: boolean): boolean {
  return provider === "google" || enableTestLogin;
}

export function resolveAccess(
  rawEmail: string,
  ctx: { adminEmails: string[]; semesterId: string | null; member: Member | null }
): Access {
  const email = rawEmail.trim().toLowerCase();
  if (!email.endsWith("@g.nccu.edu.tw")) return { kind: "wrong_domain" };
  const isAdmin = ctx.adminEmails.includes(email);
  if (!ctx.semesterId) return { kind: "no_semester", isAdmin };
  if (!ctx.member && !isAdmin) return { kind: "not_in_roster" };
  return { kind: "ok", email, isAdmin, member: ctx.member, semesterId: ctx.semesterId };
}
