import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccess } from "@/server/session";
import { createServerSupabase, createServiceSupabase } from "@/server/supabase";
import { loadAssignments } from "@/server/queries/assignments";
import { AssignmentStatus } from "@/components/assignment-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTaipei, taipeiInputValues } from "@/domain/time";
import { compareNatural } from "@/domain/natural-sort";
import { AssignmentEditor, DeleteAssignmentButton } from "./assignment-editor";

// 規格 §17：專案幹部在這裡出作業、改自己出的；所有幹部看得到每份作業派給哪些組、各組交了沒（只看狀態，
// 不看繳交內容）。專案生的作業在 /my-group。
export default async function AssignmentsPage() {
  const access = await getAccess();
  if (access.kind !== "ok") redirect("/admin");
  if (access.active.role === "student") redirect("/my-group");

  const db = access.active.role === "admin" ? createServiceSupabase() : await createServerSupabase();
  const [assignments, groupsRes] = await Promise.all([
    loadAssignments(db, access.semesterId),
    db.from("groups").select("id, name").eq("semester_id", access.semesterId).order("name"),
  ]);
  if (groupsRes.error) throw groupsRes.error;
  const groups = (groupsRes.data ?? [])
    .map((g) => ({ id: g.id as string, name: g.name as string }))
    .sort((a, b) => compareNatural(a.name, b.name));

  const isPm = access.active.role === "pm";
  const myId = isPm ? access.active.memberId : null;
  const mine = assignments.filter((a) => a.createdById === myId);
  const others = assignments.filter((a) => a.createdById !== myId);
  // 組名連到組別頁：專案幹部（非負責組是只看狀態版本）與管理員才進得去，其他幹部不給連結。
  const canOpenGroup = isPm || access.active.role === "admin";
  const now = new Date();

  function list(items: typeof assignments, editable: boolean) {
    if (items.length === 0) return <p className="text-sm text-muted-foreground">還沒有作業</p>;
    return (
      <ul className="flex flex-col gap-3">
        {items.map((a) => {
          const { date, time } = taipeiInputValues(a.deadline);
          return (
            <li key={a.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base font-medium">
                    <span className="break-words">{a.title}</span>
                    <span className="font-mono text-sm font-normal text-muted-foreground">{formatTaipei(a.deadline)} 截止</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <p className="text-xs text-muted-foreground">出題：{a.createdByName}</p>
                  {a.description ? <p className="whitespace-pre-wrap break-words text-foreground">{a.description}</p> : null}
                  <ul className="flex flex-col gap-1.5">
                    {a.groups.map((g) => (
                      <li key={g.groupId} className="flex flex-wrap items-center gap-2">
                        {canOpenGroup ? (
                          <Link href={`/groups/${g.groupId}`} className="text-primary underline-offset-4 hover:underline">
                            {g.groupName}
                          </Link>
                        ) : (
                          <span>{g.groupName}</span>
                        )}
                        <AssignmentStatus deadline={a.deadline} submittedAt={g.submittedAt} now={now} />
                      </li>
                    ))}
                  </ul>
                  {editable ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <AssignmentEditor
                        groups={groups}
                        assignment={{
                          id: a.id,
                          title: a.title,
                          description: a.description ?? "",
                          deadlineDate: date,
                          deadlineTime: time,
                          groupIds: a.groups.map((g) => g.groupId),
                        }}
                      />
                      <DeleteAssignmentButton assignmentId={a.id} title={a.title} />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">作業</h1>
          <p className="text-sm text-muted-foreground">
            {isPm ? "出作業給任何組；只有出題者能修改或刪除。" : "各組被派到的作業與繳交狀態。"}
          </p>
        </div>
        {isPm ? <AssignmentEditor groups={groups} /> : null}
      </div>

      {isPm ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-bold text-foreground">我出的作業</h2>
          {list(mine, true)}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold text-foreground">{isPm ? "其他幹部出的作業" : "所有作業"}</h2>
        {list(others, false)}
      </section>
    </main>
  );
}
