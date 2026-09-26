import Papa from "papaparse";

export type Role = "pm" | "officer" | "student";
export type RosterRow = { email: string; name: string; role: Role; group: string | null; projectName: string | null };
export type ParseResult = { ok: true; rows: RosterRow[] } | { ok: false; errors: string[] };

const ROLE: Record<string, Role> = { 專案幹部: "pm", 其他幹部: "officer", 專案生: "student" };
const COLS = ["email", "姓名", "角色", "組別", "專案名稱"] as const;

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
  const emailToLine = new Map<string, number>();
  const groupToProjectName = new Map<string, string | null>();

  parsed.data.forEach((raw, i) => {
    const line = i + 2;
    const v = (k: (typeof COLS)[number]) => (raw[k] ?? "").trim();
    const role = ROLE[v("角色")];
    if (!role) { errors.push(`第 ${line} 列：角色「${v("角色")}」不是 專案幹部／其他幹部／專案生`); return; }

    const rawEmail = v("email").toLowerCase();
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

    // Check student has group and project name
    if (role === "student" && (!group || !projectName)) {
      errors.push(`第 ${line} 列：專案生一定要填組別與專案名稱`);
      return;
    }

    // Check for duplicate email
    if (emailToLine.has(rawEmail)) {
      errors.push(`第 ${line} 列：email ${rawEmail} 和第 ${emailToLine.get(rawEmail)} 列重複`);
      return;
    }
    emailToLine.set(rawEmail, line);

    // Check officer has no group
    if ((role === "pm" || role === "officer") && group) {
      errors.push(`第 ${line} 列：幹部不屬於任何一組，組別請留空`);
      return;
    }

    // Check same group has same project name
    if (group && role === "student") {
      if (groupToProjectName.has(group)) {
        const prevProjectName = groupToProjectName.get(group)!;
        if (prevProjectName !== projectName) {
          errors.push(`第 ${line} 列：${group}的專案名稱和前面不一致（${prevProjectName}／${projectName}）`);
          return;
        }
      } else {
        groupToProjectName.set(group, projectName);
      }
    }

    rows.push({ email: rawEmail, name: v("姓名"), role, group, projectName });
  });
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}
