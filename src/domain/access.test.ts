import { describe, it, expect } from "vitest";
import { resolveAccess, parseAdminEmails, isTrustedProvider, identityId, homeFor, isStaffIdentity, type RosterRow, type IdentityRole } from "./access";

const student: RosterRow = { id: "m1", semesterId: "s1", email: "a@g.nccu.edu.tw", name: "甲", role: "student", groupId: "g1", groupName: "第1組" };
const ADMIN_ONLY = { memberId: null, role: "admin", groupId: null, label: "管理員" } as const;

function ctx(over: Partial<Parameters<typeof resolveAccess>[1]> = {}): Parameters<typeof resolveAccess>[1] {
  return { adminEmails: [], semesterId: "s1", rows: [], preferred: null, ...over };
}

describe("resolveAccess", () => {
  it("不是合法信箱一律擋下", () => {
    expect(resolveAccess("not-an-email", ctx())).toEqual({ kind: "wrong_domain" });
    expect(resolveAccess("", ctx())).toEqual({ kind: "wrong_domain" });
  });

  it("校外信箱（§17-16）：不在名單 → not_in_roster；在名單 → ok", () => {
    expect(resolveAccess("someone@gmail.com", ctx())).toEqual({ kind: "not_in_roster" });
    const rows: RosterRow[] = [{ id: "m1", semesterId: "s1", email: "someone@gmail.com", name: "校外", role: "student", groupId: "g1", groupName: "第1組" }];
    expect(resolveAccess("Someone@Gmail.com", ctx({ rows })).kind).toBe("ok");
  });

  it("學校帳號但不在名單、也不是管理員 → not_in_roster", () => {
    expect(resolveAccess("x@g.nccu.edu.tw", ctx())).toEqual({ kind: "not_in_roster" });
  });

  it("管理員不在名單也能進（要先進來才能匯入名單）：identities 只有管理員", () => {
    expect(resolveAccess("Admin@g.nccu.edu.tw", ctx({ adminEmails: ["admin@g.nccu.edu.tw"] }))).toEqual({
      kind: "ok",
      email: "admin@g.nccu.edu.tw",
      name: null,
      identities: [ADMIN_ONLY],
      active: ADMIN_ONLY,
      semesterId: "s1",
    });
  });

  it("還沒有學期：管理員 no_semester(isAdmin=true)，其他人 no_semester(isAdmin=false)", () => {
    expect(resolveAccess("admin@g.nccu.edu.tw", ctx({ adminEmails: ["admin@g.nccu.edu.tw"], semesterId: null }))).toEqual({ kind: "no_semester", isAdmin: true });
    expect(resolveAccess("a@g.nccu.edu.tw", ctx({ semesterId: null }))).toEqual({ kind: "no_semester", isAdmin: false });
  });

  it("名單上的單一身份 → ok，身份＝那一列，標籤「第1組專案生」", () => {
    const identity = { memberId: "m1", role: "student", groupId: "g1", label: "第1組專案生" };
    expect(resolveAccess("a@g.nccu.edu.tw", ctx({ rows: [student] }))).toEqual({
      kind: "ok",
      email: "a@g.nccu.edu.tw",
      name: "甲",
      identities: [identity],
      active: identity,
      semesterId: "s1",
    });
  });

  it("ADMIN_EMAILS 容忍空白與大寫", () => {
    expect(parseAdminEmails(" A@g.nccu.edu.tw, b@g.nccu.edu.tw ,")).toEqual(["a@g.nccu.edu.tw", "b@g.nccu.edu.tw"]);
  });
});

describe("resolveAccess：多重身份", () => {
  const email = "multi@g.nccu.edu.tw";
  const rows: RosterRow[] = [
    { id: "s10", semesterId: "s1", email, name: "多", role: "student", groupId: "g10", groupName: "第10組" },
    { id: "off", semesterId: "s1", email, name: "多", role: "officer", groupId: null, groupName: null },
    { id: "s2", semesterId: "s1", email, name: "多", role: "student", groupId: "g2", groupName: "第2組" },
    { id: "pm", semesterId: "s1", email, name: "多", role: "pm", groupId: null, groupName: null },
  ];

  it("身份順序：管理員 → 專案幹部 → 其他幹部 → 專案生（組名自然排序，第2組在第10組前）", () => {
    const access = resolveAccess(email, ctx({ rows, adminEmails: [email] }));
    if (access.kind !== "ok") throw new Error(access.kind);
    expect(access.identities.map((i) => i.label)).toEqual(["管理員", "專案幹部", "其他幹部", "第2組專案生", "第10組專案生"]);
    expect(access.identities.map(identityId)).toEqual(["admin", "pm", "off", "s2", "s10"]);
    // 沒有 cookie：第一個身份。
    expect(access.active.role).toBe("admin");
  });

  it("cookie 指到自己的某個身份 → 那就是目前身份", () => {
    const access = resolveAccess(email, ctx({ rows, preferred: "s10" }));
    if (access.kind !== "ok") throw new Error(access.kind);
    expect(access.active).toEqual({ memberId: "s10", role: "student", groupId: "g10", label: "第10組專案生" });
  });

  it("cookie 被竄改成別人的身份／不存在的身份 → 退回第一個合法身份，不報錯", () => {
    for (const preferred of ["someone-elses-member-id", "", "admin"]) {
      const access = resolveAccess(email, ctx({ rows, preferred }));
      if (access.kind !== "ok") throw new Error(access.kind);
      // 不是管理員時 "admin" 也不合法；第一個合法身份是專案幹部。
      expect(access.active).toEqual({ memberId: "pm", role: "pm", groupId: null, label: "專案幹部" });
    }
  });

  it("管理員有名單列時：多一個「管理員」身份，cookie=admin 可以選回管理員", () => {
    const access = resolveAccess(email, ctx({ rows, adminEmails: [email], preferred: "s2" }));
    if (access.kind !== "ok") throw new Error(access.kind);
    expect(access.active.label).toBe("第2組專案生");
    const back = resolveAccess(email, ctx({ rows, adminEmails: [email], preferred: "admin" }));
    if (back.kind !== "ok") throw new Error(back.kind);
    expect(back.active).toEqual(ADMIN_ONLY);
  });
});

describe("homeFor", () => {
  it("專案生→/my-group、幹部→/dashboard、管理員→/admin", () => {
    expect(homeFor({ memberId: "a", role: "student", groupId: "g", label: "第1組專案生" })).toBe("/my-group");
    expect(homeFor({ memberId: "a", role: "pm", groupId: null, label: "專案幹部" })).toBe("/dashboard");
    expect(homeFor({ memberId: "a", role: "officer", groupId: null, label: "其他幹部" })).toBe("/dashboard");
    expect(homeFor(ADMIN_ONLY)).toBe("/admin");
  });
});

describe("isStaffIdentity（新增／編輯競賽的明確白名單：管理員、專案幹部、其他幹部）", () => {
  it("admin／pm／officer 是；student 不是；白名單以外的值一律不是", () => {
    const of = (role: IdentityRole) => isStaffIdentity({ memberId: "x", role, groupId: null, label: "" });
    expect(of("admin")).toBe(true);
    expect(of("pm")).toBe(true);
    expect(of("officer")).toBe(true);
    expect(of("student")).toBe(false);
    expect(of("future-role" as IdentityRole)).toBe(false);
  });
});

describe("isTrustedProvider", () => {
  it("google 一律信任", () => {
    expect(isTrustedProvider("google", false)).toBe(true);
    expect(isTrustedProvider("google", true)).toBe(true);
  });

  it("非 google 只有在 enableTestLogin 時才信任", () => {
    expect(isTrustedProvider("email", false)).toBe(false);
    expect(isTrustedProvider("email", true)).toBe(true);
    expect(isTrustedProvider(undefined, false)).toBe(false);
  });
});
