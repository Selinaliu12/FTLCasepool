import { describe, it, expect } from "vitest";
import { parseRosterCsv } from "./roster-csv";

const HEADER = "email,姓名,角色,學號,系級,組別,專案名稱";

describe("parseRosterCsv", () => {
  it("讀出專案生、專案幹部、其他幹部", () => {
    const r = parseRosterCsv(
      [
        HEADER,
        "a@g.nccu.edu.tw,王小明,專案生,110701001,資科三,第1組,智慧記帳",
        "p@g.nccu.edu.tw,陳幹部,專案幹部,,,,",
        "o@g.nccu.edu.tw,林公關,其他幹部,,,,",
      ].join("\n")
    );
    expect(r).toEqual({
      ok: true,
      rows: [
        { email: "a@g.nccu.edu.tw", name: "王小明", role: "student", studentId: "110701001", deptYear: "資科三", group: "第1組", projectName: "智慧記帳" },
        { email: "p@g.nccu.edu.tw", name: "陳幹部", role: "pm", studentId: null, deptYear: null, group: null, projectName: null },
        { email: "o@g.nccu.edu.tw", name: "林公關", role: "officer", studentId: null, deptYear: null, group: null, projectName: null },
      ],
    });
  });

  it("Excel 存出來的檔案（BOM、大寫、空白）也能讀，email 一律轉小寫", () => {
    const r = parseRosterCsv(
      "﻿" + HEADER + "\n  A.Wang@G.NCCU.edu.tw , 王小明 ,專案生, 110701001 , 資科三 , 第1組 ,智慧記帳\r\n"
    );
    expect(r.ok && r.rows[0]).toEqual({
      email: "a.wang@g.nccu.edu.tw",
      name: "王小明",
      role: "student",
      studentId: "110701001",
      deptYear: "資科三",
      group: "第1組",
      projectName: "智慧記帳",
    });
  });

  it("學號、系級可以留白", () => {
    const r = parseRosterCsv([HEADER, "a@g.nccu.edu.tw,王小明,專案生,,,第1組,智慧記帳"].join("\n"));
    expect(r.ok && r.rows[0]).toEqual({
      email: "a@g.nccu.edu.tw",
      name: "王小明",
      role: "student",
      studentId: null,
      deptYear: null,
      group: "第1組",
      projectName: "智慧記帳",
    });
  });

  it("標題少了學號、系級（舊格式），回清楚錯誤", () => {
    expect(parseRosterCsv("email,姓名,角色,組別,專案名稱\na@g.nccu.edu.tw,王,專案生,第1組,X")).toEqual({
      ok: false,
      errors: ["缺少欄位：學號、系級"],
    });
  });

  it("標題完全不對，列出所有缺少的欄位", () => {
    expect(parseRosterCsv("email,姓名,角色\na@g.nccu.edu.tw,王,專案生")).toEqual({
      ok: false,
      errors: ["缺少欄位：學號、系級、組別、專案名稱"],
    });
  });

  it("一次列出所有有問題的列", () => {
    const r = parseRosterCsv(
      [
        HEADER,
        "a@gmail,甲,專案生,,,第1組,X",
        "b@g.nccu.edu.tw,乙,專案生,,,,",
        "c@g.nccu.edu.tw,丙,專案生,,,第1組,X",
        "C@g.nccu.edu.tw,丙二,專案生,,,第2組,Y",
        "d@g.nccu.edu.tw,丁,專案生,,,第1組,Z",
      ].join("\n")
    );
    expect(r).toEqual({
      ok: false,
      errors: [
        "第 2 列：email 格式不正確",
        "第 3 列：專案生一定要填組別",
        "第 5 列：同一個信箱的姓名／學號／系級要一致（和第 4 列不同）",
        "第 6 列：第1組的專案名稱和前面不一致（X／Z）",
      ],
    });
  });

  it("幹部填了組別會出錯", () => {
    const r = parseRosterCsv([HEADER, "o@g.nccu.edu.tw,林公關,其他幹部,,,第1組,"].join("\n"));
    expect(r).toEqual({
      ok: false,
      errors: ["第 2 列：幹部不屬於任何一組，組別請留空"],
    });
  });

  // 最終審查 M11：姓名空白會讓頁首、組頁「最近回報」、看板都變成空字串。
  it("姓名空白（或只有空格）→ 第 N 列：姓名不能空白", () => {
    const r = parseRosterCsv(
      [HEADER, "a@g.nccu.edu.tw,,專案生,,,第1組,智慧記帳", "p@g.nccu.edu.tw,   ,專案幹部,,,,"].join("\n")
    );
    expect(r).toEqual({ ok: false, errors: ["第 2 列：姓名不能空白", "第 3 列：姓名不能空白"] });
  });

  // §14：同一個人可以同時在多組有專案生身份（也可以身兼幹部），只要每一列的姓名／學號／系級一致。
  it("同一信箱可以出現在多組（多列身份），姓名學號系級一致就放行", () => {
    const r = parseRosterCsv(
      [
        HEADER,
        "a@g.nccu.edu.tw,王小明,專案生,110701001,資科三,第1組,智慧記帳",
        "a@g.nccu.edu.tw,王小明,專案生,110701001,資科三,第2組,理財機器人",
        "a@g.nccu.edu.tw,王小明,專案幹部,110701001,資科三,,",
      ].join("\n")
    );
    expect(r).toEqual({
      ok: true,
      rows: [
        { email: "a@g.nccu.edu.tw", name: "王小明", role: "student", studentId: "110701001", deptYear: "資科三", group: "第1組", projectName: "智慧記帳" },
        { email: "a@g.nccu.edu.tw", name: "王小明", role: "student", studentId: "110701001", deptYear: "資科三", group: "第2組", projectName: "理財機器人" },
        { email: "a@g.nccu.edu.tw", name: "王小明", role: "pm", studentId: "110701001", deptYear: "資科三", group: null, projectName: null },
      ],
    });
  });

  it("同一信箱姓名不一致 → 第 N 列：同一個信箱的姓名／學號／系級要一致（和第 M 列不同）", () => {
    const r = parseRosterCsv(
      [
        HEADER,
        "a@g.nccu.edu.tw,王小明,專案生,110701001,資科三,第1組,智慧記帳",
        "a@g.nccu.edu.tw,王小明二,專案生,110701001,資科三,第2組,理財機器人",
      ].join("\n")
    );
    expect(r).toEqual({
      ok: false,
      errors: ["第 3 列：同一個信箱的姓名／學號／系級要一致（和第 2 列不同）"],
    });
  });

  it("同一信箱學號不一致 → 同一種錯誤訊息", () => {
    const r = parseRosterCsv(
      [
        HEADER,
        "a@g.nccu.edu.tw,王小明,專案生,110701001,資科三,第1組,智慧記帳",
        "a@g.nccu.edu.tw,王小明,專案生,110701002,資科三,第2組,理財機器人",
      ].join("\n")
    );
    expect(r).toEqual({
      ok: false,
      errors: ["第 3 列：同一個信箱的姓名／學號／系級要一致（和第 2 列不同）"],
    });
  });

  it("同一信箱系級不一致 → 同一種錯誤訊息", () => {
    const r = parseRosterCsv(
      [
        HEADER,
        "a@g.nccu.edu.tw,王小明,專案生,110701001,資科三,第1組,智慧記帳",
        "a@g.nccu.edu.tw,王小明,專案生,110701001,資科四,第2組,理財機器人",
      ].join("\n")
    );
    expect(r).toEqual({
      ok: false,
      errors: ["第 3 列：同一個信箱的姓名／學號／系級要一致（和第 2 列不同）"],
    });
  });

  it("完全重複的身份（同信箱、同角色、同組）→ 第 N 列：和第 M 列是同一個身份", () => {
    const r = parseRosterCsv(
      [
        HEADER,
        "a@g.nccu.edu.tw,王小明,專案生,110701001,資科三,第1組,智慧記帳",
        "a@g.nccu.edu.tw,王小明,專案生,110701001,資科三,第1組,智慧記帳",
      ].join("\n")
    );
    expect(r).toEqual({
      ok: false,
      errors: ["第 3 列：和第 2 列是同一個身份"],
    });
  });

  it("同一組的專案名稱可以全部空白", () => {
    const r = parseRosterCsv(
      [
        HEADER,
        "a@g.nccu.edu.tw,王小明,專案生,,,第1組,",
        "b@g.nccu.edu.tw,李小華,專案生,,,第1組,",
      ].join("\n")
    );
    expect(r.ok).toBe(true);
  });

  it("同一組專案名稱一填一空不算不一致", () => {
    const r = parseRosterCsv(
      [
        HEADER,
        "a@g.nccu.edu.tw,王小明,專案生,,,第1組,智慧記帳",
        "b@g.nccu.edu.tw,李小華,專案生,,,第1組,",
      ].join("\n")
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.rows[1].projectName).toBeNull();
  });
});
