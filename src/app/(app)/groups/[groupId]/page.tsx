import { notFound } from "next/navigation";
import { getAccess } from "@/server/session";
import { createServiceSupabase } from "@/server/supabase";
import { loadGroupDetail } from "@/server/queries/group-detail";
import { LightBadge } from "@/components/light-badge";
import { PdfDownloadButton } from "@/components/pdf-download-button";
import { CompetitionLineDetail } from "@/components/competition-line-detail";
import { CheckinHistory } from "@/components/checkin-history";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTaipei } from "@/domain/time";
import { overdueLabel } from "@/domain/lights";
import { lateBy } from "@/domain/progress";

export default async function GroupDetailPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  // 規格第 3 節：其他幹部、別組學生打這條網址直接看到 404，不透露「這個組存在，只是你沒
  // 權限看」——loadGroupDetail 已經把角色與 RLS 檢查都做完，這裡只剩下把 null 轉成 404。
  const data = await loadGroupDetail(groupId);
  if (!data) notFound();

  // canReview：這個看的人是不是負責這組的 PM——跟 reviewStage() 的權限檢查同一份資料來源
  // （pm_assignments），只是這裡只用來決定要不要畫出通過／退回按鈕，不是真正的授權（按下去
  // 之後 reviewStage() 自己會再檢查一次）。不是 PM 的身分（含管理員、自己組的學生）一律不顯示。
  const access = await getAccess();
  let canReview = false;
  if (access.kind === "ok" && access.member?.role === "pm") {
    const db = createServiceSupabase();
    const { data: assignment } = await db
      .from("pm_assignments")
      .select("group_id")
      .eq("pm_member_id", access.member.id)
      .eq("group_id", groupId)
      .maybeSingle();
    canReview = !!assignment;
  }

  const now = new Date();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">{data.group.name}</h1>
        <p className="text-muted-foreground">{data.group.projectName}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <LightBadge light={data.display.light} source={data.display.source} />
        <span className="text-sm text-muted-foreground">
          準時率：{data.onTime === null ? "—" : `${Math.round(data.onTime * 100)}%`}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {data.periods.map((p) => {
          const overdue = !p.report ? lateBy(p.deadline, now) : { late: false as const };
          return (
            <Card key={p.seq}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base font-medium">
                  <span>第 {p.seq} 期</span>
                  <span className="font-mono text-sm font-normal text-muted-foreground">
                    {formatTaipei(p.deadline)} 截止
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {!p.report ? (
                  overdue.late ? (
                    <p className="text-sm text-[color:var(--danger,#B3261E)]">本期已{overdueLabel(overdue.hours)}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">未交</p>
                  )
                ) : (
                  <details className="flex flex-col gap-3">
                    <summary className="cursor-pointer text-sm font-medium text-foreground">
                      已交 · {p.report.submittedBy} · {formatTaipei(p.report.submittedAt)} ·{" "}
                      {p.report.timing.label}
                    </summary>
                    <div className="flex flex-col gap-3 pt-1">
                      <LightBadge light={p.report.light} source="組員回報" />
                      <dl className="flex flex-col gap-4 text-sm">
                        <div className="flex flex-col gap-1">
                          <dt className="font-medium text-foreground">這兩週做了什麼</dt>
                          <dd className="whitespace-pre-wrap text-muted-foreground">{p.report.did}</dd>
                        </div>
                        <div className="flex flex-col gap-1">
                          <dt className="font-medium text-foreground">卡在哪裡</dt>
                          <dd className="whitespace-pre-wrap text-muted-foreground">{p.report.blocked}</dd>
                        </div>
                        <div className="flex flex-col gap-1">
                          <dt className="font-medium text-foreground">接下來要做什麼</dt>
                          <dd className="whitespace-pre-wrap text-muted-foreground">{p.report.nextSteps}</dd>
                        </div>
                      </dl>
                      <div className="self-start">
                        <PdfDownloadButton reportId={p.report.reportId} />
                      </div>
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {data.competitionLines.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-bold text-foreground">比賽</h2>
          <div className="flex flex-col gap-2">
            {data.competitionLines.map((line) => (
              <CompetitionLineDetail key={line.lineId} line={line} canReview={canReview} now={now} />
            ))}
          </div>
        </div>
      )}

      <CheckinHistory checkins={data.checkins} />
    </main>
  );
}
