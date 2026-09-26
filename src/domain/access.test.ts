import { describe, it, expect } from "vitest";
import { resolveAccess, parseAdminEmails } from "./access";

const student = { id: "m1", semesterId: "s1", email: "a@g.nccu.edu.tw", name: "甲", role: "student" as const, groupId: "g1" };

describe("resolveAccess", () => {
  it("非學校帳號一律擋下", () => {
    expect(resolveAccess("a@gmail.com", { adminEmails: [], semesterId: "s1", member: null })).toEqual({ kind: "wrong_domain" });
  });

  it("學校帳號但不在名單、也不是管理員 → not_in_roster", () => {
    expect(resolveAccess("x@g.nccu.edu.tw", { adminEmails: [], semesterId: "s1", member: null })).toEqual({ kind: "not_in_roster" });
  });

  it("管理員不在名單也能進（要先進來才能匯入名單）", () => {
    expect(resolveAccess("Admin@g.nccu.edu.tw", { adminEmails: ["admin@g.nccu.edu.tw"], semesterId: "s1", member: null }))
      .toEqual({ kind: "ok", email: "admin@g.nccu.edu.tw", isAdmin: true, member: null, semesterId: "s1" });
  });

  it("還沒有學期：管理員 no_semester(isAdmin=true)，其他人 no_semester(isAdmin=false)", () => {
    expect(resolveAccess("admin@g.nccu.edu.tw", { adminEmails: ["admin@g.nccu.edu.tw"], semesterId: null, member: null })).toEqual({ kind: "no_semester", isAdmin: true });
    expect(resolveAccess("a@g.nccu.edu.tw", { adminEmails: [], semesterId: null, member: null })).toEqual({ kind: "no_semester", isAdmin: false });
  });

  it("名單上的人 → ok，且帶著 member", () => {
    expect(resolveAccess("a@g.nccu.edu.tw", { adminEmails: [], semesterId: "s1", member: student }))
      .toEqual({ kind: "ok", email: "a@g.nccu.edu.tw", isAdmin: false, member: student, semesterId: "s1" });
  });

  it("ADMIN_EMAILS 容忍空白與大寫", () => {
    expect(parseAdminEmails(" A@g.nccu.edu.tw, b@g.nccu.edu.tw ,")).toEqual(["a@g.nccu.edu.tw", "b@g.nccu.edu.tw"]);
  });
});
