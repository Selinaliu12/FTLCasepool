import { beforeEach, describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resetDb, seedSemester, service, clientAs } from "./helpers";

// Adjustments Task 3 Review Focus 1（＋規格 §14 第 4 點）：寫入動作與頁面依「目前身份」。
// 這裡用真的 getAccess()（讀 cookie ftl_identity、對照名單），只把 Next 的 cookie store、
// redirect、revalidatePath 與 R2 換成替身；createServerSupabase() 換成 clientAs() 簽出來的
// 真實登入連線，讓 RLS（所有身份的聯集）真的跑。

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/r2", () => ({
  presignPdfPut: async () => "https://r2.test/put",
  presignPdfGet: async () => "https://r2.test/get",
  inspectUploaded: async () => ({ size: 2048, isPdf: true }),
  deleteObject: async () => undefined,
}));

let currentClient: SupabaseClient | null = null;
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return {
    ...actual,
    createServerSupabase: async () => {
      if (!currentClient) throw new Error("test did not log in");
      return currentClient;
    },
  };
});

async function login(email: string, identity?: string) {
  currentClient = await clientAs(email);
  jar.clear();
  if (identity) jar.set("ftl_identity", identity);
}

let seed: Awaited<ReturnType<typeof seedSemester>>;
let groupC: string;
let lineC: string;
let multiA: string;
let multiC: string;

beforeEach(async () => {
  await resetDb();
  seed = await seedSemester({ acknowledged: true });
  const db = service();
  // seed 的期別寫死在 2026-10／11，日期過了第3組就會亮燈；這裡移到未來，測的是換組而不是逾期。
  await db.from("periods").update({ deadline: "2099-10-01T00:00:00Z" }).eq("id", seed.periodIds[0]);
  await db.from("periods").update({ deadline: "2099-11-01T00:00:00Z" }).eq("id", seed.periodIds[1]);
  const { data: g, error: gErr } = await db
    .from("groups")
    .insert({ semester_id: seed.semesterId, name: "第3組", project_name: "專案C" })
    .select()
    .single();
  if (gErr) throw gErr;
  groupC = g.id as string;
  const { data: l, error: lErr } = await db.from("lines").insert({ group_id: groupC, kind: "project" }).select().single();
  if (lErr) throw lErr;
  lineC = l.id as string;

  const { data: rows, error: mErr } = await db
    .from("members")
    .insert([
      { semester_id: seed.semesterId, email: "multi@g.nccu.edu.tw", name: "多組", role: "student", group_id: seed.groupA },
      { semester_id: seed.semesterId, email: "multi@g.nccu.edu.tw", name: "多組", role: "student", group_id: groupC },
    ])
    .select("id, group_id");
  if (mErr) throw mErr;
  multiA = rows!.find((r) => r.group_id === seed.groupA)!.id as string;
  multiC = rows!.find((r) => r.group_id === groupC)!.id as string;
  const { error: ackErr } = await db.from("acknowledgements").insert({ semester_id: seed.semesterId, email: "multi@g.nccu.edu.tw" });
  if (ackErr) throw ackErr;
});

describe("多組學生切換身份後，組頁、燈號、上傳、交件都跟著換組", () => {
  it("目前身份第1組 → 組頁是第1組；切到第3組 → 組頁、燈號、上傳 key、點燈、交進度都落在第3組", async () => {
    const { loadMyGroup } = await import("@/server/queries/my-group");
    const { requestPdfUpload } = await import("@/server/actions/upload");
    const { submitCheckin } = await import("@/server/actions/checkin");
    const { submitProgress } = await import("@/server/actions/progress");

    await login("multi@g.nccu.edu.tw");
    expect((await loadMyGroup()).groupName).toBe("第1組");

    await login("multi@g.nccu.edu.tw", multiC);
    const page = await loadMyGroup();
    expect(page.groupName).toBe("第3組");
    expect(page.lineId).toBe(lineC);
    // 第3組沒有任何回報、也還沒逾期（期別在 beforeEach 移到 2099）→ 綠燈；第1組 seed 有一筆紅燈點燈。
    expect(page.display.light).toBe("green");

    const upload = await requestPdfUpload({ name: "a.pdf", type: "application/pdf", size: 2048 });
    if (!upload.ok) throw new Error(upload.error);
    expect(upload.key.startsWith(`115-1/${groupC}/`)).toBe(true);

    expect(await submitCheckin({ light: "yellow", note: "" })).toEqual({ ok: true });
    const db = service();
    const { data: checkinsC } = await db.from("checkins").select("light, created_by").eq("line_id", lineC);
    expect(checkinsC).toEqual([{ light: "yellow", created_by: "multi@g.nccu.edu.tw" }]);
    const { data: checkinsA } = await db.from("checkins").select("id").eq("line_id", seed.lineA).eq("created_by", "multi@g.nccu.edu.tw");
    expect(checkinsA).toEqual([]);

    const result = await submitProgress(seed.periodIds[1], {
      light: "green",
      did: "第3組的進度",
      blocked: "無",
      nextSteps: "繼續",
      pdfKey: upload.key,
    });
    expect(result).toEqual({ ok: true });
    const { data: reportsC } = await db.from("progress_reports").select("did").eq("line_id", lineC).eq("period_id", seed.periodIds[1]);
    expect(reportsC).toEqual([{ did: "第3組的進度" }]);
    const { data: reportsA } = await db.from("progress_reports").select("id").eq("line_id", seed.lineA).eq("period_id", seed.periodIds[1]);
    expect(reportsA).toEqual([]);

    // 燈號跟著換組：第3組的組頁看得到剛剛的點燈與進度（進度是最新的一筆）。
    const after = await loadMyGroup();
    expect(after.latestReport?.light).toBe("green");
    expect(after.checkins.map((c) => c.light)).toEqual(["yellow"]);
  });

  it("目前身份第3組：拿第1組的上傳 key 交進度 → 檔案沒有上傳成功（key 前綴依目前身份）", async () => {
    await login("multi@g.nccu.edu.tw", multiA);
    const { requestPdfUpload } = await import("@/server/actions/upload");
    const upload = await requestPdfUpload({ name: "a.pdf", type: "application/pdf", size: 2048 });
    if (!upload.ok) throw new Error(upload.error);
    expect(upload.key.startsWith(`115-1/${seed.groupA}/`)).toBe(true);

    await login("multi@g.nccu.edu.tw", multiC);
    const { submitProgress } = await import("@/server/actions/progress");
    const result = await submitProgress(seed.periodIds[1], {
      light: "green",
      did: "x",
      blocked: "x",
      nextSteps: "x",
      pdfKey: upload.key,
    });
    expect(result).toEqual({ ok: false, error: "檔案沒有上傳成功，請重新選擇 PDF" });
  });

  it("比賽報名依目前身份：切到第3組掛比賽 → 報名屬於第3組", async () => {
    const db = service();
    const { data: comp, error } = await db
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "黑客松",
        url: "https://example.com",
        signup_deadline: "2099-10-01T15:59:59.999Z",
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (error) throw error;

    await login("multi@g.nccu.edu.tw", multiC);
    const { attachCompetition } = await import("@/server/actions/entries");
    const res = await attachCompetition(comp.id as string);
    if (!res.ok) throw new Error(res.error);
    const { data: entry } = await db.from("competition_entries").select("group_id").eq("id", res.entryId).single();
    expect(entry?.group_id).toBe(groupC);

    const { loadMyGroupEntries } = await import("@/server/queries/entries");
    expect((await loadMyGroupEntries()).map((e) => e.entryId)).toEqual([res.entryId]);
    await login("multi@g.nccu.edu.tw", multiA);
    expect(await loadMyGroupEntries()).toEqual([]);
  });
});

describe("切換後打開舊組的學生網址被擋（跟別組一樣的找不到）", () => {
  it("切到第3組後：第1組的報名頁、進度修改、組別內容頁、PDF 下載、階段上傳一律找不到", async () => {
    const db = service();
    const { data: comp } = await db
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "黑客松",
        url: "https://example.com",
        signup_deadline: "2099-10-01T15:59:59.999Z",
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    const { data: entryA } = await db
      .from("competition_entries")
      .insert({ group_id: seed.groupA, competition_id: comp!.id, created_by: "multi@g.nccu.edu.tw" })
      .select()
      .single();
    const { data: reportA } = await db.from("progress_reports").select("id").eq("line_id", seed.lineA).single();

    const { loadEntryDetail } = await import("@/server/queries/entries");
    const { editProgress } = await import("@/server/actions/progress");
    const { loadGroupDetail } = await import("@/server/queries/group-detail");
    const { getPdfDownloadUrl } = await import("@/server/actions/download");
    const { submitStage } = await import("@/server/actions/stages");

    // 目前身份第1組：都看得到／做得到（對照組，證明擋下來的原因是身份不是資料）。
    await login("multi@g.nccu.edu.tw", multiA);
    expect(await loadEntryDetail(entryA!.id as string)).not.toBeNull();
    expect(await loadGroupDetail(seed.groupA)).not.toBeNull();
    expect((await getPdfDownloadUrl(reportA!.id as string)).ok).toBe(true);

    await login("multi@g.nccu.edu.tw", multiC);
    expect(await loadEntryDetail(entryA!.id as string)).toBeNull();
    expect(await loadGroupDetail(seed.groupA)).toBeNull();
    expect(await getPdfDownloadUrl(reportA!.id as string)).toEqual({ ok: false, error: "找不到這份進度" });
    expect(await editProgress(reportA!.id as string, { light: "red", did: "x", blocked: "卡住", nextSteps: "x" })).toEqual({
      ok: false,
      error: "找不到這份進度",
    });
    expect(await submitStage(entryA!.id as string, "signup", `115-1/${seed.groupA}/x.pdf`)).toEqual({
      ok: false,
      error: "找不到這筆繳交",
    });
    // 自己目前這組照樣看得到。
    expect(await loadGroupDetail(groupC)).not.toBeNull();
  });
});

describe("規格 §14 第 4 點：專案幹部同時是該組組員，可以審自己組", () => {
  it("第2組專案生兼負責第2組的專案幹部：目前身份是專案幹部 → 待審清單有它、可以通過；目前身份是專案生 → 不能審", async () => {
    const db = service();
    const { data: rows, error } = await db
      .from("members")
      .insert([
        { semester_id: seed.semesterId, email: "stupm@g.nccu.edu.tw", name: "學生兼幹部", role: "student", group_id: seed.groupB },
        { semester_id: seed.semesterId, email: "stupm@g.nccu.edu.tw", name: "學生兼幹部", role: "pm", group_id: null },
      ])
      .select("id, role");
    if (error) throw error;
    const pmId = rows!.find((r) => r.role === "pm")!.id as string;
    const studentId = rows!.find((r) => r.role === "student")!.id as string;
    await db.from("acknowledgements").insert({ semester_id: seed.semesterId, email: "stupm@g.nccu.edu.tw" });
    await db.from("pm_assignments").insert({ pm_member_id: pmId, group_id: seed.groupB });

    const { data: comp } = await db
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "黑客松",
        url: "https://example.com",
        signup_deadline: "2099-10-01T15:59:59.999Z",
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    const { data: entry } = await db
      .from("competition_entries")
      .insert({ group_id: seed.groupB, competition_id: comp!.id, created_by: "b1@g.nccu.edu.tw", confirmed_at: new Date().toISOString() })
      .select()
      .single();
    const { data: line } = await db.from("lines").insert({ group_id: seed.groupB, kind: "competition", entry_id: entry!.id }).select().single();
    const { data: submission, error: sErr } = await db
      .from("stage_submissions")
      .insert({
        line_id: line!.id,
        stage: "signup",
        version: 1,
        pdf_key: `115-1/${seed.groupB}/signup.pdf`,
        pdf_size: 1024,
        pdf_uploaded_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        pdf_uploaded_by: "stupm@g.nccu.edu.tw",
        submitted_by: "stupm@g.nccu.edu.tw",
        review_status: "pending",
      })
      .select()
      .single();
    if (sErr) throw sErr;

    const { reviewStage } = await import("@/server/actions/stages");
    const { loadReviewQueue } = await import("@/server/queries/review-queue");

    // 目前身份是專案生：不是審核者。
    await login("stupm@g.nccu.edu.tw", studentId);
    expect(await loadReviewQueue()).toEqual([]);
    expect(await reviewStage(submission.id as string, "approved", null)).toEqual({ ok: false, error: "找不到這筆繳交" });

    // 目前身份是專案幹部（沒有 cookie 時第一個合法身份也是它）：審自己組允許。
    await login("stupm@g.nccu.edu.tw");
    expect((await loadReviewQueue()).map((i) => i.submissionId)).toEqual([submission.id]);
    expect(await reviewStage(submission.id as string, "approved", null)).toEqual({ ok: true });
    const { data: reviewed } = await db.from("stage_submissions").select("review_status, reviewed_by").eq("id", submission.id).single();
    expect(reviewed).toEqual({ review_status: "approved", reviewed_by: "stupm@g.nccu.edu.tw" });
  });
});
