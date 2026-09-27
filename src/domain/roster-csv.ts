import Papa from "papaparse";

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
    const role = ROLE[v("角色")];
    if (!role) { errors.push(`第 ${line} 列：角色「${v("角色")}」不是 專案幹部／其他幹部／專案生`); return; }

    const rawEmail = v("email").toLowerCase();
    const studentId = v("學號") || null;
    const deptYear = v("系級") || null;
    const group = v("組別") || null;
    const projectName = v("專案名稱") || null;

    // Check email domain
    if (!rawEmail.endsWith("@g.nccu.edu.tw")) {
      errors.push(`第 ${line} 列：email 必須是 @g.nccu.edu.tw`);
      return;
    }

    if (!v("姓名")) {
      errors.push(`第 ${line} 列：姓名不能空白`);
      return;
    }

    // Check student has group; officer must not have group
    if (role === "student" && !group) {
      errors.push(`第 ${line} 列：專案生一定要填組別`);
      return;
    }
    if ((role === "pm" || role === "officer") && group) {
      errors.push(`第 ${line} 列：幹部不屬於任何一組，組別請留空`);
      return;
    }

    // Check same email → same name/studentId/deptYear across rows
    const name = v("姓名");
    const prevIdentity = emailIdentity.get(rawEmail);
    if (prevIdentity) {
      if (prevIdentity.name !== name || prevIdentity.studentId !== studentId || prevIdentity.deptYear !== deptYear) {
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
