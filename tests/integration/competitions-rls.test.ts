import { beforeAll, describe, it, expect } from "vitest";
import { resetDb, seedSemester, clientAs } from "./helpers";
import { createServiceSupabase } from "../../src/server/supabase";

let seed: Awaited<ReturnType<typeof seedSemester>>;
let draftId: string;
let publishedId: string;

beforeAll(async () => {
  await resetDb();
  seed = await seedSemester();

  const db = createServiceSupabase();
  const { data: draft, error: draftError } = await db
    .from("competitions")
    .insert({
      semester_id: seed.semesterId,
      name: "草稿賽",
      url: "https://example.com/draft",
      signup_deadline: "2026-12-01T15:59:59.999Z",
      status: "draft",
      created_by: "pm@g.nccu.edu.tw",
    })
    .select()
    .single();
  if (draftError) throw draftError;
  draftId = draft.id as string;

  const { data: published, error: publishedError } = await db
    .from("competitions")
    .insert({
      semester_id: seed.semesterId,
      name: "已發布賽",
      url: "https://example.com/published",
      signup_deadline: "2026-12-01T15:59:59.999Z",
      status: "published",
      created_by: "pm@g.nccu.edu.tw",
    })
    .select()
    .single();
  if (publishedError) throw publishedError;
  publishedId = published.id as string;
});

describe("RLS：competitions", () => {
  it("學生讀不到草稿，讀得到已發布的", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const { data, error } = await db.from("competitions").select("id").order("id");
    expect(error).toBeNull();
    const ids = (data ?? []).map((c) => c.id as string);
    expect(ids).toContain(publishedId);
    expect(ids).not.toContain(draftId);
  });

  it("其他幹部讀得到草稿與已發布", async () => {
    const db = await clientAs("off@g.nccu.edu.tw");
    const { data, error } = await db.from("competitions").select("id").order("id");
    expect(error).toBeNull();
    const ids = (data ?? []).map((c) => c.id as string);
    expect(ids).toContain(publishedId);
    expect(ids).toContain(draftId);
  });

  it("專案幹部讀得到草稿與已發布", async () => {
    const db = await clientAs("pm@g.nccu.edu.tw");
    const { data, error } = await db.from("competitions").select("id").order("id");
    expect(error).toBeNull();
    const ids = (data ?? []).map((c) => c.id as string);
    expect(ids).toContain(publishedId);
    expect(ids).toContain(draftId);
  });

  it("不在名單上的帳號什麼都讀不到", async () => {
    const db = await clientAs("stranger@g.nccu.edu.tw");
    const { data, error } = await db.from("competitions").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("使用者連線直接 insert／update／delete 一律失敗", async () => {
    const db = await clientAs("pm@g.nccu.edu.tw");
    const insert = await db.from("competitions").insert({
      semester_id: seed.semesterId,
      name: "偷塞",
      url: "https://example.com/x",
      signup_deadline: "2026-12-01T15:59:59.999Z",
      status: "draft",
      created_by: "pm@g.nccu.edu.tw",
    });
    expect(insert.error).not.toBeNull();

    const update = await db.from("competitions").update({ status: "published" }).eq("id", draftId).select();
    expect(update.error).not.toBeNull();

    const del = await db.from("competitions").delete().eq("id", draftId).select();
    expect(del.error).not.toBeNull();
  });

  // Minor 1：read_competitions 的第一個條件是 `semester_id = 當前學期`——一個名單內的人
  // 就算是已發布的比賽，只要不屬於當前學期，也不該看得到。用一個額外的、is_current=false
  // 的學期＋一張已發布的比賽驗證這個邊界（跟「已發布就所有人看得到」這條規則分開測）。
  it("已發布，但屬於別的學期的卡片，本學期名單上的人看不到", async () => {
    const service = createServiceSupabase();
    const { data: otherSemester, error: otherSemesterError } = await service
      .from("semesters")
      .insert({ name: "別的學期", is_current: false })
      .select()
      .single();
    if (otherSemesterError) throw otherSemesterError;

    const { data: otherComp, error: otherCompError } = await service
      .from("competitions")
      .insert({
        semester_id: otherSemester.id,
        name: "別學期已發布賽",
        url: "https://example.com/other-semester",
        signup_deadline: "2026-12-01T15:59:59.999Z",
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (otherCompError) throw otherCompError;

    const db = await clientAs("a1@g.nccu.edu.tw");
    const { data, error } = await db.from("competitions").select("id").eq("id", otherComp.id as string);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

// Mutation check（controller ruling — IMPORTANT 1）：read_competitions 這條政策沒有寫自動化
// 的「放寬→紅燈→恢復」測試（原本 committed 的版本會 drop/recreate 政策又沒有
// try/finally，assert 失敗會讓本機 DB 永遠停在放寬狀態）。改成在修 fix round 1 時手動跑一次，
// 命令與輸出記錄在 task-2-report.md 的「Fix round 1」章節；跑完已經用同一份 migration 的
// SQL 復原，並用 `select pg_get_expr(polqual, polrelid) from pg_policy where
// polname='read_competitions'` 確認跟 migration 檔裡的文字一致。
