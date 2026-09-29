import type { Role } from "./roster-csv";
import { identityLabel, orderRows } from "./access";

// 管理員頁「成員」區塊（Task 5）：名單一列＝一個身份；畫面以「人」（信箱）為單位顯示。

export type MemberListRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  groupName: string | null;
  studentId: string | null;
  deptYear: string | null;
  leftAt: string | null;
};

export type PersonIdentity = { memberId: string; role: Role; label: string; left: boolean };
export type Person = {
  email: string;
  name: string;
  studentId: string | null;
  deptYear: string | null;
  identities: PersonIdentity[];
  // 所有身份都已離開
  allLeft: boolean;
};

export function groupPeople(rows: MemberListRow[]): Person[] {
  const byEmail = new Map<string, MemberListRow[]>();
  for (const r of rows) byEmail.set(r.email, [...(byEmail.get(r.email) ?? []), r]);

  const people: Person[] = [...byEmail.entries()].map(([email, list]) => {
    // 姓名／學號／系級以還在的身份為準（新增時只跟還在的身份比一致性，已離開的列可能是舊資料）。
    const profile = list.find((r) => !r.leftAt) ?? list[0];
    return {
      email,
      name: profile.name,
      studentId: profile.studentId,
      deptYear: profile.deptYear,
      identities: orderRows(list).map((r) => ({ memberId: r.id, role: r.role, label: identityLabel(r.role, r.groupName), left: !!r.leftAt })),
      allLeft: list.every((r) => !!r.leftAt),
    };
  });
  return people.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true }) || a.email.localeCompare(b.email));
}

// query：姓名或學號部分符合。showLeft 為 false（預設）時，已離開的身份不顯示，全部離開的人整列不顯示。
export function filterPeople(people: Person[], query: string, showLeft: boolean): Person[] {
  const q = query.trim().toLowerCase();
  return people
    .map((p) => (showLeft ? p : { ...p, identities: p.identities.filter((i) => !i.left) }))
    .filter((p) => p.identities.length > 0)
    .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.studentId ?? "").toLowerCase().includes(q));
}
