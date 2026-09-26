import { describe, it, expect } from "vitest";
import { parseRosterCsv } from "./roster-csv";

const HEADER = "email,姓名,角色,組別,專案名稱";

describe("parseRosterCsv", () => {
  it("讀出專案生、專案幹部、其他幹部", () => {
    const r = parseRosterCsv(
      [
        HEADER,
        "a@g.nccu.edu.tw,王小明,專案生,第1組,智慧記帳",
        "p@g.nccu.edu.tw,陳幹部,專案幹部,,",
        "o@g.nccu.edu.tw,林公關,其他幹部,,",
      ].join("\n")
    );
    expect(r).toEqual({
      ok: true,
      rows: [
        { email: "a@g.nccu.edu.tw", name: "王小明", role: "student", group: "第1組", projectName: "智慧記帳" },
        { email: "p@g.nccu.edu.tw", name: "陳幹部", role: "pm", group: null, projectName: null },
        { email: "o@g.nccu.edu.tw", name: "林公關", role: "officer", group: null, projectName: null },
      ],
    });
  });

  it("Excel 存出來的檔案（BOM、大寫、空白）也能讀，email 一律轉小寫", () => {
    const r = parseRosterCsv("﻿" + HEADER + "\n  A.Wang@G.NCCU.edu.tw , 王小明 ,專案生, 第1組 ,智慧記帳\r\n");
    expect(r.ok && r.rows[0]).toEqual({ email: "a.wang@g.nccu.edu.tw", name: "王小明", role: "student", group: "第1組", projectName: "智慧記帳" });
  });

  it("標題少了欄位，直接說少哪一欄", () => {
    expect(parseRosterCsv("email,姓名,角色\na@g.nccu.edu.tw,王,專案生")).toEqual({ ok: false, errors: ["缺少欄位：組別、專案名稱"] });
  });

  it("一次列出所有有問題的列", () => {
    const r = parseRosterCsv(
      [
        HEADER,
        "a@gmail.com,甲,專案生,第1組,X",
        "b@g.nccu.edu.tw,乙,專案生,,",
        "c@g.nccu.edu.tw,丙,專案生,第1組,X",
        "C@g.nccu.edu.tw,丙二,專案生,第2組,Y",
        "d@g.nccu.edu.tw,丁,專案生,第1組,Z",
      ].join("\n")
    );
    expect(r).toEqual({
      ok: false,
      errors: [
        "第 2 列：email 必須是 @g.nccu.edu.tw",
        "第 3 列：專案生一定要填組別與專案名稱",
        "第 5 列：email c@g.nccu.edu.tw 和第 4 列重複",
        "第 6 列：第1組的專案名稱和前面不一致（X／Z）",
      ],
    });
  });

  it("幹部填了組別會出錯", () => {
    const r = parseRosterCsv(
      [HEADER, "o@g.nccu.edu.tw,林公關,其他幹部,第1組,"].join("\n")
    );
    expect(r).toEqual({
      ok: false,
      errors: ["第 2 列：幹部不屬於任何一組，組別請留空"],
    });
  });

  // 最終審查 M11：姓名空白會讓頁首、組頁「最近回報」、看板都變成空字串。
  it("姓名空白（或只有空格）→ 第 N 列：姓名不能空白", () => {
    const r = parseRosterCsv(
      [HEADER, "a@g.nccu.edu.tw,,專案生,第1組,智慧記帳", "p@g.nccu.edu.tw,   ,專案幹部,,"].join("\n")
    );
    expect(r).toEqual({ ok: false, errors: ["第 2 列：姓名不能空白", "第 3 列：姓名不能空白"] });
  });
});
