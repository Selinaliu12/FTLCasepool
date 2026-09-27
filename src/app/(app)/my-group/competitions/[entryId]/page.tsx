import { notFound } from "next/navigation";
import { getAccess } from "@/server/session";
import { loadEntryDetail } from "@/server/queries/entries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ENTRY_STATUS_LABEL } from "@/domain/entries";
import { EntryActions } from "./entry-actions";

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
            <span className="text-sm font-normal text-muted-foreground">{ENTRY_STATUS_LABEL[entry.status]}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EntryActions entry={entry} myMemberId={myMemberId} />
        </CardContent>
      </Card>
    </main>
  );
}
