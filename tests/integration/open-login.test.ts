import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedSemester, service, queryAsForgedJwt } from "./helpers";

// 規格 §17-16～19：任何網域的 Google 帳號都能登入，但只有名單上的信箱讀得到資料；
// 仍只信任 Google（provider=email 一律擋）。下面「不該看到」的斷言是防放寬：規則一鬆就會紅。
let seed: Awaited<ReturnType<typeof seedSemester>>;

beforeEach(async () => {
  await resetDb();
  seed = await seedSemester();
  const { error } = await service().from("members").insert({
    semester_id: seed.semesterId, email: "outside@gmail.com", name: "校外生", role: "student", group_id: seed.groupA,
  });
  if (error) throw error;
});

const reportSql = () => `select id from progress_reports where line_id = '${seed.lineA}'`;

describe("資料庫：members.email 只檢查格式", () => {
  it("接受校外信箱，拒絕格式不對或大寫", async () => {
    const db = service();
    for (const email of ["not-an-email", "a@gmail", "a b@gmail.com", "Upper@gmail.com"]) {
      const { error } = await db.from("members").insert({ semester_id: seed.semesterId, email, name: "x", role: "officer" });
      expect(error, email).not.toBeNull();
    }
    const { error } = await db.from("members").insert({ semester_id: seed.semesterId, email: "x@company.com.tw", name: "x", role: "officer" });
    expect(error).toBeNull();
  });
});

describe("RLS：校外信箱", () => {
  it("名單上的校外信箱用 Google 登入，讀得到自己組", async () => {
    const rows = await queryAsForgedJwt({ email: "outside@gmail.com", app_metadata: { provider: "google" }, role: "authenticated" }, reportSql());
    expect(rows).toHaveLength(1);
  });

  it("名單上的校外信箱，不是 Google 登入（provider=email）→ 什麼都讀不到", async () => {
    const rows = await queryAsForgedJwt(
      { email: "outside@gmail.com", app_metadata: { provider: "email" }, role: "authenticated" },
      reportSql(),
      { allowEmailLogin: false }
    );
    expect(rows).toEqual([]);
  });

  it("不在名單上的校外 Google 帳號 → 什麼都讀不到", async () => {
    const claims = { email: "stranger@gmail.com", app_metadata: { provider: "google" }, role: "authenticated" };
    expect(await queryAsForgedJwt(claims, reportSql())).toEqual([]);
    expect(await queryAsForgedJwt(claims, "select id from periods")).toEqual([]);
    expect(await queryAsForgedJwt(claims, "select id from groups")).toEqual([]);
  });

  it("已離開的校外成員 → 讀不到", async () => {
    await service().from("members").update({ left_at: new Date().toISOString() }).eq("email", "outside@gmail.com");
    const rows = await queryAsForgedJwt({ email: "outside@gmail.com", app_metadata: { provider: "google" }, role: "authenticated" }, reportSql());
    expect(rows).toEqual([]);
  });
});
