import { notFound, redirect } from "next/navigation";
import { getAccess } from "@/server/session";
import { loadMyGroup } from "@/server/queries/my-group";
import { formatTaipei } from "@/domain/time";
import { lateBy } from "@/domain/progress";
import { overdueLabel } from "@/domain/lights";
import { NewAssignmentSubmission, EditableAssignmentSubmission } from "./assignment-submission";

// 專案生交作業（規格 §17）。只看得到派給目前這組的作業（loadMyGroup 經 RLS），其他一律 404。
export default async function AssignmentPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await params;
  const access = await getAccess();
  if (access.kind !== "ok" || access.active.role !== "student" || !access.active.groupId) redirect("/");

  const data = await loadMyGroup();
  const a = data.assignments.find((x) => x.id === assignmentId);
  if (!a) notFound();

  const now = new Date();
  const overdue = lateBy(a.deadline, now);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <div>
        <p className="text-sm text-muted-foreground">作業 · 出題：{a.createdByName}</p>
        <h1 className="font-heading text-2xl font-bold text-foreground break-words">{a.title}</h1>
      </div>
      <p className="font-mono text-sm text-muted-foreground">{formatTaipei(a.deadline)} 截止</p>
      {a.description && <p className="whitespace-pre-wrap break-words text-sm text-foreground">{a.description}</p>}
      {a.content ? (
        <EditableAssignmentSubmission
          submissionId={a.content.submissionId}
          note={a.content.note}
          submittedBy={a.content.submittedBy}
          submittedAt={(a.submittedAt as Date).toISOString()}
          lockedAt={a.content.lockedAt.toISOString()}
          deadline={a.deadline.toISOString()}
          locked={now >= a.content.lockedAt}
        />
      ) : (
        <>
          {overdue.late && (
            <p className="text-sm text-[color:var(--danger,#B3261E)]">已{overdueLabel(overdue.hours)}，仍可補交</p>
          )}
          <NewAssignmentSubmission assignmentId={a.id} />
        </>
      )}
    </main>
  );
}
