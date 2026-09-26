import { redirect } from "next/navigation";
import { getAccess } from "@/server/session";
import { loadDashboard } from "@/server/queries/dashboard";
import { worstLight } from "@/domain/dashboard";
import { GroupCard } from "@/components/group-card";

export default async function DashboardPage() {
  const access = await getAccess();
  // 學生不該看到這頁：(app)/page.tsx 已經把他們導到 /my-group，這裡再擋一次，
  // 涵蓋「專案生直接打這條網址」的情況（跟 my-group/page.tsx 反過來擋幹部同一個道理）。
  if (access.kind === "ok" && access.member && access.member.role === "student") {
    redirect("/my-group");
  }
  // (app)/layout.tsx 的 requireOk() 已經擋掉 wrong_domain／not_in_roster，唯一會漏到這裡的
  // 非 "ok" 狀態是「管理員、但還沒有任何學期」（no_semester 對管理員不會被導頁，見
  // session.ts 的註解）——這種情況沒有 semesterId 可以查，loadDashboard() 也查不出東西，
  // 導去 /admin 讓管理員先建學期，不要讓查詢直接丟例外。
  if (access.kind !== "ok") {
    redirect("/admin");
  }

  const { cards, myPmGroupIds } = await loadDashboard();
  const myPmGroupIdSet = new Set(myPmGroupIds);
  // 看板每張卡的「看內容」連結：規格第 3 節，只有專案幹部與管理員能看進度內容，
  // 其他幹部沒有這個連結（直接打網址會撞到 /groups/[id] 的 404，見 loadGroupDetail）。
  const canViewContent = access.member?.role === "pm" || access.isAdmin;

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
            />
          ))}
        </div>
      )}
    </main>
  );
}
