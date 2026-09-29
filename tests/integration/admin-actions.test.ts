import { beforeEach, describe, it, expect, vi } from "vitest";
import { Client as PgClient } from "pg";
import { resetDb, seedSemester, okAccess, backdatePdfUploadedAt, uploadTestPdf, ensureLocalStorageBucket, withRawPg } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";
import { env } from "@/server/env";
import { resolveAccess } from "@/domain/access";

// admin actions 一律先呼叫 requireAdmin()（建在 getAccess() 上）。這裡整份測試都用
// vi.mock 假造 @/server/session，讓每個測試自己決定「呼叫者是誰」，不用真的登入。
const mockGetAccess = vi.fn();
vi.mock("@/server/session", () => ({ getAccess: () => mockGetAccess() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function asStudent(semesterId: string) {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email: "a1@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "m1", semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student", groupId: "g1", groupName: "第1組" },
    semesterId,
  }));
}

// kind:"ok" 一定帶著真的 semesterId（Access 的型別本來就是這樣定義的：{kind:"ok", semesterId:
// string, ...}）。「管理員、但還沒有任何學期」是另一個獨立的 kind:"no_semester"，不是
// kind:"ok" 加一個 null 的 semesterId——那是型別上不可能出現的狀態，fix round 1 之前的版本
// 誤用了它（asAdmin(null)）。
function asAdmin(semesterId: string) {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email: "admin@g.nccu.edu.tw",
    isAdmin: true,
    member: null,
    semesterId,
  }));
}

function asAdminNoSemester() {
  mockGetAccess.mockResolvedValue({ kind: "no_semester", isAdmin: true });
}

function asNoSemesterNonAdmin() {
  mockGetAccess.mockResolvedValue({ kind: "no_semester", isAdmin: false });
}

function asWrongDomain() {
  mockGetAccess.mockResolvedValue({ kind: "wrong_domain" });
}

function asNotInRoster() {
  mockGetAccess.mockResolvedValue({ kind: "not_in_roster" });
}

// Final whole-branch review F1：管理員也在名單上（例如兼其他幹部），但目前身份（active identity）
// 切成了名單上的那個身份，不是「管理員」。跟 asAdminOfficer（helpers.ts）不一樣：那個 helper用
// okAccess() 的 preferred:null，active 永遠還是排序第一的管理員身份，測不到「已經切走」這個狀態。
// 這裡直接呼叫真正的 resolveAccess()，把 preferred 指到名單列的 id，讓 active 真的變成其他幹部，
// 模擬 Task 3「動作依目前選的身份」的規則：requireAdmin() 必須看 active.role，不能只看
// 「這個人是不是管理員」，否則管理員兼幹部的人切走之後還是做得了管理員動作。
function asAdminActiveOfficer(semesterId: string, memberId: string) {
  const access = resolveAccess("admin@g.nccu.edu.tw", {
    adminEmails: ["admin@g.nccu.edu.tw"],
    semesterId,
    rows: [
      {
        id: memberId,
        semesterId,
        email: "admin@g.nccu.edu.tw",
        name: "管理員兼其他幹部",
        role: "officer",
        groupId: null,
        groupName: null,
      },
    ],
    preferred: memberId,
  });
  if (access.kind !== "ok") throw new Error(`asAdminActiveOfficer：resolveAccess 沒有回 ok（${access.kind}）`);
  mockGetAccess.mockResolvedValue(access);
}

// 最終審查 I1／M1 的競速測試：從另一條監控連線輪詢 pg_stat_activity，等到真的有一個 active
// 連線卡在鎖上（advisory lock 或列鎖都算），才讓持鎖的那一方 commit。有 5 秒逾時，等不到就讓
// 測試失敗（代表被測的動作根本沒有排隊）。
async function waitUntilSomeoneWaitsOnLock(): Promise<void> {
  const host = new URL(env.supabaseUrl).hostname;
  const monitor = new PgClient({ host, port: 54322, user: "postgres", password: "postgres", database: "postgres" });
  await monitor.connect();
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { rows } = await monitor.query(
        `select count(*)::int as n from pg_stat_activity
         where state = 'active' and wait_event_type = 'Lock' and pid <> pg_backend_pid()`
      );
      if (rows[0].n > 0) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("等不到被測的動作卡在鎖上");
  } finally {
    await monitor.end();
  }
}

// 等到有另一條連線在排隊等 holder 手上的某一把 advisory lock（不是隨便哪一把鎖）。
async function waitUntilWaitingOnAdvisoryHeldBy(holder: PgClient): Promise<void> {
  const { rows: pidRows } = await holder.query("select pg_backend_pid() as pid");
  const holderPid = pidRows[0].pid as number;
  const host = new URL(env.supabaseUrl).hostname;
  const monitor = new PgClient({ host, port: 54322, user: "postgres", password: "postgres", database: "postgres" });
  await monitor.connect();
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { rows } = await monitor.query(
        `select count(*)::int as n from pg_locks w
         join pg_locks h on h.locktype = 'advisory' and h.granted and h.pid = $1
           and w.classid = h.classid and w.objid = h.objid and w.objsubid = h.objsubid
         where w.locktype = 'advisory' and not w.granted`,
        [holderPid]
      );
      if (rows[0].n > 0) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("等不到被測的動作排隊等這條連線的 advisory lock");
  } finally {
    await monitor.end();
  }
}

describe("requireAdmin", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("非管理員呼叫任何動作都被拒", async () => {
    const seed = await seedSemester();
    asStudent(seed.semesterId);
    const { createSemester } = await import("@/server/actions/admin");
    await expect(createSemester("115-2")).rejects.toThrow("只有系統管理員可以這樣做");
  });

  it("其他五個動作對非管理員一樣被拒", async () => {
    const seed = await seedSemester();
    asStudent(seed.semesterId);
    const { importRoster, savePeriods, setPmGroups, setRedAfterHours, moveMember } = await import("@/server/actions/admin");
    await expect(importRoster(seed.semesterId, "")).rejects.toThrow("只有系統管理員可以這樣做");
    await expect(savePeriods(seed.semesterId, [])).rejects.toThrow("只有系統管理員可以這樣做");
    await expect(setPmGroups("m1", [])).rejects.toThrow("只有系統管理員可以這樣做");
    await expect(setRedAfterHours(seed.semesterId, 48)).rejects.toThrow("只有系統管理員可以這樣做");
    await expect(moveMember("m1", "g1")).rejects.toThrow("只有系統管理員可以這樣做");
  });

  it("還沒有學期、也不是管理員 → 被拒", async () => {
    await resetDb(); // 真的沒有任何學期
    asNoSemesterNonAdmin();
    const { createSemester } = await import("@/server/actions/admin");
    await expect(createSemester("115-1")).rejects.toThrow("只有系統管理員可以這樣做");
  });

  it("wrong_domain → 被拒", async () => {
    const seed = await seedSemester();
    asWrongDomain();
    const { setRedAfterHours } = await import("@/server/actions/admin");
    await expect(setRedAfterHours(seed.semesterId, 48)).rejects.toThrow("只有系統管理員可以這樣做");
  });

  it("not_in_roster → 被拒", async () => {
    const seed = await seedSemester();
    asNotInRoster();
    const { setRedAfterHours } = await import("@/server/actions/admin");
    await expect(setRedAfterHours(seed.semesterId, 48)).rejects.toThrow("只有系統管理員可以這樣做");
  });

  // Final whole-branch review F1：管理員也在名單上，但目前身份已經切成名單上的身份（不是
  // 管理員）→ 一樣被拒。這是 Task 3 的行為（規格 §14 第 3 點：動作依目前選的身份判斷），
  // 之前沒有測試覆蓋——如果有人把 requireAdmin() 改鬆成「只要這個人的身份裡有一個是管理員
  // 就放行」，這個測試會抓到。
  it("管理員也在名單上，但目前身份切成其他幹部 → 一樣被拒", async () => {
    const seed = await seedSemester();
    const svc = createServiceSupabase();
    const { data: officerRow, error } = await svc
      .from("members")
      .insert({ semester_id: seed.semesterId, email: "admin@g.nccu.edu.tw", name: "管理員兼其他幹部", role: "officer", group_id: null })
      .select()
      .single();
    if (error) throw error;
    asAdminActiveOfficer(seed.semesterId, officerRow!.id as string);

    const { savePeriods, previewPeriodDeletion } = await import("@/server/actions/admin");
    await expect(savePeriods(seed.semesterId, [])).rejects.toThrow("只有系統管理員可以這樣做");
    await expect(previewPeriodDeletion([])).rejects.toThrow("只有系統管理員可以這樣做");
  });
});

describe("createSemester", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("還沒有任何學期時可以建立第一個學期", async () => {
    asAdminNoSemester();
    const { createSemester } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");

    const svc = createServiceSupabase();
    const { data } = await svc.from("semesters").select("id, name, is_current");
    expect(data).toEqual([{ id: semesterId, name: "115-1", is_current: true }]);
  });

  it("已經有當前學期時，建新學期只讓新的是當前學期", async () => {
    const seed = await seedSemester(); // 種好 "115-1"，is_current=true
    asAdmin(seed.semesterId);
    const { createSemester } = await import("@/server/actions/admin");
    const { semesterId: newId } = await createSemester("115-2");

    const svc = createServiceSupabase();
    const { data } = await svc.from("semesters").select("id, is_current").order("name");
    expect(data).toEqual([
      { id: seed.semesterId, is_current: false },
      { id: newId, is_current: true },
    ]);
  });

  it("學期名稱重複：回傳錯誤，而且舊學期仍然是當前學期", async () => {
    const seed = await seedSemester(); // "115-1"
    asAdmin(seed.semesterId);
    const { createSemester } = await import("@/server/actions/admin");
    await expect(createSemester("115-1")).rejects.toThrow("這個學期名稱已經存在");

    const svc = createServiceSupabase();
    const { data } = await svc.from("semesters").select("id, is_current");
    expect(data).toEqual([{ id: seed.semesterId, is_current: true }]);
  });

  it("空白學期名稱回傳錯誤", async () => {
    asAdminNoSemester();
    const { createSemester } = await import("@/server/actions/admin");
    await expect(createSemester("   ")).rejects.toThrow("請輸入學期名稱");
  });

  // Task 7 review 折進 Task 8：上傳的 storage key 用學期名稱當路徑前綴（`${semester.name}/...`，
  // 見 src/server/actions/upload.ts），名稱裡有 "/" 會多切出一層目錄，之後用
  // `key like (學期名稱 || '/%')` 找回本學期的紀錄（member_has_records()）就會算錯範圍。
  it("學期名稱含「/」回傳錯誤", async () => {
    asAdminNoSemester();
    const { createSemester } = await import("@/server/actions/admin");
    await expect(createSemester("115-1/a")).rejects.toThrow("學期名稱不能有「/」");
  });
});

const CSV_OK = [
  "email,姓名,角色,學號,系級,組別,專案名稱",
  "s1@g.nccu.edu.tw,甲一,專案生,110701001,資科三,第1組,專案A",
  "s2@g.nccu.edu.tw,甲二,專案生,110701002,資科三,第1組,專案A",
  "s3@g.nccu.edu.tw,乙一,專案生,110701003,資科三,第2組,專案B",
  "pm1@g.nccu.edu.tw,幹部,專案幹部,,,,",
].join("\n");

describe("importRoster", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("匯入後：2 組、每組 1 條專案線、成員歸組", async () => {
    asAdminNoSemester();
    const { createSemester } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    const { importRoster } = await import("@/server/actions/admin");
    const r = await importRoster(semesterId, CSV_OK);
    expect(r).toEqual({ ok: true, imported: 4 });

    const svc = createServiceSupabase();
    const { data: groups } = await svc
      .from("groups")
      .select("name, lines(kind)")
      .eq("semester_id", semesterId)
      .order("name");
    expect(groups).toEqual([
      { name: "第1組", lines: [{ kind: "project" }] },
      { name: "第2組", lines: [{ kind: "project" }] },
    ]);
  });

  it("成員真的歸到正確的組（email → 組名）", async () => {
    asAdminNoSemester();
    const { createSemester, importRoster } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    await importRoster(semesterId, CSV_OK);

    const svc = createServiceSupabase();
    const { data: members } = await svc
      .from("members")
      .select("email, role, groups!members_group_id_fkey(name)")
      .eq("semester_id", semesterId)
      .order("email");
    expect(members).toEqual([
      { email: "pm1@g.nccu.edu.tw", role: "pm", groups: null },
      { email: "s1@g.nccu.edu.tw", role: "student", groups: { name: "第1組" } },
      { email: "s2@g.nccu.edu.tw", role: "student", groups: { name: "第1組" } },
      { email: "s3@g.nccu.edu.tw", role: "student", groups: { name: "第2組" } },
    ]);
  });

  it("CSV 有錯就一筆都不寫入", async () => {
    asAdminNoSemester();
    const { createSemester, importRoster } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    const badCsv = [
      "email,姓名,角色,學號,系級,組別,專案名稱",
      "s1@g.nccu.edu.tw,甲一,學生,110701001,資科三,第1組,專案A",
    ].join("\n");
    const r = await importRoster(semesterId, badCsv);
    expect(r).toEqual({ ok: false, errors: ["第 2 列：角色「學生」不是 專案幹部／其他幹部／專案生"] });

    const svc = createServiceSupabase();
    const { count } = await svc.from("members").select("id", { count: "exact", head: true }).eq("semester_id", semesterId);
    expect(count).toBe(0);
  });

  it("已經匯入過的學期不能再整批匯入", async () => {
    asAdminNoSemester();
    const { createSemester, importRoster } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    await importRoster(semesterId, CSV_OK);
    const r = await importRoster(semesterId, CSV_OK);
    expect(r).toEqual({ ok: false, errors: ["本學期已匯入名單；學期中的異動請用「成員」區塊"] });
  });

  // §14：同一個人可以同時是兩組的專案生，也可以身兼專案幹部——三列身份都要各自寫進 members。
  it("多列匯入：同一人在兩組是專案生，同時也是專案幹部", async () => {
    asAdminNoSemester();
    const { createSemester, importRoster } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    const csv = [
      "email,姓名,角色,學號,系級,組別,專案名稱",
      "multi@g.nccu.edu.tw,王小明,專案生,110701001,資科三,第1組,專案A",
      "multi@g.nccu.edu.tw,王小明,專案生,110701001,資科三,第2組,專案B",
      "multi@g.nccu.edu.tw,王小明,專案幹部,110701001,資科三,,",
      "s2@g.nccu.edu.tw,甲二,專案生,110701002,資科三,第1組,專案A",
    ].join("\n");
    const r = await importRoster(semesterId, csv);
    expect(r).toEqual({ ok: true, imported: 4 });

    const svc = createServiceSupabase();
    const { data: rows } = await svc
      .from("members")
      .select("role, student_id, dept_year, groups!members_group_id_fkey(name)")
      .eq("semester_id", semesterId)
      .eq("email", "multi@g.nccu.edu.tw");
    type Row = { role: string; student_id: string | null; dept_year: string | null; groups: { name: string } | null };
    const sorted = ((rows ?? []) as unknown as Row[]).sort((a, b) => (a.groups?.name ?? "").localeCompare(b.groups?.name ?? ""));
    expect(sorted).toEqual([
      { role: "pm", student_id: "110701001", dept_year: "資科三", groups: null },
      { role: "student", student_id: "110701001", dept_year: "資科三", groups: { name: "第1組" } },
      { role: "student", student_id: "110701001", dept_year: "資科三", groups: { name: "第2組" } },
    ]);
  });

  it("資料不一致（同信箱姓名不同）被拒，一筆都不寫入", async () => {
    asAdminNoSemester();
    const { createSemester, importRoster } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    const csv = [
      "email,姓名,角色,學號,系級,組別,專案名稱",
      "multi@g.nccu.edu.tw,王小明,專案生,110701001,資科三,第1組,專案A",
      "multi@g.nccu.edu.tw,王小明二,專案生,110701001,資科三,第2組,專案B",
    ].join("\n");
    const r = await importRoster(semesterId, csv);
    expect(r).toEqual({
      ok: false,
      errors: ["第 3 列：同一個信箱的姓名／學號／系級要一致（和第 2 列不同）"],
    });

    const svc = createServiceSupabase();
    const { count } = await svc.from("members").select("id", { count: "exact", head: true }).eq("semester_id", semesterId);
    expect(count).toBe(0);
  });
});

describe("savePeriods", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("依日期排序編成第 1、2、3 期，截止時間照台北時間存", async () => {
    asAdminNoSemester();
    const { createSemester, savePeriods } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    const r = await savePeriods(semesterId, [
      { date: "2026-11-01", time: "23:59" },
      { date: "2026-10-01", time: "23:59" },
      { date: "2026-12-01", time: "23:59" },
    ]);
    expect(r).toEqual({ ok: true });

    const svc = createServiceSupabase();
    const { data } = await svc.from("periods").select("seq, deadline").eq("semester_id", semesterId).order("seq");
    expect((data ?? []).map((p) => ({ seq: p.seq, deadline: new Date(p.deadline).toISOString() }))).toEqual([
      { seq: 1, deadline: new Date("2026-10-01T15:59:59.999Z").toISOString() },
      { seq: 2, deadline: new Date("2026-11-01T15:59:59.999Z").toISOString() },
      { seq: 3, deadline: new Date("2026-12-01T15:59:59.999Z").toISOString() },
    ]);
  });

  it("日期重複、格式錯回傳錯誤，不寫入", async () => {
    asAdminNoSemester();
    const { createSemester, savePeriods } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    const r = await savePeriods(semesterId, [
      { date: "2026-10-01", time: "23:59" },
      { date: "2026-10-01", time: "23:59" },
      { date: "not-a-date", time: "23:59" },
    ]);
    expect(r).toEqual({
      ok: false,
      errors: ["第 3 列：日期或時間格式錯誤", "第 2 列：和第 1 列的截止時間重複"],
    });

    const svc = createServiceSupabase();
    const { count } = await svc.from("periods").select("id", { count: "exact", head: true }).eq("semester_id", semesterId);
    expect(count).toBe(0);
  });

  // Adjustments Task 5（規格 §14 第 8 點）：批次 1 的「已有人交件的期別與之前期別凍結」規則拿掉了——
  // 管理員可以改任何一期的截止日（已交的進度保留，準時與否依新日期重算）、可以刪除有人交件的期別
  // （要先確認，會一併刪掉那些進度與檔案），期別一律依截止日期重新編號。下面幾個測試是舊的凍結
  // 規則測試改寫成新行為（產品決定的改變），每一個都斷言新行為。
  // seed：第 1 期 2026-10-01T00:00Z（台北 10/01 08:00，第1組已交件）、第 2 期 2026-11-01T00:00Z（台北 08:00）。
  const CONFIRM_REQUIRED = "這期已經有組別交了進度，要刪除請先確認";

  async function periodsOf(semesterId: string) {
    const svc = createServiceSupabase();
    const { data } = await svc.from("periods").select("id, seq, deadline").eq("semester_id", semesterId).order("seq");
    return (data ?? []).map((p) => ({ id: p.id as string, seq: p.seq as number, deadline: new Date(p.deadline).toISOString() }));
  }

  async function reportCountOf(periodId: string) {
    const svc = createServiceSupabase();
    const { count } = await svc.from("progress_reports").select("id", { count: "exact", head: true }).eq("period_id", periodId);
    return count;
  }

  it("沒人交件的期別可以修改；已交件的期別沒改就原封不動", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [
      { id: seed.periodIds[0], date: "2026-10-01", time: "08:00" },
      { id: seed.periodIds[1], date: "2026-11-15", time: "23:59" },
    ]);
    expect(r).toEqual({ ok: true });
    expect(await periodsOf(seed.semesterId)).toEqual([
      { id: seed.periodIds[0], seq: 1, deadline: "2026-10-01T00:00:00.000Z" },
      { id: seed.periodIds[1], seq: 2, deadline: "2026-11-15T15:59:59.999Z" },
    ]);
  });

  it("每一列的建議內容會存起來；空白字串存成 null", async () => {
    asAdminNoSemester();
    const { createSemester, savePeriods } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    const r = await savePeriods(semesterId, [
      { date: "2026-10-01", time: "23:59", suggestion: "這期建議交截圖" },
      { date: "2026-11-01", time: "23:59", suggestion: "   " },
    ]);
    expect(r).toEqual({ ok: true });

    const svc = createServiceSupabase();
    const { data } = await svc.from("periods").select("seq, suggestion").eq("semester_id", semesterId).order("seq");
    expect(data).toEqual([
      { seq: 1, suggestion: "這期建議交截圖" },
      { seq: 2, suggestion: null },
    ]);
  });

  it("已有人交件的期別，建議內容可以修改", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [
      { id: seed.periodIds[0], date: "2026-10-01", time: "08:00", suggestion: "已交件的期別也能改建議" },
      { id: seed.periodIds[1], date: "2026-11-01", time: "08:00" },
    ]);
    expect(r).toEqual({ ok: true });

    const svc = createServiceSupabase();
    const { data } = await svc.from("periods").select("id, suggestion").eq("semester_id", seed.semesterId).order("seq");
    expect(data).toEqual([
      { id: seed.periodIds[0], suggestion: "已交件的期別也能改建議" },
      { id: seed.periodIds[1], suggestion: null },
    ]);
  });

  // 改寫自「修改已有人交件的期別被拒，錯誤訊息指出第幾期」。
  it("已有人交件的期別可以改截止日；交的進度保留在同一期", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [
      { id: seed.periodIds[0], date: "2026-10-03", time: "23:59" },
      { id: seed.periodIds[1], date: "2026-11-01", time: "08:00" },
    ]);
    expect(r).toEqual({ ok: true });
    expect(await periodsOf(seed.semesterId)).toEqual([
      { id: seed.periodIds[0], seq: 1, deadline: "2026-10-03T15:59:59.999Z" },
      { id: seed.periodIds[1], seq: 2, deadline: "2026-11-01T00:00:00.000Z" },
    ]);
    expect(await reportCountOf(seed.periodIds[0])).toBe(1);
  });

  // 改寫自「刪除已有人交件的期別被拒」：沒帶確認旗標時，刪除有人交件的期別被拒，什麼都沒動。
  it("刪除有人交件的期別但沒確認 → 這期已經有組別交了進度，要刪除請先確認；期別與進度都還在", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [{ id: seed.periodIds[1], date: "2026-11-01", time: "08:00" }]);
    expect(r).toEqual({ ok: false, errors: [CONFIRM_REQUIRED] });
    expect(await periodsOf(seed.semesterId)).toHaveLength(2);
    expect(await reportCountOf(seed.periodIds[0])).toBe(1);
  });

  it("確認後刪除有人交件的期別：期別、進度、R2 檔案都不見，剩下的期別重新編號", async () => {
    const seed = await seedSemester();
    const svc = createServiceSupabase();
    const { data: report } = await svc.from("progress_reports").select("id, pdf_key").eq("period_id", seed.periodIds[0]).single();
    // 讓這份進度超過 2 小時（已鎖定），確認管理員刪除期別時仍能刪掉鎖定的進度。
    await backdatePdfUploadedAt(report!.id as string, new Date(Date.now() - 3 * 60 * 60 * 1000));
    await ensureLocalStorageBucket();
    await uploadTestPdf(report!.pdf_key as string, new TextEncoder().encode("%PDF-1.4 test"));
    const { inspectUploaded } = await import("@/server/r2");
    expect(await inspectUploaded(report!.pdf_key as string)).not.toBeNull();

    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [{ id: seed.periodIds[1], date: "2026-11-01", time: "08:00" }], {
      confirmDeleteWithReports: true,
      expectedReportCounts: { [seed.periodIds[0]]: 1 },
    });
    expect(r).toEqual({ ok: true });
    expect(await periodsOf(seed.semesterId)).toEqual([
      { id: seed.periodIds[1], seq: 1, deadline: "2026-11-01T00:00:00.000Z" },
    ]);
    expect(await reportCountOf(seed.periodIds[0])).toBe(0);
    expect(await inspectUploaded(report!.pdf_key as string)).toBeNull();
  });

  // Fix round 1 F2：確認視窗看到的每期交件數跟交易裡實際的數字不一樣（預覽之後又有人交件）→ 拒絕，
  // 什麼都不刪，畫面要重新預覽。
  it("確認時帶的交件數跟實際不一樣 → 交件狀況已變動，請重新確認；期別與進度都還在", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [{ id: seed.periodIds[1], date: "2026-11-01", time: "08:00" }], {
      confirmDeleteWithReports: true,
      expectedReportCounts: { [seed.periodIds[0]]: 0 },
    });
    expect(r).toEqual({ ok: false, errors: ["交件狀況已變動，請重新確認"] });
    expect(await periodsOf(seed.semesterId)).toHaveLength(2);
    expect(await reportCountOf(seed.periodIds[0])).toBe(1);
  });

  it("確認時沒帶交件數 → 交件狀況已變動，請重新確認", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [{ id: seed.periodIds[1], date: "2026-11-01", time: "08:00" }], {
      confirmDeleteWithReports: true,
    });
    expect(r).toEqual({ ok: false, errors: ["交件狀況已變動，請重新確認"] });
    expect(await reportCountOf(seed.periodIds[0])).toBe(1);
  });

  it("預覽時是 0 份、確認前有人交件（同時刪兩期）→ 交件狀況已變動，請重新確認", async () => {
    const seed = await seedSemester();
    const svc = createServiceSupabase();
    // 預覽當下：第 1 期 1 份、第 2 期 0 份。之後第2組在第 2 期交件。
    const { data: lineB } = await svc.from("lines").select("id").eq("group_id", seed.groupB).single();
    const { error: insErr } = await svc.from("progress_reports").insert({
      line_id: lineB!.id, period_id: seed.periodIds[1], light: "green", did: "d", blocked: "b", next_steps: "n",
      submitted_by: "b1@g.nccu.edu.tw", pdf_key: "reports/lineB/period2.pdf", pdf_size: 10,
      pdf_uploaded_at: new Date().toISOString(), pdf_uploaded_by: "b1@g.nccu.edu.tw",
    });
    if (insErr) throw insErr;
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [{ date: "2026-12-01", time: "23:59" }], {
      confirmDeleteWithReports: true,
      expectedReportCounts: { [seed.periodIds[0]]: 1, [seed.periodIds[1]]: 0 },
    });
    expect(r).toEqual({ ok: false, errors: ["交件狀況已變動，請重新確認"] });
    expect(await reportCountOf(seed.periodIds[1])).toBe(1);
  });

  it("沒人交件的期別可以刪除，不需要確認", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [{ id: seed.periodIds[0], date: "2026-10-01", time: "08:00" }]);
    expect(r).toEqual({ ok: true });
    expect((await periodsOf(seed.semesterId)).map((p) => p.id)).toEqual([seed.periodIds[0]]);
  });

  it("可以往後追加新的期別，編號接在後面", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [
      { id: seed.periodIds[0], date: "2026-10-01", time: "08:00" },
      { id: seed.periodIds[1], date: "2026-11-01", time: "08:00" },
      { date: "2026-12-01", time: "23:59" },
    ]);
    expect(r).toEqual({ ok: true });
    const rows = await periodsOf(seed.semesterId);
    expect(rows.map((p) => [p.seq, p.deadline])).toEqual([
      [1, "2026-10-01T00:00:00.000Z"],
      [2, "2026-11-01T00:00:00.000Z"],
      [3, "2026-12-01T15:59:59.999Z"],
    ]);
  });

  // 改寫自「新的截止時間早於最後一個凍結期別被拒」。
  it("新增的期別可以排在已交件期別之前：依日期重新編號，進度仍掛在原本那一期", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [
      { id: seed.periodIds[0], date: "2026-10-01", time: "08:00" },
      { id: seed.periodIds[1], date: "2026-11-01", time: "08:00" },
      { date: "2026-09-20", time: "23:59" },
    ]);
    expect(r).toEqual({ ok: true });
    const rows = await periodsOf(seed.semesterId);
    expect(rows.map((p) => [p.seq, p.deadline])).toEqual([
      [1, "2026-09-20T15:59:59.999Z"],
      [2, "2026-10-01T00:00:00.000Z"],
      [3, "2026-11-01T00:00:00.000Z"],
    ]);
    expect(rows[1].id).toBe(seed.periodIds[0]);
    expect(await reportCountOf(seed.periodIds[0])).toBe(1);
  });

  // 改寫自「沒凍結的期別改到比凍結期別還早，一樣被拒」。
  it("沒人交件的期別改到比已交件期別還早：兩期互換編號，建議內容跟著期別走", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [
      { id: seed.periodIds[0], date: "2026-10-01", time: "08:00", suggestion: "原第 1 期的建議" },
      { id: seed.periodIds[1], date: "2026-09-20", time: "23:59", suggestion: "原第 2 期的建議" },
    ]);
    expect(r).toEqual({ ok: true });
    const svc = createServiceSupabase();
    const { data } = await svc.from("periods").select("id, seq, suggestion").eq("semester_id", seed.semesterId).order("seq");
    expect(data).toEqual([
      { id: seed.periodIds[1], seq: 1, suggestion: "原第 2 期的建議" },
      { id: seed.periodIds[0], seq: 2, suggestion: "原第 1 期的建議" },
    ]);
    expect(await reportCountOf(seed.periodIds[0])).toBe(1);
  });

  it("資料庫層：直接刪除有進度的期別會被外鍵擋下（on delete restrict）", async () => {
    const seed = await seedSemester();
    const svc = createServiceSupabase();
    const { error } = await svc.from("periods").delete().eq("id", seed.periodIds[0]);
    expect(error?.code).toBe("23503");
    expect(await periodsOf(seed.semesterId)).toHaveLength(2);
    expect(await reportCountOf(seed.periodIds[0])).toBe(1);
  });

  it("save_periods 只開給 service_role", async () => {
    const { withRawPg } = await import("./helpers");
    const sig = "save_periods(uuid, jsonb, boolean, jsonb)";
    await withRawPg(async (client) => {
      for (const role of ["anon", "authenticated"]) {
        const res = await client.query("select has_function_privilege($1, $2, 'execute') as ok", [role, sig]);
        expect(res.rows[0].ok, role).toBe(false);
      }
      const svc = await client.query("select has_function_privilege('service_role', $1, 'execute') as ok", [sig]);
      expect(svc.rows[0].ok).toBe(true);
      const def = await client.query(
        "select prosecdef, proconfig from pg_proc where oid = to_regprocedure($1)",
        [sig]
      );
      expect(def.rows[0].prosecdef).toBe(true);
      expect(def.rows[0].proconfig).toContain("search_path=public");
    });
  });
});

describe("previewPeriodDeletion", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("回傳每一期的編號與交件組數", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { previewPeriodDeletion } = await import("@/server/actions/admin");
    const r = await previewPeriodDeletion([seed.periodIds[0], seed.periodIds[1]]);
    expect(r).toEqual([
      { periodId: seed.periodIds[0], seq: 1, reportCount: 1 },
      { periodId: seed.periodIds[1], seq: 2, reportCount: 0 },
    ]);
  });

  it("空陣列回空陣列", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { previewPeriodDeletion } = await import("@/server/actions/admin");
    expect(await previewPeriodDeletion([])).toEqual([]);
  });

  // Fix round 1 F3：資料庫錯誤要包成真的 Error，畫面才顯示得出訊息（不是退回「儲存失敗」）。
  it("資料庫錯誤（格式錯的 id）丟出的是 Error，訊息是資料庫的訊息", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { previewPeriodDeletion } = await import("@/server/actions/admin");
    const err = await previewPeriodDeletion(["not-a-uuid"]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/uuid/);
  });

  it("非管理員被拒", async () => {
    const seed = await seedSemester();
    asStudent(seed.semesterId);
    const { previewPeriodDeletion } = await import("@/server/actions/admin");
    await expect(previewPeriodDeletion([seed.periodIds[0]])).rejects.toThrow("只有系統管理員可以這樣做");
  });
});

describe("setPmGroups", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("取代該專案幹部原本的負責組別", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: pm } = await svc.from("members").select("id").eq("semester_id", seed.semesterId).eq("role", "pm").single();
    const { setPmGroups } = await import("@/server/actions/admin");

    await setPmGroups(pm!.id, [seed.groupA]);
    let { data: assigns } = await svc.from("pm_assignments").select("group_id").eq("pm_member_id", pm!.id);
    expect(assigns).toEqual([{ group_id: seed.groupA }]);

    await setPmGroups(pm!.id, [seed.groupB]);
    ({ data: assigns } = await svc.from("pm_assignments").select("group_id").eq("pm_member_id", pm!.id));
    expect(assigns).toEqual([{ group_id: seed.groupB }]);
  });

  it("對「其他幹部」呼叫要丟錯", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: officer } = await svc.from("members").select("id").eq("semester_id", seed.semesterId).eq("role", "officer").single();
    const { setPmGroups } = await import("@/server/actions/admin");
    await expect(setPmGroups(officer!.id, [seed.groupA])).rejects.toThrow("只有專案幹部才能負責組別");
  });

  it("組別不屬於這位幹部的學期時丟錯，而且原本的指派不受影響", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: pm } = await svc.from("members").select("id").eq("semester_id", seed.semesterId).eq("role", "pm").single();
    const { setPmGroups } = await import("@/server/actions/admin");

    // 先指派一個合法的組別，作為「原本的指派」的基準。
    await setPmGroups(pm!.id, [seed.groupA]);

    const { data: otherSem } = await svc.from("semesters").insert({ name: "115-2" }).select("id").single();
    const { data: otherGroup } = await svc
      .from("groups")
      .insert({ semester_id: otherSem!.id, name: "第1組", project_name: "X" })
      .select("id")
      .single();

    await expect(setPmGroups(pm!.id, [seed.groupB, otherGroup!.id])).rejects.toThrow("組別不屬於本學期");

    const { data: assigns } = await svc.from("pm_assignments").select("group_id").eq("pm_member_id", pm!.id);
    expect(assigns).toEqual([{ group_id: seed.groupA }]);
  });
  // 最終審查 M1：set_pm_groups() 先讀信箱、再拿那個信箱的鎖。等鎖期間信箱被改掉（admin_edit_person）
  // 時，要換成新信箱的鎖重新排隊，才會跟「用新信箱移除這個人」真的排隊；否則會在移除之前插入指派，
  // 留下一個已離開的專案幹部還負責組別。
  //   A：拿舊信箱的鎖、把信箱改成新信箱（未 commit）。
  //   B：拿新信箱的鎖（未 commit）。
  //   setPmGroups：讀到舊信箱 → 等 A 的鎖 → A commit → 重讀發現信箱變了 → 必須再等 B 的鎖。
  //   B：把這個人標已離開、刪負責組別、commit → setPmGroups 看到已離開而失敗。
  it("等鎖期間信箱被改掉：換新信箱的鎖重新排隊，不會替已離開的專案幹部留下指派", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: pm } = await svc.from("members").select("id").eq("semester_id", seed.semesterId).eq("role", "pm").single();
    const oldEmail = "pm@g.nccu.edu.tw";
    const newEmail = "pm-new@g.nccu.edu.tw";
    const lockSql = "select pg_advisory_xact_lock(hashtext('member:' || $1 || ':' || $2))";

    const host = new URL(env.supabaseUrl).hostname;
    const a = new PgClient({ host, port: 54322, user: "postgres", password: "postgres", database: "postgres" });
    const b = new PgClient({ host, port: 54322, user: "postgres", password: "postgres", database: "postgres" });
    await a.connect();
    await b.connect();
    try {
      await a.query("begin");
      await a.query(lockSql, [seed.semesterId, oldEmail]);
      await a.query("update members set email = $1 where id = $2", [newEmail, pm!.id]);
      await b.query("begin");
      await b.query(lockSql, [seed.semesterId, newEmail]);

      const { setPmGroups } = await import("@/server/actions/admin");
      const assigning = setPmGroups(pm!.id, [seed.groupA]).then(
        () => ({ ok: true as const }),
        (e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) })
      );

      await waitUntilWaitingOnAdvisoryHeldBy(a);
      await a.query("commit");
      await waitUntilWaitingOnAdvisoryHeldBy(b);
      await b.query("update members set left_at = now() where id = $1", [pm!.id]);
      await b.query("delete from pm_assignments where pm_member_id = $1", [pm!.id]);
      await b.query("commit");

      expect(await assigning).toEqual({ ok: false, message: "這位專案幹部已離開" });
    } finally {
      await a.end();
      await b.end();
    }

    const { data: assigns } = await svc.from("pm_assignments").select("group_id").eq("pm_member_id", pm!.id);
    expect(assigns).toEqual([]);
  });
});

describe("setRedAfterHours", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("接受邊界值 1 和 720", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { setRedAfterHours } = await import("@/server/actions/admin");
    const svc = createServiceSupabase();

    await setRedAfterHours(seed.semesterId, 1);
    let { data } = await svc.from("semesters").select("red_after_hours").eq("id", seed.semesterId).single();
    expect(data?.red_after_hours).toBe(1);

    await setRedAfterHours(seed.semesterId, 720);
    ({ data } = await svc.from("semesters").select("red_after_hours").eq("id", seed.semesterId).single());
    expect(data?.red_after_hours).toBe(720);
  });

  it("拒絕邊界外的 0、721，以及非整數", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { setRedAfterHours } = await import("@/server/actions/admin");
    await expect(setRedAfterHours(seed.semesterId, 0)).rejects.toThrow("紅燈門檻必須是 1 到 720 之間的整數小時");
    await expect(setRedAfterHours(seed.semesterId, 721)).rejects.toThrow("紅燈門檻必須是 1 到 720 之間的整數小時");
    await expect(setRedAfterHours(seed.semesterId, 1.5)).rejects.toThrow("紅燈門檻必須是 1 到 720 之間的整數小時");
  });
});

describe("moveMember", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("換組後，舊組的進度紀錄仍在舊組", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: a1 } = await svc.from("members").select("id").eq("semester_id", seed.semesterId).eq("email", "a1@g.nccu.edu.tw").single();
    const { moveMember } = await import("@/server/actions/admin");

    await moveMember(a1!.id, seed.groupB);

    const { data: member } = await svc.from("members").select("group_id").eq("id", a1!.id).single();
    expect(member?.group_id).toBe(seed.groupB);

    const { data: report } = await svc
      .from("progress_reports")
      .select("submitted_by")
      .eq("line_id", seed.lineA)
      .eq("period_id", seed.periodIds[0])
      .single();
    expect(report?.submitted_by).toBe("a1@g.nccu.edu.tw");
  });

  it("移動非專案生會丟錯", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: pm } = await svc.from("members").select("id").eq("semester_id", seed.semesterId).eq("role", "pm").single();
    const { moveMember } = await import("@/server/actions/admin");
    await expect(moveMember(pm!.id, seed.groupB)).rejects.toThrow("只有專案生可以換組");
  });

  it("目標組別不在同一個學期會丟錯", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: otherSem } = await svc.from("semesters").insert({ name: "115-2" }).select("id").single();
    const { data: otherGroup } = await svc.from("groups").insert({ semester_id: otherSem!.id, name: "第1組", project_name: "X" }).select("id").single();
    const { data: a1 } = await svc.from("members").select("id").eq("semester_id", seed.semesterId).eq("email", "a1@g.nccu.edu.tw").single();
    const { moveMember } = await import("@/server/actions/admin");
    await expect(moveMember(a1!.id, otherGroup!.id)).rejects.toThrow("目標組別必須在同一個學期");
  });

  // F2：pre-check 跟真正的 update 之間有一個小競速窗口（例如兩個管理員幾乎同時把同一個人
  // 搬進同一組）。這裡先真的在 DB 插入一列衝突資料，再讓 moveMember 內部那次 pre-check
  // 查詢騙自己「沒看到衝突」（模擬 pre-check 查完之後、衝突列才出現的時間點），逼它繼續跑到
  // 真正的 update；update 因為 DB 已經有衝突列，會撞到真正的 members_identity_key 23505。
  // 確認 moveMember 把這個 23505 轉成跟 pre-check 分支一樣好懂的訊息，而不是把 raw error
  // 丟給呼叫端。
  // 最終審查 I1 之後：pre-check 與 update 都搬進 admin_move_member() 同一個交易、拿同一把
  // advisory lock，moveMember 不再用 from("members") 查詢，下面這個 proxy 已經攔不到任何東西；
  // 保留這個測試是為了確認「目標組已有還在的身份」仍回同一句訊息（函式也有 unique_violation
  // → 同一句訊息的保險）。
  it("update 階段才撞到 23505（競速）時，也回這位同學已經在第N組了，不是 raw error", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const realSvc = createServiceSupabase();
    const { data: a1 } = await realSvc
      .from("members")
      .select("id")
      .eq("semester_id", seed.semesterId)
      .eq("email", "a1@g.nccu.edu.tw")
      .single();

    // 真的讓目標組已經有衝突列（a1 已經是第2組的專案生）。
    const { error: insertError } = await realSvc
      .from("members")
      .insert({ semester_id: seed.semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student", group_id: seed.groupB });
    expect(insertError).toBeNull();

    vi.resetModules();
    vi.doMock("@/server/supabase", () => ({
      createServiceSupabase: () => {
        let precheckAnswered = false;
        return new Proxy(realSvc, {
          get(target, prop, receiver) {
            if (prop !== "from") return Reflect.get(target, prop, receiver);
            return (table: string) => {
              const builder = (target.from as (t: string) => ReturnType<typeof realSvc.from>)(table);
              if (table !== "members" || precheckAnswered) return builder;
              const originalSelect = (builder as unknown as { select: (...a: unknown[]) => unknown }).select.bind(builder);
              return Object.assign(builder, {
                select: (...args: unknown[]) => {
                  const chain = originalSelect(...args) as { maybeSingle: () => Promise<unknown> };
                  return Object.assign(chain, {
                    // pre-check 用 maybeSingle()；騙它這次沒查到任何衝突列，模擬 pre-check
                    // 執行的當下（在真正插入衝突列之前）確實看不到衝突的競速情境。
                    maybeSingle: async () => {
                      precheckAnswered = true;
                      return { data: null, error: null };
                    },
                  });
                },
              });
            };
          },
        });
      },
    }));

    const { moveMember } = await import("@/server/actions/admin");
    await expect(moveMember(a1!.id, seed.groupB)).rejects.toThrow("這位同學已經在第2組了");

    vi.doUnmock("@/server/supabase");
    vi.resetModules();
  });

  // §14：moveMember 只搬動那一列。如果這個人在目標組已經有另一列專案生身份，
  // 搬過去會撞 members_identity_key，要回一句看得懂的錯誤，而不是資料庫的 23505。
  it("同一人在目標組已有專案生身份 → 這位同學已經在第N組了", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: a1 } = await svc.from("members").select("id").eq("semester_id", seed.semesterId).eq("email", "a1@g.nccu.edu.tw").single();
    // 讓 a1 同時也是第2組的專案生（多列身份）。
    const { error: insertError } = await svc
      .from("members")
      .insert({ semester_id: seed.semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student", group_id: seed.groupB });
    expect(insertError).toBeNull();

    const { moveMember } = await import("@/server/actions/admin");
    await expect(moveMember(a1!.id, seed.groupB)).rejects.toThrow("這位同學已經在第2組了");
  });

  // F5(b)：moveMember 只搬動被指定的那一列，這個人在其他組的另一列身份要維持原樣
  // （group_id、student_id、dept_year 都不能被動到）。
  it("換組後，這個人在其他組的另一列身份不受影響", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: a1 } = await svc
      .from("members")
      .select("id")
      .eq("semester_id", seed.semesterId)
      .eq("email", "a1@g.nccu.edu.tw")
      .single();
    // 讓 a1 同時也是第2組的專案生（多列身份），這一列跟被搬動的那一列不同 id。
    const { data: otherRow, error: insertError } = await svc
      .from("members")
      .insert({
        semester_id: seed.semesterId,
        email: "a1@g.nccu.edu.tw",
        name: "甲一",
        role: "student",
        student_id: "110701001",
        dept_year: "資科三",
        group_id: seed.groupB,
      })
      .select("id, group_id, student_id, dept_year")
      .single();
    expect(insertError).toBeNull();

    // 建第三組，把 a1 原本第1組那一列搬過去；第2組那一列（otherRow）不該被動到。
    const { data: groupC } = await svc.from("groups").insert({ semester_id: seed.semesterId, name: "第3組", project_name: "專案C" }).select("id").single();

    const { moveMember } = await import("@/server/actions/admin");
    await moveMember(a1!.id, groupC!.id);

    const { data: movedRow } = await svc.from("members").select("id, group_id").eq("id", a1!.id).single();
    expect(movedRow?.group_id).toBe(groupC!.id);

    const { data: untouchedRow } = await svc
      .from("members")
      .select("id, group_id, student_id, dept_year")
      .eq("id", otherRow!.id)
      .single();
    expect(untouchedRow).toEqual(otherRow);
  });

  // Task 8 folded-in fix（Task 7 review minor 2）：目標組已有這個人「已離開」的那一列身份
  // （不是還在的）——不該被擋下來說「已經在第2組了」，也不該讓 update 直接撞
  // members_identity_key 的 23505。挑最簡單但正確的作法：把目標組那筆已離開的列恢復（清掉
  // left_at，姓名／學號／系級同步成被搬動那列目前的值），原本第1組那一列改標已離開——這個人
  // 的「第2組專案生」身份本來就一直存在資料庫裡（只是離開過），恢復它比讓兩列同時佔用同一個
  // identity key 更合理，也跟 admin_add_member() 對「已離開的身份再新增一次＝恢復」的規則一致。
  it("目標組已有這個人已離開的身份 → 恢復那一列，原本那列改標已離開", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: a1 } = await svc
      .from("members")
      .select("id, name")
      .eq("semester_id", seed.semesterId)
      .eq("email", "a1@g.nccu.edu.tw")
      .eq("role", "student")
      .single();
    // a1 在第2組留了一列已離開的身份（例如之前換組留下的舊列）。
    const { data: leftRow, error: insertError } = await svc
      .from("members")
      .insert({
        semester_id: seed.semesterId,
        email: "a1@g.nccu.edu.tw",
        name: "甲一",
        role: "student",
        group_id: seed.groupB,
        left_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    expect(insertError).toBeNull();

    const { moveMember } = await import("@/server/actions/admin");
    await moveMember(a1!.id, seed.groupB);

    const { data: restored } = await svc.from("members").select("group_id, left_at").eq("id", leftRow!.id).single();
    expect(restored?.group_id).toBe(seed.groupB);
    expect(restored?.left_at).toBeNull();

    const { data: original } = await svc.from("members").select("left_at").eq("id", a1!.id).single();
    expect(original?.left_at).not.toBeNull();
  });

  // 最終審查 M5：恢復的那一列要同步成被搬動那一列目前的姓名／學號／系級；這個人其他的身份列
  // （例如兼其他幹部）與別人的列都不能被動到。
  it("恢復已離開的身份：姓名／學號／系級同步；同一信箱的其他身份列與別人的列不受影響", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: a1 } = await svc
      .from("members")
      .update({ name: "甲一新", student_id: "110701001", dept_year: "資科三" })
      .eq("semester_id", seed.semesterId)
      .eq("email", "a1@g.nccu.edu.tw")
      .eq("role", "student")
      .select("id")
      .single();
    const { data: officerRow } = await svc
      .from("members")
      .insert({ semester_id: seed.semesterId, email: "a1@g.nccu.edu.tw", name: "甲一新", role: "officer", student_id: "110701001", dept_year: "資科三" })
      .select("*")
      .single();
    const { data: leftRow } = await svc
      .from("members")
      .insert({
        semester_id: seed.semesterId,
        email: "a1@g.nccu.edu.tw",
        name: "甲一舊",
        role: "student",
        student_id: "舊學號",
        dept_year: "舊系級",
        group_id: seed.groupB,
        left_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    const { data: othersBefore } = await svc
      .from("members")
      .select("*")
      .eq("semester_id", seed.semesterId)
      .neq("email", "a1@g.nccu.edu.tw")
      .order("id");

    const { moveMember } = await import("@/server/actions/admin");
    await moveMember(a1!.id, seed.groupB);

    const { data: restored } = await svc
      .from("members")
      .select("name, student_id, dept_year, group_id, left_at")
      .eq("id", leftRow!.id)
      .single();
    expect(restored).toEqual({ name: "甲一新", student_id: "110701001", dept_year: "資科三", group_id: seed.groupB, left_at: null });

    const { data: officerAfter } = await svc.from("members").select("*").eq("id", officerRow!.id).single();
    expect(officerAfter).toEqual(officerRow);

    const { data: othersAfter } = await svc
      .from("members")
      .select("*")
      .eq("semester_id", seed.semesterId)
      .neq("email", "a1@g.nccu.edu.tw")
      .order("id");
    expect(othersAfter).toEqual(othersBefore);
  });

  // 最終審查 I1：恢復＋把原本那列標已離開必須在同一個交易裡。用一個暫時的 trigger 讓「第二步」
  // （把原本那列標成已離開）一定失敗：整個動作要回滾，目標組那列仍是已離開、原本那列仍然還在，
  // 不會出現同一個人同時在兩組都「還在」的狀態。
  it("恢復途中第二步失敗 → 整批回滾，不會留下兩組都還在的半套狀態", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: a1 } = await svc
      .from("members")
      .select("id")
      .eq("semester_id", seed.semesterId)
      .eq("email", "a1@g.nccu.edu.tw")
      .eq("role", "student")
      .single();
    const { data: leftRow } = await svc
      .from("members")
      .insert({ semester_id: seed.semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student", group_id: seed.groupB, left_at: new Date().toISOString() })
      .select("id, left_at")
      .single();

    await withRawPg(async (c) => {
      await c.query(`create or replace function test_fail_second_step() returns trigger language plpgsql as $$
        begin
          if old.id = '${a1!.id}'::uuid and new.left_at is not null then
            raise exception 'forced failure on second step';
          end if;
          return new;
        end $$`);
      await c.query(`create trigger test_fail_second_step before update on members for each row execute function test_fail_second_step()`);
    });
    try {
      const { moveMember } = await import("@/server/actions/admin");
      await expect(moveMember(a1!.id, seed.groupB)).rejects.toThrow();
    } finally {
      await withRawPg(async (c) => {
        await c.query("drop trigger if exists test_fail_second_step on members");
        await c.query("drop function if exists test_fail_second_step()");
      });
    }

    const { data: target } = await svc.from("members").select("left_at").eq("id", leftRow!.id).single();
    expect(target?.left_at).not.toBeNull();
    const { data: source } = await svc.from("members").select("group_id, left_at").eq("id", a1!.id).single();
    expect(source).toEqual({ group_id: seed.groupA, left_at: null });
  });

  // 最終審查 I1：換組要跟其他成員寫入動作共用同一把 'member:<學期>:<信箱>' advisory lock。
  // 模擬「移除整個人」正在進行（拿著鎖、已把這個人所有身份標成已離開、還沒 commit），這時候
  // 換組（恢復路徑）要排隊；等移除 commit 之後，換組看到原本那列已離開而失敗，不能把目標組那列
  // 重新啟用、讓「整個人已移除」的人還留在某一組。
  it("跟移除整個人同時進行：換組排隊等鎖，之後看到已離開而失敗，不會把人加回", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: a1 } = await svc
      .from("members")
      .select("id")
      .eq("semester_id", seed.semesterId)
      .eq("email", "a1@g.nccu.edu.tw")
      .eq("role", "student")
      .single();
    const { data: leftRow } = await svc
      .from("members")
      .insert({ semester_id: seed.semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student", group_id: seed.groupB, left_at: new Date().toISOString() })
      .select("id")
      .single();

    const host = new URL(env.supabaseUrl).hostname;
    const remover = new PgClient({ host, port: 54322, user: "postgres", password: "postgres", database: "postgres" });
    await remover.connect();
    try {
      await remover.query("begin");
      await remover.query("select pg_advisory_xact_lock(hashtext('member:' || $1 || ':' || $2))", [seed.semesterId, "a1@g.nccu.edu.tw"]);
      await remover.query("update members set left_at = now() where semester_id = $1 and email = $2 and left_at is null", [
        seed.semesterId,
        "a1@g.nccu.edu.tw",
      ]);

      const { moveMember } = await import("@/server/actions/admin");
      const moving = moveMember(a1!.id, seed.groupB).then(
        () => ({ ok: true as const }),
        (e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) })
      );
      await waitUntilSomeoneWaitsOnLock();
      await remover.query("commit");

      expect(await moving).toEqual({ ok: false, message: "這個身份已離開" });
    } finally {
      await remover.end();
    }

    const { data: target } = await svc.from("members").select("left_at").eq("id", leftRow!.id).single();
    expect(target?.left_at).not.toBeNull();
  });

  // F3：舊資料相容——沒有學號、系級的既有成員（seedSemester() 種子資料本來就是這樣）換組
  // 仍要成功，管理員頁名單查詢（select ... student_id ...）也不會被 null 值弄壞。
  it("成員沒有學號、系級（舊資料）時，換組仍成功，名單查詢也不出錯", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: a1 } = await svc
      .from("members")
      .select("id, student_id, dept_year")
      .eq("semester_id", seed.semesterId)
      .eq("email", "a1@g.nccu.edu.tw")
      .single();
    expect(a1?.student_id).toBeNull();
    expect(a1?.dept_year).toBeNull();

    const { moveMember } = await import("@/server/actions/admin");
    await moveMember(a1!.id, seed.groupB);

    const { data: moved } = await svc.from("members").select("group_id, student_id, dept_year").eq("id", a1!.id).single();
    expect(moved).toEqual({ group_id: seed.groupB, student_id: null, dept_year: null });

    // 管理員頁換組選單用的查詢（src/app/(app)/admin/page.tsx）：對 null 學號的列也要正常回傳。
    const { data: roster, error: rosterError } = await svc
      .from("members")
      .select("id, name, email, role, student_id, group_id")
      .eq("semester_id", seed.semesterId)
      .order("name");
    expect(rosterError).toBeNull();
    expect(roster?.some((m) => m.id === a1!.id && m.student_id === null)).toBe(true);
  });
});

// F5(a)：members_identity_key 唯一索引要真的擋住 DB 層面的重複身份，不只是靠應用層的
// pre-check。幹部（role=officer）沒有組別，group_id 是 null；index 用 coalesce 把 null
// 也當成可比較的值，同一學期、同一信箱、同一角色、group 都是 null 的第二列必須被拒絕。
describe("members_identity_key 唯一索引", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("同一學期、同信箱、同角色（其他幹部）、組別都是 null，插入第二列會被唯一索引擋下來", async () => {
    const seed = await seedSemester();
    const svc = createServiceSupabase();

    const { error: firstError } = await svc
      .from("members")
      .insert({ semester_id: seed.semesterId, email: "dup-officer@g.nccu.edu.tw", name: "重複幹部", role: "officer", group_id: null });
    expect(firstError).toBeNull();

    const { error: secondError } = await svc
      .from("members")
      .insert({ semester_id: seed.semesterId, email: "dup-officer@g.nccu.edu.tw", name: "重複幹部", role: "officer", group_id: null });
    expect(secondError?.code).toBe("23505");
  });
});
