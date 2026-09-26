import { notFound } from "next/navigation";
import { loadGroupDetail } from "@/server/queries/group-detail";
import { LightBadge } from "@/components/light-badge";
import { PdfDownloadButton } from "@/components/pdf-download-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTaipei } from "@/domain/time";
import { overdueLabel, LIGHT_LABEL } from "@/domain/lights";
import { lateBy } from "@/domain/progress";

export default async function GroupDetailPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  // 規格第 3 節：其他幹部、別組學生打這條網址直接看到 404，不透露「這個組存在，只是你沒
  // 權限看」——loadGroupDetail 已經把角色與 RLS 檢查都做完，這裡只剩下把 null 轉成 404。
  const data = await loadGroupDetail(groupId);
  if (!data) notFound();

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

      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-lg font-bold text-foreground">中間週燈號歷程</h2>
        {data.checkins.length === 0 ? (
          <p className="text-sm text-muted-foreground">還沒有組員點燈</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.checkins.map((c, i) => (
              <li key={i} className="flex flex-col gap-1 rounded-[var(--r-sm,12px)] border border-[var(--line,#DEE9F8)] p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-foreground">{LIGHT_LABEL[c.light]}</span>
                  <span className="text-muted-foreground">
                    {c.by} · {formatTaipei(c.at)}
                  </span>
                </div>
                {c.note ? <p className="text-sm text-muted-foreground">{c.note}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
