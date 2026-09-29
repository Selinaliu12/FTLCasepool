import { describe, it, expect } from "vitest";
import { groupPeople, filterPeople, type MemberListRow } from "./member-list";

const row = (over: Partial<MemberListRow>): MemberListRow => ({
  id: "x", email: "a@g.nccu.edu.tw", name: "王小明", role: "student", groupName: "第1組",
  studentId: "110701001", deptYear: "資科三", leftAt: null, ...over,
});

const rows: MemberListRow[] = [
  row({ id: "a-g10", groupName: "第10組" }),
  row({ id: "a-g2", groupName: "第2組" }),
  row({ id: "a-off", role: "officer", groupName: null }),
  row({ id: "b-pm", email: "b@g.nccu.edu.tw", name: "陳幹部", role: "pm", groupName: null, studentId: "109", deptYear: "企管四" }),
  row({ id: "c-left", email: "c@g.nccu.edu.tw", name: "林離開", groupName: "第1組", studentId: "111", leftAt: "2026-09-29T00:00:00Z" }),
  row({ id: "b-left", email: "b@g.nccu.edu.tw", name: "陳幹部", role: "student", groupName: "第3組", studentId: "109", deptYear: "企管四", leftAt: "2026-09-29T00:00:00Z" }),
];

describe("groupPeople", () => {
  it("每個人（信箱）一列、依姓名排序（筆畫），身份照 專案幹部 → 其他幹部 → 專案生（組名自然排序）", () => {
    const people = groupPeople(rows);
    expect(people.map((p) => p.email)).toEqual(["a@g.nccu.edu.tw", "c@g.nccu.edu.tw", "b@g.nccu.edu.tw"]);
    const a = people.find((p) => p.email === "a@g.nccu.edu.tw")!;
    expect(a).toMatchObject({ name: "王小明", studentId: "110701001", deptYear: "資科三", allLeft: false });
    expect(a.identities.map((i) => i.label)).toEqual(["其他幹部", "第2組專案生", "第10組專案生"]);
    const b = people.find((p) => p.email === "b@g.nccu.edu.tw")!;
    expect(b.identities).toEqual([
      { memberId: "b-pm", role: "pm", label: "專案幹部", left: false },
      { memberId: "b-left", role: "student", label: "第3組專案生", left: true },
    ]);
    expect(people.find((p) => p.email === "c@g.nccu.edu.tw")!.allLeft).toBe(true);
  });
});

describe("filterPeople", () => {
  const people = groupPeople(rows);

  it("預設隱藏已離開：全部離開的人不出現，部分離開的人只留還在的身份", () => {
    const shown = filterPeople(people, "", false);
    expect(shown.map((p) => p.email)).toEqual(["a@g.nccu.edu.tw", "b@g.nccu.edu.tw"]);
    expect(shown[1].identities.map((i) => i.label)).toEqual(["專案幹部"]);
  });

  it("顯示已離開：全部都在，已離開的身份標 left", () => {
    const shown = filterPeople(people, "", true);
    expect(shown).toHaveLength(3);
    expect(shown[2].identities.map((i) => i.left)).toEqual([false, true]);
  });

  it("用姓名或學號搜尋（部分符合、忽略頭尾空白）", () => {
    expect(filterPeople(people, " 小明 ", false).map((p) => p.name)).toEqual(["王小明"]);
    expect(filterPeople(people, "109", false).map((p) => p.name)).toEqual(["陳幹部"]);
    expect(filterPeople(people, "沒有這個人", true)).toEqual([]);
  });
});
