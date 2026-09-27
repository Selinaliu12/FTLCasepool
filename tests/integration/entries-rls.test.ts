import { beforeAll, describe, it, expect } from "vitest";
import { resetDb, seedSemester, clientAs } from "./helpers";
import { createServiceSupabase } from "../../src/server/supabase";

let seed: Awaited<ReturnType<typeof seedSemester>>;
let entryId: string;
let competitionId: string;
let memberAId: string;

beforeAll(async () => {
  await resetDb();
  seed = await seedSemester();

  const db = createServiceSupabase();
  const { data: competition, error: competitionError } = await db
    .from("competitions")
    .insert({
      semester_id: seed.semesterId,
      name: "黑客松",
      url: "https://example.com",
      signup_deadline: "2099-12-01T15:59:59.999Z",
      status: "published",
      created_by: "pm@g.nccu.edu.tw",
    })
    .select()
    .single();
  if (competitionError) throw competitionError;
  competitionId = competition.id as string;

  const { data: entry, error: entryError } = await db
    .from("competition_entries")
    .insert({ group_id: seed.groupA, competition_id: competitionId, created_by: "a1@g.nccu.edu.tw" })
    .select()
    .single();
  if (entryError) throw entryError;
  entryId = entry.id as string;

  const { data: member } = await db
    .from("members")
    .select("id")
    .eq("semester_id", seed.semesterId)
    .eq("email", "a1@g.nccu.edu.tw")
    .single();
  memberAId = member!.id as string;
  const { error: emError } = await db.from("entry_members").insert({ entry_id: entryId, member_id: memberAId });
  if (emError) throw emError;
});

describe("RLS：competition_entries／entry_members", () => {
  it("其他幹部看得到所有組的報名", async () => {
    const db = await clientAs("off@g.nccu.edu.tw");
    const { data, error } = await db.from("competition_entries").select("id");
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toContain(entryId);
  });

  it("專案幹部看得到所有組的報名", async () => {
    const db = await clientAs("pm@g.nccu.edu.tw");
    const { data, error } = await db.from("competition_entries").select("id");
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toContain(entryId);
  });

  it("這組的學生看得到自己組的報名", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const { data, error } = await db.from("competition_entries").select("id");
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toContain(entryId);
  });

  it("別組的學生看不到這筆報名", async () => {
    const db = await clientAs("b1@g.nccu.edu.tw");
    const { data, error } = await db.from("competition_entries").select("id");
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).not.toContain(entryId);
  });

  it("別組的學生看不到 entry_members", async () => {
    const db = await clientAs("b1@g.nccu.edu.tw");
    const { data, error } = await db.from("entry_members").select("entry_id").eq("entry_id", entryId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("這組的學生看得到 entry_members", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const { data, error } = await db.from("entry_members").select("entry_id").eq("entry_id", entryId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
  });

  it("使用者連線直接 insert／update／delete 一律失敗", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const insert = await db.from("competition_entries").insert({
      group_id: seed.groupA,
      competition_id: competitionId,
      created_by: "a1@g.nccu.edu.tw",
    });
    expect(insert.error).not.toBeNull();

    const update = await db.from("competition_entries").update({ confirmed_at: new Date().toISOString() }).eq("id", entryId).select();
    expect(update.error).not.toBeNull();

    const del = await db.from("competition_entries").delete().eq("id", entryId).select();
    expect(del.error).not.toBeNull();
  });

  // p_member_ids 帶一個真的合法的成員（memberAId，這組的專案生）：如果 execute 權限不小心開給
  // authenticated，這個呼叫實際上會成功（確認報名／改成員都會通過函式內的業務邏輯檢查），
  // 讓這個測試真的能分辨「權限擋下來」跟「呼叫成功但業務邏輯本來就會擋」——只傳空陣列的話，
  // 不管有沒有權限最後都會回傳錯誤，測不出權限有沒有被誤開。
  it("使用者連線不能直接呼叫 confirm_entry", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const { error } = await db.rpc("confirm_entry", { p_entry_id: entryId, p_member_ids: [memberAId] });
    expect(error).not.toBeNull();
  });

  // fix round 1：update_entry_members()（改參賽成員用的新 RPC）跟 confirm_entry() 同一套
  // 規矩，只給 service_role。
  it("使用者連線不能直接呼叫 update_entry_members", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const { error } = await db.rpc("update_entry_members", { p_entry_id: entryId, p_member_ids: [memberAId] });
    expect(error).not.toBeNull();
  });
});

// Mutation check（手動跑一次，記錄在 task-3-report.md）：暫時把 read_entries 政策放寬成
// `using (true)`，確認「別組的學生看不到這筆報名」會變紅，再用同一份 migration 的 SQL 復原。
