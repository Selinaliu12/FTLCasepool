import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resetDb, seedSemester, clientAs } from "./helpers";
import { createServiceSupabase } from "../../src/server/supabase";

type AttachedGroupRow = { competition_id: string; group_name: string };

async function callAttachedGroups(db: SupabaseClient): Promise<{ data: AttachedGroupRow[] | null; error: unknown }> {
  const { data, error } = await db.rpc("competition_attached_groups");
  return { data: (data ?? null) as AttachedGroupRow[] | null, error };
}

// Task 2（規格第 15 節 #7）：每組都看得到別組掛了哪些比賽的「組名」，透過
// competition_attached_groups() 這顆 SECURITY DEFINER 函式；不放寬 competition_entries／
// entry_members／stage_submissions 本身的 RLS。
//
// seedSemester() 只建第1組、第2組，這裡另外建第3組、第5組，湊出跟 brief 一樣的情境：
// 第1組掛比賽 A、第2組掛 A 後退出、第3組掛了得獎，第5組（不在名單上任何比賽組）呼叫應該
// 只看到「第1組、第3組」（自然排序：第2組不出現，因為已退出）。

async function seedGroup(semesterId: string, name: string, projectName: string) {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("groups")
    .insert({ semester_id: semesterId, name, project_name: projectName })
    .select()
    .single();
  if (error) throw error;
  return data.id as string;
}

async function seedMember(semesterId: string, email: string, name: string, groupId: string) {
  const db = createServiceSupabase();
  const { error } = await db
    .from("members")
    .insert({ semester_id: semesterId, email, name, role: "student", group_id: groupId });
  if (error) throw error;
}

async function seedCompetition(semesterId: string, name: string, status: "draft" | "published") {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("competitions")
    .insert({
      semester_id: semesterId,
      name,
      url: "https://example.com/x",
      signup_deadline: "2026-12-01T15:59:59.999Z",
      status,
      created_by: "pm@g.nccu.edu.tw",
    })
    .select()
    .single();
  if (error) throw error;
  return data.id as string;
}

async function seedEntry(groupId: string, competitionId: string, opts: { withdrawn?: boolean; result?: string } = {}) {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("competition_entries")
    .insert({
      group_id: groupId,
      competition_id: competitionId,
      created_by: "x@g.nccu.edu.tw",
      withdrawn_at: opts.withdrawn ? new Date().toISOString() : null,
      result: opts.result ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data.id as string;
}

// Fix round 1（F1）：在第1組的報名上真的建一筆 entry_members（確認參賽成員）與一筆
// stage_submissions（上傳一版報名階段的 PDF），讓「第5組直接查這兩張表仍拿不到別組資料」這個
// 斷言真的有東西可以漏——原本兩張表整輪測試都是空的，toEqual([]) 不管 RLS 擋不擋都會過。
async function seedRealEntryContent(semesterId: string, group1: string, entryId: string): Promise<void> {
  const db = createServiceSupabase();

  const { data: a1, error: a1Error } = await db
    .from("members")
    .select("id")
    .eq("semester_id", semesterId)
    .eq("email", "a1@g.nccu.edu.tw")
    .single();
  if (a1Error) throw a1Error;

  const { error: entryMemberError } = await db.from("entry_members").insert({ entry_id: entryId, member_id: a1.id });
  if (entryMemberError) throw entryMemberError;

  const { data: line, error: lineError } = await db
    .from("lines")
    .insert({ group_id: group1, kind: "competition", entry_id: entryId })
    .select()
    .single();
  if (lineError) throw lineError;

  const { error: submissionError } = await db.from("stage_submissions").insert({
    line_id: line.id,
    stage: "signup",
    version: 1,
    pdf_key: `attached-groups-rls-test/${entryId}/signup-v1.pdf`,
    pdf_size: 1024,
    pdf_uploaded_at: new Date().toISOString(),
    pdf_uploaded_by: "a1@g.nccu.edu.tw",
    submitted_by: "a1@g.nccu.edu.tw",
  });
  if (submissionError) throw submissionError;
}

describe("competition_attached_groups()", () => {
  let semesterId: string;
  let group1: string;
  let group2: string;
  let group3: string;
  let group5: string;
  let competitionA: string;
  let entry1Id: string;

  beforeEach(async () => {
    await resetDb();
    const seed = await seedSemester();
    semesterId = seed.semesterId;
    group1 = seed.groupA; // "第1組"
    group2 = seed.groupB; // "第2組"
    group3 = await seedGroup(semesterId, "第3組", "專案C");
    group5 = await seedGroup(semesterId, "第5組", "專案E");
    await seedMember(semesterId, "c1@g.nccu.edu.tw", "丙一", group3);
    await seedMember(semesterId, "e1@g.nccu.edu.tw", "戊一", group5);

    competitionA = await seedCompetition(semesterId, "比賽 A", "published");

    // 第1組掛 A（未退出）
    entry1Id = await seedEntry(group1, competitionA);
    // 第2組掛 A 後退出
    await seedEntry(group2, competitionA, { withdrawn: true });
    // 第3組掛 A 得獎（仍算掛上）
    await seedEntry(group3, competitionA, { result: "awarded" });

    // Fix round 1（F1）：讓「第5組直接查 entry_members／stage_submissions 仍拿不到別組資料」
    // 這個斷言不再是空集合對空集合的假陽性——真的給第1組的報名確認成員、上傳一版階段檔案。
    await seedRealEntryContent(semesterId, group1, entry1Id);
  });

  // 函式本身沒有 order by（自然排序在呼叫端的 TS 層做，見 src/server/queries/competitions.ts
  // 的 sortGroupNames／competitions-query.test.ts），這裡直接查 RPC，只斷言「這個集合」，
  // 排序前先 sort 避免斷言依賴 Postgres 沒承諾過的列順序。
  it("第5組學生呼叫得到 A 的組名只有第1組、第3組（第2組因退出不出現）", async () => {
    const db = await clientAs("e1@g.nccu.edu.tw");
    const { data, error } = await callAttachedGroups(db);
    expect(error).toBeNull();
    const rows = (data ?? []).filter((r) => r.competition_id === competitionA);
    expect(rows.map((r) => r.group_name).sort()).toEqual(["第1組", "第3組"]);
  });

  it("退出後重新掛，同一組同一比賽只出現一次", async () => {
    // 第2組重新掛（新的一筆 withdrawn_at is null）
    await seedEntry(group2, competitionA);

    const db = await clientAs("e1@g.nccu.edu.tw");
    const { data, error } = await callAttachedGroups(db);
    expect(error).toBeNull();
    const rows = (data ?? []).filter((r) => r.competition_id === competitionA);
    expect(rows.map((r) => r.group_name).sort()).toEqual(["第1組", "第2組", "第3組"]);
  });

  it("草稿比賽不出現", async () => {
    // competition_entries 有 before-insert trigger（competition_entries_require_published，
    // 20260927000019）擋掉「幫草稿比賽新增未退出的報名」——這是正確的業務規則，但代表要測
    // 「已經掛過、後來比賽被下架回草稿」這個情境，得先用已發布的比賽掛，再把比賽改回草稿
    // （trigger 只擋 insert，不擋 competitions 本身的 update）。
    const draftId = await seedCompetition(semesterId, "草稿賽", "published");
    await seedEntry(group1, draftId);
    const service = createServiceSupabase();
    const { error: unpublishError } = await service.from("competitions").update({ status: "draft" }).eq("id", draftId);
    if (unpublishError) throw unpublishError;

    const db = await clientAs("e1@g.nccu.edu.tw");
    const { data, error } = await callAttachedGroups(db);
    expect(error).toBeNull();
    expect((data ?? []).some((r) => r.competition_id === draftId)).toBe(false);
  });

  it("上學期的比賽不出現", async () => {
    const service = createServiceSupabase();
    const { data: otherSemester, error: otherSemesterError } = await service
      .from("semesters")
      .insert({ name: "上學期", is_current: false })
      .select()
      .single();
    if (otherSemesterError) throw otherSemesterError;

    const { data: otherGroup, error: otherGroupError } = await service
      .from("groups")
      .insert({ semester_id: otherSemester.id, name: "第1組", project_name: "舊專案" })
      .select()
      .single();
    if (otherGroupError) throw otherGroupError;

    const { data: otherComp, error: otherCompError } = await service
      .from("competitions")
      .insert({
        semester_id: otherSemester.id,
        name: "上學期已發布賽",
        url: "https://example.com/old",
        signup_deadline: "2025-12-01T15:59:59.999Z",
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (otherCompError) throw otherCompError;

    await seedEntry(otherGroup.id as string, otherComp.id as string);

    const db = await clientAs("e1@g.nccu.edu.tw");
    const { data, error } = await callAttachedGroups(db);
    expect(error).toBeNull();
    expect((data ?? []).some((r) => r.competition_id === otherComp.id)).toBe(false);
  });

  it("不在名單上的登入者拿到空集合", async () => {
    const db = await clientAs("stranger@g.nccu.edu.tw");
    const { data, error } = await callAttachedGroups(db);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // Fix round 1（F1）：beforeEach 已經在第1組的報名上真的塞了一筆 entry_members（a1）與一筆
  // stage_submissions（報名階段 v1），所以下面三個 toEqual([]) 不再是空集合對空集合——真的有
  // 別組的資料在那裡，斷言的是「RLS 擋下來，第5組查不到」。
  it("第5組學生直接查 competition_entries／entry_members／stage_submissions 仍拿不到別組資料", async () => {
    const db = await clientAs("e1@g.nccu.edu.tw");

    const entries = await db.from("competition_entries").select("id").eq("group_id", group1);
    expect(entries.error).toBeNull();
    expect(entries.data).toEqual([]);

    const entryMembers = await db.from("entry_members").select("entry_id").eq("entry_id", entry1Id);
    expect(entryMembers.error).toBeNull();
    expect(entryMembers.data).toEqual([]);

    const stageSubmissions = await db.from("stage_submissions").select("id");
    expect(stageSubmissions.error).toBeNull();
    expect(stageSubmissions.data).toEqual([]);
  });
});

// Mutation check（controller ruling — 跟 competitions-rls.test.ts 的 IMPORTANT 1 同一個理由）：
// 不寫成自動化的「放寬→紅燈→恢復」測試（drop/recreate 函式本身如果卡在 assert 失敗會讓本機
// DB 永遠停在放寬狀態）。改成手動跑一次，命令與輸出記錄在 task-2-report.md。
