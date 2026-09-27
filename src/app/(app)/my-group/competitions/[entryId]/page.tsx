import { notFound } from "next/navigation";
import { getAccess } from "@/server/session";
import { loadEntryDetail } from "@/server/queries/entries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { entryDisplayStatus } from "@/domain/entries";
import { isLineEnded } from "@/domain/competition-line";
import { EntryActions } from "./entry-actions";
import { StageUploads } from "./stage-uploads";
import { ResultSelect } from "./result-select";

export default async function EntryPage({ params }: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await params;
  const access = await getAccess();
  const entry = await loadEntryDetail(entryId);
  if (!entry) notFound();

  const myMemberId = access.kind === "ok" && access.member?.role === "student" ? access.member.id : null;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">{entry.competitionName}</h1>
        <a
          href={entry.competitionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          官方連結
        </a>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base font-medium">
            <span>報名狀態</span>
            <span className="text-sm font-normal text-muted-foreground">{entryDisplayStatus(entry)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EntryActions entry={entry} myMemberId={myMemberId} />
        </CardContent>
      </Card>

      {/* 填比賽結果：只要報名已確認、還沒退出就能填／更正（包含比賽已經結束之後還想更正，
          例如得獎改回晉級——controller ruling 2 明確允許重新開放線），跟 setResult() 的權限
          條件一致（confirmed_at is not null and withdrawn_at is null）。 */}
      {entry.status === "in_progress" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">比賽結果</CardTitle>
          </CardHeader>
          <CardContent>
            <ResultSelect entryId={entry.entryId} result={entry.result} />
          </CardContent>
        </Card>
      )}

      {entry.lineId && (
        <StageUploads
          entryId={entry.entryId}
          stages={entry.stages}
          submissions={entry.submissions}
          ended={isLineEnded({ confirmedAt: entry.confirmedAt, withdrawnAt: entry.withdrawnAt, result: entry.result })}
        />
      )}
    </main>
  );
}
