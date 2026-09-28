import { describe, it, expect } from "vitest";
import { navLinksFor, displayNameFor } from "./app-header";
import type { Access, Identity } from "@/domain/access";

type HeaderAccess = Extract<Access, { kind: "ok" } | { kind: "no_semester" }>;

const ADMIN: Identity = { memberId: null, role: "admin", groupId: null, label: "管理員" };

function identity(role: "pm" | "officer" | "student"): Identity {
  const label = role === "student" ? "第1組專案生" : role === "pm" ? "專案幹部" : "其他幹部";
  return { memberId: "m1", role, groupId: role === "student" ? "g1" : null, label };
}

function ok(role: "pm" | "officer" | "student"): HeaderAccess {
  const active = identity(role);
  return { kind: "ok", email: "x@g.nccu.edu.tw", name: "X", identities: [active], active, semesterId: "s1" };
}

describe("navLinksFor：競賽大廳連結（所有身分都有）", () => {
  it("專案幹部：總覽看板＋競賽大廳", () => {
    expect(navLinksFor(ok("pm"))).toEqual([
      { href: "/dashboard", label: "總覽看板" },
      { href: "/competitions", label: "競賽大廳" },
    ]);
  });

  it("其他幹部：總覽看板＋競賽大廳", () => {
    expect(navLinksFor(ok("officer"))).toEqual([
      { href: "/dashboard", label: "總覽看板" },
      { href: "/competitions", label: "競賽大廳" },
    ]);
  });

  it("學生：我的組別＋競賽大廳", () => {
    expect(navLinksFor(ok("student"))).toEqual([
      { href: "/my-group", label: "我的組別" },
      { href: "/competitions", label: "競賽大廳" },
    ]);
  });

  it("管理員：學期設定＋總覽看板＋競賽大廳", () => {
    expect(
      navLinksFor({ kind: "ok", email: "admin@g.nccu.edu.tw", name: null, identities: [ADMIN], active: ADMIN, semesterId: "s1" })
    ).toEqual([
      { href: "/admin", label: "學期設定" },
      { href: "/dashboard", label: "總覽看板" },
      { href: "/competitions", label: "競賽大廳" },
    ]);
  });

  it("管理員但還沒有任何學期：只有學期設定，沒有競賽大廳（沒有學期可看）", () => {
    expect(navLinksFor({ kind: "no_semester", isAdmin: true })).toEqual([{ href: "/admin", label: "學期設定" }]);
  });

  it("導覽連結依「目前身份」：管理員兼第1組專案生，目前身份是專案生 → 我的組別，沒有學期設定", () => {
    const student = identity("student");
    expect(
      navLinksFor({ kind: "ok", email: "admin@g.nccu.edu.tw", name: "管", identities: [ADMIN, student], active: student, semesterId: "s1" })
    ).toEqual([
      { href: "/my-group", label: "我的組別" },
      { href: "/competitions", label: "競賽大廳" },
    ]);
  });
});

describe("displayNameFor", () => {
  it("名單上的姓名；不在名單上的管理員顯示 email；還沒有學期顯示「管理員」", () => {
    expect(displayNameFor(ok("student"))).toBe("X");
    expect(displayNameFor({ kind: "ok", email: "admin@g.nccu.edu.tw", name: null, identities: [ADMIN], active: ADMIN, semesterId: "s1" })).toBe(
      "admin@g.nccu.edu.tw"
    );
    expect(displayNameFor({ kind: "no_semester", isAdmin: true })).toBe("管理員");
  });
});
