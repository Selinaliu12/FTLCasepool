import { notFound, redirect } from "next/navigation";
import { getAccess } from "@/server/session";
import { createServerSupabase } from "@/server/supabase";
import { loadMyGroup } from "@/server/queries/my-group";
import { formatTaipei } from "@/domain/time";
import { lateBy } from "@/domain/progress";
import { overdueLabel } from "@/domain/lights";
import { LightBadge } from "@/components/light-badge";
import { ProgressForm } from "./progress-form";

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

  // 已經交過這期：唯讀畫面（可以修改是 Task 9，這裡不做）。
  if (period.report) {
    const supabase = await createServerSupabase();
    const { data: full, error } = await supabase
      .from("progress_reports")
      .select("did, blocked, next_steps")
      .eq("line_id", data.lineId)
      .eq("period_id", periodId)
      .single();
    if (error) throw error;

    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <h1 className="font-heading text-2xl font-bold text-foreground">第 {period.seq} 期</h1>
        <LightBadge light={period.report.light} source="組員回報" />
        <p className="text-sm text-muted-foreground">
          已交 · {period.report.submittedBy} · {formatTaipei(period.report.submittedAt)}
        </p>
        <dl className="flex flex-col gap-4 text-sm">
          <div className="flex flex-col gap-1">
            <dt className="font-medium text-foreground">這兩週做了什麼</dt>
            <dd className="whitespace-pre-wrap text-muted-foreground">{full.did}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium text-foreground">卡在哪裡</dt>
            <dd className="whitespace-pre-wrap text-muted-foreground">{full.blocked}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium text-foreground">接下來要做什麼</dt>
            <dd className="whitespace-pre-wrap text-muted-foreground">{full.next_steps}</dd>
          </div>
        </dl>
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
      <ProgressForm periodId={periodId} />
    </main>
  );
}
