import Link from "next/link";
import { loadLobby } from "@/server/queries/competitions";
import { CompetitionCard } from "@/components/competition-card";
import { buttonVariants } from "@/components/ui/button";

export default async function CompetitionsPage() {
  const now = new Date();
  const lobby = await loadLobby(now);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-bold text-foreground">競賽大廳</h1>
        {lobby.canEdit && (
          <Link href="/competitions/new" className={buttonVariants({})}>
            新增競賽
          </Link>
        )}
      </div>

      {lobby.canEdit && lobby.drafts.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-foreground">草稿</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {lobby.drafts.map((c) => (
              <CompetitionCard key={c.id} card={c} now={now} draft canEdit={lobby.canEdit} />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">報名中</h2>
        {lobby.open.length === 0 ? (
          <p className="text-sm text-muted-foreground">目前沒有開放報名的競賽。</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {lobby.open.map((c) => (
              <CompetitionCard
                key={c.id}
                card={c}
                now={now}
                canEdit={lobby.canEdit}
                showAttach={lobby.isStudent}
                attachedEntryId={lobby.myGroupAttached[c.id] ?? null}
                attachedGroups={lobby.attachedGroups[c.id] ?? []}
              />
            ))}
          </div>
        )}
      </section>

      {lobby.closed.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-foreground">已截止</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Final review minor 13：已截止的卡片不能再掛，但這組已經掛了的，仍然顯示「已掛到你們組」
                連到報名頁（AttachCompetitionButton 有 entryId 時只畫連結，不畫掛的按鈕）。 */}
            {lobby.closed.map((c) => (
              <CompetitionCard
                key={c.id}
                card={c}
                now={now}
                canEdit={lobby.canEdit}
                showAttach={lobby.isStudent && !!lobby.myGroupAttached[c.id]}
                attachedEntryId={lobby.myGroupAttached[c.id] ?? null}
                attachedGroups={lobby.attachedGroups[c.id] ?? []}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
