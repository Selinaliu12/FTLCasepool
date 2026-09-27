import { notFound, redirect } from "next/navigation";
import { getAccess } from "@/server/session";
import { createServerSupabase } from "@/server/supabase";
import { loadMyGroup } from "@/server/queries/my-group";
import { formatTaipei } from "@/domain/time";
import { lateBy } from "@/domain/progress";
import { overdueLabel } from "@/domain/lights";
import { ProgressForm } from "./progress-form";
import { EditableReport } from "./editable-report";

export default async function PeriodPage({ params }: { params: Promise<{ periodId: string }> }) {
  const { periodId } = await params;

  const access = await getAccess();
  if (access.kind !== "ok" || !access.member || access.member.role !== "student" || !access.member.groupId) {
    redirect("/");
  }

  const data = await loadMyGroup();
  const period = data.periods.find((p) => p.periodId === periodId);
  if (!period) notFound();

  const now = new Date();

  // 已經交過這期：2 小時內可以修改／換 PDF／撤回（Task 9），之後鎖定為唯讀。
  if (period.report) {
    const supabase = await createServerSupabase();
    const { data: full, error } = await supabase
      .from("progress_reports")
      .select("id, did, blocked, next_steps")
      .eq("line_id", data.lineId)
      .eq("period_id", periodId)
      .single();
    if (error) throw error;

    const locked = now >= period.report.lockedAt;

    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <h1 className="font-heading text-2xl font-bold text-foreground">第 {period.seq} 期</h1>
        <EditableReport
          reportId={full.id as string}
          light={period.report.light}
          did={full.did as string}
          blocked={full.blocked as string}
          nextSteps={full.next_steps as string}
          submittedBy={period.report.submittedBy}
          submittedAt={period.report.submittedAt.toISOString()}
          lockedAt={period.report.lockedAt.toISOString()}
          deadline={period.deadline.toISOString()}
          locked={locked}
        />
      </main>
    );
  }

  const overdue = lateBy(period.deadline, now);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="font-heading text-2xl font-bold text-foreground">第 {period.seq} 期</h1>
      <p className="font-mono text-sm text-muted-foreground">{formatTaipei(period.deadline)} 截止</p>
      {overdue.late && (
        <p className="text-sm text-[color:var(--danger,#B3261E)]">
          本期已{overdueLabel(overdue.hours)}，仍可補交
        </p>
      )}
      {period.suggestion && (
        <p className="whitespace-pre-line text-sm text-muted-foreground">
          本期建議繳交：{period.suggestion}
        </p>
      )}
      <ProgressForm periodId={periodId} />
    </main>
  );
}
