import { beforeAll, describe, it, expect } from "vitest";
import { resetDb, seedSemester, okAccess } from "./helpers";
import { resolveAccess } from "../../src/domain/access";

// Task 3 fix F2：舊寫法的 mock（okAccess）產生的身份必須跟正式 resolveAccess() 一模一樣，
// 包括標籤「第N組專案生」——不能讓測試跑在正式環境不可能出現的身份形狀上。
let seed: Awaited<ReturnType<typeof seedSemester>>;
beforeAll(async () => {
  await resetDb();
  seed = await seedSemester();
});

describe("okAccess（舊寫法 mock 轉新形狀）", () => {
  it("專案生身份的標籤是「第N組專案生」，跟 resolveAccess 產生的一樣", () => {
    const member = { id: "s-id", semesterId: seed.semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student" as const, groupId: seed.groupA };
    const legacy = okAccess({ kind: "ok", email: member.email, isAdmin: false, member, semesterId: seed.semesterId });
    const real = resolveAccess(member.email, {
      adminEmails: [],
      semesterId: seed.semesterId,
      rows: [{ ...member, groupName: "第1組" }],
      preferred: null,
    });
    expect(legacy).toEqual(real);
    if (legacy.kind !== "ok") throw new Error("not ok");
    expect(legacy.active.label).toBe("第1組專案生");
  });

  it("管理員＋幹部：跟 resolveAccess 一樣（管理員排第一、是目前身份）", () => {
    const member = { id: "o-id", semesterId: seed.semesterId, email: "admin@g.nccu.edu.tw", name: "管", role: "officer" as const, groupId: null };
    const legacy = okAccess({ kind: "ok", email: member.email, isAdmin: true, member, semesterId: seed.semesterId });
    const real = resolveAccess(member.email, {
      adminEmails: [member.email],
      semesterId: seed.semesterId,
      rows: [{ ...member, groupName: null }],
      preferred: null,
    });
    expect(legacy).toEqual(real);
  });

  it("不認得的組 id 又沒給組名 → 直接報錯，不默默造出錯的標籤", () => {
    expect(() =>
      okAccess({
        kind: "ok",
        email: "x@g.nccu.edu.tw",
        isAdmin: false,
        member: { id: "x", semesterId: seed.semesterId, email: "x@g.nccu.edu.tw", name: "X", role: "student", groupId: "unknown-group" },
        semesterId: seed.semesterId,
      })
    ).toThrow(/組名/);
  });
});
