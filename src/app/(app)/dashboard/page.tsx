import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccess } from "@/server/session";
import { loadDashboard } from "@/server/queries/dashboard";
import { loadReviewQueue } from "@/server/queries/review-queue";
import { worstLight } from "@/domain/dashboard";
import { GroupCard } from "@/components/group-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTaipei } from "@/domain/time";

export default async function DashboardPage() {
  const access = await getAccess();
  // 學生不該看到這頁：(app)/page.tsx 已經把他們導到 /my-group，這裡再擋一次，
  // 涵蓋「專案生直接打這條網址」的情況（跟 my-group/page.tsx 反過來擋幹部同一個道理）。
  if (access.kind === "ok" && access.active.role === "student") {
    redirect("/my-group");
  }
  // (app)/layout.tsx 的 requireOk() 已經擋掉 wrong_domain／not_in_roster，唯一會漏到這裡的
  // 非 "ok" 狀態是「管理員、但還沒有任何學期」（no_semester 對管理員不會被導頁，見
  // session.ts 的註解）——這種情況沒有 semesterId 可以查，loadDashboard() 也查不出東西，
  // 導去 /admin 讓管理員先建學期，不要讓查詢直接丟例外。
  if (access.kind !== "ok") {
    redirect("/admin");
  }

  const [{ cards, myPmGroupIds }, reviewQueue] = await Promise.all([loadDashboard(), loadReviewQueue()]);
  const myPmGroupIdSet = new Set(myPmGroupIds);
  // 看板每張卡的「看內容」連結：規格第 3 節＋§17，管理員與專案幹部可以點進組別頁；專案幹部點非負責的組
  // 是「看狀態」（只看狀態版本）。其他幹部沒有這個連結（直接打網址會撞到 /groups/[id] 的 404，見 loadGroupDetail）。
  const canViewContent = access.active.role === "pm" || access.active.role === "admin";

  const counts = { red: 0, yellow: 0, green: 0 };
  for (const card of cards) counts[worstLight(card)]++;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">總覽看板</h1>
        <p className="text-sm text-muted-foreground">
          紅燈 {counts.red} 組 · 黃燈 {counts.yellow} 組 · 綠燈 {counts.green} 組
        </p>
      </div>

      {access.active.role === "pm" && (
        <Card>
          <CardHeader>
            <CardTitle>待你審核{reviewQueue.length > 0 ? `（${reviewQueue.length}）` : ""}</CardTitle>
          </CardHeader>
          <CardContent>
            {reviewQueue.length === 0 ? (
              <p className="text-sm text-muted-foreground">目前沒有待審核的繳交</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {reviewQueue.map((item) => (
                  <li key={item.submissionId}>
                    <Link href={item.href} className="text-primary underline-offset-4 hover:underline">
                      {item.groupName} · {item.competitionName} · {item.stageLabel}第 {item.version} 版
                    </Link>
                    <span className="ml-2 text-muted-foreground">
                      {formatTaipei(item.uploadedAt)} 上傳 · 已等 {item.waitingDays} 天
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">還沒有組別，請管理員匯入名單</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {cards.map((card) => (
            <GroupCard
              key={card.groupId}
              card={card}
              isMine={myPmGroupIdSet.has(card.groupId)}
              canViewContent={canViewContent}
              statusOnly={
                access.active.role === "pm" &&
                !myPmGroupIdSet.has(card.groupId) &&
                // 同時是這組專案生的人看得到內容（§17-15），不是只看狀態。
                !access.identities.some((i) => i.role === "student" && i.groupId === card.groupId)
              }
            />
          ))}
        </div>
      )}
    </main>
  );
}
