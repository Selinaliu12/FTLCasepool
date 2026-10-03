import { describe, it, expect } from "vitest";
import { validateMemberRow, memberFormError, sameProfile, type MemberRowInput } from "./roster-csv";
import { parseRosterCsv } from "./roster-csv";

// Task 5：名單 CSV 的「單列」規則抽出來給單一成員表單共用。表單的錯誤文字照 Global Constraints
// （沒有「第 N 列：」前綴）；CSV 維持原本帶列號的訊息。

const base: MemberRowInput = {
  email: "a@g.nccu.edu.tw",
  name: "王小明",
  role: "專案生",
  studentId: "110701001",
  deptYear: "資科三",
  group: "第1組",
};

function formMessage(input: MemberRowInput): string | null {
  const r = validateMemberRow(input);
  return r.ok ? null : memberFormError(r.error);
}

describe("validateMemberRow（表單用 Global Constraints 文字）", () => {
  it("合法的專案生：email 轉小寫、去空白，空白學號／系級存成 null", () => {
    expect(validateMemberRow({ ...base, email: "  A@G.NCCU.edu.tw ", name: " 王小明 ", studentId: " ", deptYear: "" })).toEqual({
      ok: true,
      value: { email: "a@g.nccu.edu.tw", name: "王小明", role: "student", studentId: null, deptYear: null, group: "第1組" },
    });
  });

  it("合法的幹部：組別是 null", () => {
    const r = validateMemberRow({ ...base, role: "其他幹部", group: "" });
    expect(r.ok && r.value).toMatchObject({ role: "officer", group: null });
  });

  it("信箱格式不對 → email 格式不正確", () => {
    expect(formMessage({ ...base, email: "a@gmail" })).toBe("email 格式不正確");
    expect(formMessage({ ...base, email: "a b@x.com" })).toBe("email 格式不正確");
  });

  it("校外信箱可以（§17-18）", () => {
    expect(validateMemberRow({ ...base, email: "A@Gmail.com" })).toMatchObject({ ok: true, value: { email: "a@gmail.com" } });
  });

  it("幹部填了組別 → 幹部不能填組別", () => {
    expect(formMessage({ ...base, role: "專案幹部" })).toBe("幹部不能填組別");
    expect(formMessage({ ...base, role: "其他幹部" })).toBe("幹部不能填組別");
  });

  it("專案生沒填組別 → 專案生要選組別", () => {
    expect(formMessage({ ...base, group: " " })).toBe("專案生要選組別");
  });

  it("姓名空白、角色不合法也會擋", () => {
    expect(formMessage({ ...base, name: "  " })).toBe("姓名不能空白");
    expect(formMessage({ ...base, role: "組長" })).toBe("角色要選專案幹部、其他幹部或專案生");
  });
});

describe("sameProfile（同一信箱的姓名／學號／系級要一致）", () => {
  it("三個欄位都一樣才算一致（null 與 null 相等）", () => {
    const p = { name: "王小明", studentId: "1", deptYear: null };
    expect(sameProfile(p, { name: "王小明", studentId: "1", deptYear: null })).toBe(true);
    expect(sameProfile(p, { name: "王大明", studentId: "1", deptYear: null })).toBe(false);
    expect(sameProfile(p, { name: "王小明", studentId: "2", deptYear: null })).toBe(false);
    expect(sameProfile(p, { name: "王小明", studentId: "1", deptYear: "資科三" })).toBe(false);
  });
});

describe("CSV 與表單用同一套規則", () => {
  const HEADER = "email,姓名,角色,學號,系級,組別,專案名稱";
  const cases: MemberRowInput[] = [
    base,
    { ...base, email: "a@gmail.com" },
    { ...base, role: "專案幹部" },
    { ...base, role: "其他幹部", group: "" },
    { ...base, group: "" },
    { ...base, name: "" },
    { ...base, role: "組長" },
  ];
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))("%s：CSV 與表單同樣通過／同樣被擋", (_label, c) => {
    const csv = parseRosterCsv(`${HEADER}\n${c.email},${c.name},${c.role},${c.studentId},${c.deptYear},${c.group},`);
    expect(csv.ok).toBe(validateMemberRow(c).ok);
  });

  it("CSV 的錯誤訊息保留「第 N 列：」前綴", () => {
    const csv = parseRosterCsv(`${HEADER}\nnot-an-email,王小明,專案生,,,第1組,`);
    expect(csv).toEqual({ ok: false, errors: ["第 2 列：email 格式不正確"] });
  });
});
