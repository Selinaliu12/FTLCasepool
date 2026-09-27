import { describe, it, expect } from "vitest";
import { navLinksFor } from "./app-header";
import type { Access } from "@/domain/access";

type HeaderAccess = Extract<Access, { kind: "ok" } | { kind: "no_semester" }>;

function ok(role: "pm" | "officer" | "student", overrides: Partial<HeaderAccess> = {}): HeaderAccess {
  return {
    kind: "ok",
    email: "x@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "m1", semesterId: "s1", email: "x@g.nccu.edu.tw", name: "X", role, groupId: role === "student" ? "g1" : null },
    semesterId: "s1",
    ...overrides,
  };
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
    expect(navLinksFor({ kind: "ok", email: "admin@g.nccu.edu.tw", isAdmin: true, member: null, semesterId: "s1" })).toEqual([
      { href: "/admin", label: "學期設定" },
      { href: "/dashboard", label: "總覽看板" },
      { href: "/competitions", label: "競賽大廳" },
    ]);
  });

  it("管理員但還沒有任何學期：只有學期設定，沒有競賽大廳（沒有學期可看）", () => {
    expect(navLinksFor({ kind: "no_semester", isAdmin: true })).toEqual([{ href: "/admin", label: "學期設定" }]);
  });
});
