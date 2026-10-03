import Papa from "papaparse";
import { EMAIL_RE } from "./access";

export type Role = "pm" | "officer" | "student";
export type RosterRow = {
  email: string;
  name: string;
  role: Role;
  studentId: string | null;
  deptYear: string | null;
  group: string | null;
  projectName: string | null;
};
export type ParseResult = { ok: true; rows: RosterRow[] } | { ok: false; errors: string[] };

const ROLE: Record<string, Role> = { 專案幹部: "pm", 其他幹部: "officer", 專案生: "student" };
const COLS = ["email", "姓名", "角色", "學號", "系級", "組別", "專案名稱"] as const;

// ---- 單列規則（CSV 與管理員頁的「新增成員」表單共用，Task 5） ----

// 表單／CSV 一列的原始輸入（都是字串，還沒去空白）。role 是中文角色名稱；group 是組名（CSV）或
// 組 id（表單），這裡只檢查有沒有填。
export type MemberRowInput = {
  email: string;
  name: string;
  role: string;
  studentId: string;
  deptYear: string;
  group: string;
};
export type MemberRowValue = {
  email: string;
  name: string;
  role: Role;
  studentId: string | null;
  deptYear: string | null;
  group: string | null;
};
export type MemberRowError = "role" | "email_domain" | "name_blank" | "group_required" | "group_forbidden";

export function validateMemberRow(input: MemberRowInput): { ok: true; value: MemberRowValue } | { ok: false; error: MemberRowError } {
  const role = ROLE[input.role.trim()];
  if (!role) return { ok: false, error: "role" };
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "email_domain" };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "name_blank" };
  const group = input.group.trim() || null;
  if (role === "student" && !group) return { ok: false, error: "group_required" };
  if (role !== "student" && group) return { ok: false, error: "group_forbidden" };
  return {
    ok: true,
    value: { email, name, role, studentId: input.studentId.trim() || null, deptYear: input.deptYear.trim() || null, group },
  };
}

// 單一成員表單的錯誤文字（Global Constraints，沒有列號前綴）。
const FORM_ERRORS: Record<MemberRowError, string> = {
  role: "角色要選專案幹部、其他幹部或專案生",
  email_domain: "email 格式不正確",
  name_blank: "姓名不能空白",
  group_required: "專案生要選組別",
  group_forbidden: "幹部不能填組別",
};
export function memberFormError(error: MemberRowError): string {
  return FORM_ERRORS[error];
}

// CSV 維持原本的訊息（呼叫端再加「第 N 列：」前綴）。
function csvError(error: MemberRowError, rawRole: string): string {
  switch (error) {
    case "role":
      return `角色「${rawRole}」不是 專案幹部／其他幹部／專案生`;
    case "email_domain":
      return "email 格式不正確";
    case "name_blank":
      return "姓名不能空白";
    case "group_required":
      return "專案生一定要填組別";
    case "group_forbidden":
      return "幹部不屬於任何一組，組別請留空";
  }
}

// 同一個信箱的姓名／學號／系級要一致（CSV 內各列之間、新增成員時與這個人還在的身份之間）。
export type MemberProfile = { name: string; studentId: string | null; deptYear: string | null };
export function sameProfile(a: MemberProfile, b: MemberProfile): boolean {
  return a.name === b.name && a.studentId === b.studentId && a.deptYear === b.deptYear;
}

export function parseRosterCsv(text: string): ParseResult {
  const cleanText = text.replace(/^﻿/, "");
  const parsed = Papa.parse<Record<string, string>>(cleanText, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });

  // Check for missing columns
  const fields = new Set(parsed.meta.fields || []);
  const missing: string[] = [];
  for (const col of COLS) {
    if (!fields.has(col)) {
      missing.push(col);
    }
  }
  if (missing.length > 0) {
    return { ok: false, errors: [`缺少欄位：${missing.join("、")}`] };
  }

  const errors: string[] = [];
  const rows: RosterRow[] = [];
  // 同一個 email 第一次出現時的（列號、姓名、學號、系級），用來檢查後面同 email 的列
  // 姓名／學號／系級是否一致（規格 §14：同一信箱多列時三者必須一致）。
  const emailIdentity = new Map<string, { line: number; name: string; studentId: string | null; deptYear: string | null }>();
  // 完全重複的身份（同信箱、同角色、同組）用 email+role+group 當 key。
  const identityToLine = new Map<string, number>();
  const groupToProjectName = new Map<string, string | null>();

  parsed.data.forEach((raw, i) => {
    const line = i + 2;
    const v = (k: (typeof COLS)[number]) => (raw[k] ?? "").trim();
    const checked = validateMemberRow({
      email: v("email"),
      name: v("姓名"),
      role: v("角色"),
      studentId: v("學號"),
      deptYear: v("系級"),
      group: v("組別"),
    });
    if (!checked.ok) {
      errors.push(`第 ${line} 列：${csvError(checked.error, v("角色"))}`);
      return;
    }
    const { email: rawEmail, name, role, studentId, deptYear, group } = checked.value;
    const projectName = v("專案名稱") || null;

    // Check same email → same name/studentId/deptYear across rows
    const prevIdentity = emailIdentity.get(rawEmail);
    if (prevIdentity) {
      if (!sameProfile(prevIdentity, { name, studentId, deptYear })) {
        errors.push(`第 ${line} 列：同一個信箱的姓名／學號／系級要一致（和第 ${prevIdentity.line} 列不同）`);
        return;
      }
    } else {
      emailIdentity.set(rawEmail, { line, name, studentId, deptYear });
    }

    // Check exact duplicate identity (same email, role, group)
    const identityKey = `${rawEmail}::${role}::${group ?? ""}`;
    const prevIdentityLine = identityToLine.get(identityKey);
    if (prevIdentityLine !== undefined) {
      errors.push(`第 ${line} 列：和第 ${prevIdentityLine} 列是同一個身份`);
      return;
    }
    identityToLine.set(identityKey, line);

    // Check same group has same project name (when filled in)
    if (group && role === "student" && projectName) {
      const prevProjectName = groupToProjectName.get(group);
      if (prevProjectName !== undefined) {
        if (prevProjectName !== null && prevProjectName !== projectName) {
          errors.push(`第 ${line} 列：${group}的專案名稱和前面不一致（${prevProjectName}／${projectName}）`);
          return;
        }
        if (prevProjectName === null) groupToProjectName.set(group, projectName);
      } else {
        groupToProjectName.set(group, projectName);
      }
    } else if (group && role === "student" && !groupToProjectName.has(group)) {
      groupToProjectName.set(group, null);
    }

    rows.push({ email: rawEmail, name, role, studentId, deptYear, group, projectName });
  });
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}
