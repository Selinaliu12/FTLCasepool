import type { Role } from "./roster-csv";

// 名單上的一列（一個身份）。Task 2 之後同一個 email 在同一學期可以有好幾列：多組專案生、兼幹部。
// groupName 是 groups.name（例如「第1組」），用來組身份標籤與排序；幹部列是 null。
export type RosterRow = {
  id: string;
  semesterId: string;
  email: string;
  name: string;
  role: Role;
  groupId: string | null;
  groupName: string | null;
};

// 使用者可以切換的一個身份。memberId 是名單列的 id；「管理員」身份不在名單上，memberId 是 null。
export type IdentityRole = Role | "admin";
export type Identity = { memberId: string | null; role: IdentityRole; groupId: string | null; label: string };

// cookie ftl_identity 存的值：名單列 id，或管理員身份的固定字串 "admin"。
export const IDENTITY_COOKIE = "ftl_identity";
export const ADMIN_IDENTITY_ID = "admin";

export function identityId(identity: Identity): string {
  return identity.memberId ?? ADMIN_IDENTITY_ID;
}

export type Access =
  | { kind: "wrong_domain" }
  | { kind: "no_semester"; isAdmin: boolean }
  | { kind: "not_in_roster" }
  | {
      kind: "ok";
      email: string;
      // 名單上的姓名（同一信箱各列一致）；不在名單上的管理員是 null。
      name: string | null;
      // 所有身份（順序見 orderIdentities）；至少一個。
      identities: Identity[];
      // 目前身份：畫面與寫入動作都依這個判斷（資料庫讀取權限則是所有身份的聯集，見 RLS）。
      active: Identity;
      semesterId: string;
    };

export type OkAccess = Extract<Access, { kind: "ok" }>;
// 目前身份是「有組的專案生」時的 access（專案生才能做的動作用它窄化型別）。
export type StudentAccess = OkAccess & { active: Identity & { role: "student"; groupId: string } };

// 信箱格式（不限網域，§17-18）：名單 CSV、管理員頁、登入判斷共用；資料庫 members_email_check 是同一個規則。
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseAdminEmails(raw: string): string[] {
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// 全域規則「只接受 Google 帳號」：JWT 的 app_metadata.provider 必須是 google。
// 唯一例外是本機／CI 的 test-login（env.enableTestLogin），那些帳號是用 email+password 建立的。
export function isTrustedProvider(provider: string | undefined, enableTestLogin: boolean): boolean {
  return provider === "google" || enableTestLogin;
}

const ROLE_LABEL: Record<Exclude<Role, "student">, string> = { pm: "專案幹部", officer: "其他幹部" };
const ROLE_RANK: Record<Role, number> = { pm: 0, officer: 1, student: 2 };

// 身份顯示文字：`第N組專案生`／`專案幹部`／`其他幹部`（身份切換選單、管理員頁成員清單共用）。
export function identityLabel(role: Role, groupName: string | null): string {
  return role === "student" ? `${groupName ?? ""}專案生` : ROLE_LABEL[role];
}

function identityFromRow(row: RosterRow): Identity {
  return { memberId: row.id, role: row.role, groupId: row.groupId, label: identityLabel(row.role, row.groupName) };
}

// 「第一個合法身份」的順序（controller ruling）：管理員 → 專案幹部 → 其他幹部 → 專案生（組名自然
// 排序，第2組在第10組前面）。身份切換選單也照這個順序列。
export function orderRows<T extends { role: Role; groupName: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.role !== b.role) return ROLE_RANK[a.role] - ROLE_RANK[b.role];
    return (a.groupName ?? "").localeCompare(b.groupName ?? "", "zh-Hant", { numeric: true });
  });
}

export function resolveAccess(
  rawEmail: string,
  ctx: { adminEmails: string[]; semesterId: string | null; rows: RosterRow[]; preferred: string | null }
): Access {
  const email = rawEmail.trim().toLowerCase();
  // 不限網域（§17-16）；wrong_domain 現在只代表「不是合法信箱」或「不是 Google 登入」（session.ts）。
  if (!EMAIL_RE.test(email)) return { kind: "wrong_domain" };
  const isAdmin = ctx.adminEmails.includes(email);
  if (!ctx.semesterId) return { kind: "no_semester", isAdmin };
  if (ctx.rows.length === 0 && !isAdmin) return { kind: "not_in_roster" };

  const identities: Identity[] = [
    ...(isAdmin ? [{ memberId: null, role: "admin" as const, groupId: null, label: "管理員" }] : []),
    ...orderRows(ctx.rows).map(identityFromRow),
  ];
  // cookie 只是「偏好」：每次都對照這次查到的名單驗證，不在清單裡（被竄改、身份已被移除、別人的
  // id）就默默退回第一個合法身份，不報錯、不越權。
  const active = identities.find((i) => identityId(i) === ctx.preferred) ?? identities[0];
  return { kind: "ok", email, name: ctx.rows[0]?.name ?? null, identities, active, semesterId: ctx.semesterId };
}

// 各身份的首頁（switchIdentity 切換後導過去、/ 與登入後的落點）。
export function homeFor(identity: Identity): "/my-group" | "/dashboard" | "/admin" {
  if (identity.role === "admin") return "/admin";
  if (identity.role === "student") return "/my-group";
  return "/dashboard";
}

// 幹部＝管理員、專案幹部、其他幹部（規格第 3 節：新增、編輯、發布競賽）。明確白名單：之後如果
// 多了新角色，預設不算幹部（Task 3 fix F6）。新增競賽頁、requireStaff、isStaffOrAdmin 共用。
const STAFF_ROLES: ReadonlySet<IdentityRole> = new Set<IdentityRole>(["admin", "pm", "officer"]);
export function isStaffIdentity(identity: Identity): boolean {
  return STAFF_ROLES.has(identity.role);
}

// 目前身份是專案生時回傳它的組 id；其他身份回傳 null。所有「專案生才能做」的頁面與動作都用這個
// 取組別（寫入以目前身份為準，不是所有身份的聯集）。
export function activeStudentGroup(access: Access): string | null {
  if (access.kind !== "ok" || access.active.role !== "student") return null;
  return access.active.groupId;
}
