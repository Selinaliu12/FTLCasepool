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
