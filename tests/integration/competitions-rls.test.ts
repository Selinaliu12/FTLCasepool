import { beforeAll, describe, it, expect } from "vitest";
import { resetDb, seedSemester, clientAs, withRawPg } from "./helpers";
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

  // Mutation check：暫時把 read_competitions 政策放寬成「任何人都能看草稿」，確認學生真的能
  // 看到草稿（政策確實在把關，不是測試本身沒生效）——驗證完立刻恢復原政策。
  it("mutation check：放寬政策後學生看得到草稿，恢復後看不到", async () => {
    await withRawPg(async (client) => {
      await client.query("drop policy read_competitions on competitions");
      await client.query(
        `create policy read_competitions on competitions for select to authenticated using (true)`
      );
    });

    const loosened = await clientAs("a1@g.nccu.edu.tw");
    const loosenedResult = await loosened.from("competitions").select("id").eq("id", draftId);
    expect(loosenedResult.data).toHaveLength(1);

    await withRawPg(async (client) => {
      await client.query("drop policy read_competitions on competitions");
      await client.query(
        `create policy read_competitions on competitions for select to authenticated using (
           semester_id = (select id from semesters where is_current limit 1)
           and (
             (status = 'published' and (me()).id is not null)
             or is_staff()
           )
         )`
      );
    });

    const restored = await clientAs("a1@g.nccu.edu.tw");
    const restoredResult = await restored.from("competitions").select("id").eq("id", draftId);
    expect(restoredResult.data).toEqual([]);
  });
});
