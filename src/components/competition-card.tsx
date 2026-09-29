import Link from "next/link";
import { UsersIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { AttachCompetitionButton } from "@/components/attach-competition-button";
import { formatTaipei } from "@/domain/time";
import { deadlineLabel } from "@/domain/competition-label";
import { formatPrize, stageSummary } from "@/domain/competition";
import type { CompetitionCard as CompetitionCardData } from "@/domain/competition";

// 大廳卡片（規格第 15 節、樣張 A）：名稱＋主辦、右上角推薦標記、標籤列、四格資訊（報名截止／
// 最高獎金／隊伍／賽制，沒資料的格子不出現）、底部已掛上的組別，整張卡片可點進詳細頁
// （Task 4 的 /competitions/[id]，目前還沒建，會 404，但先接上連結——controller 指示）。
//
// 「整張卡片可點」用 stretched-link pattern：一個蓋滿全卡的 Link（絕對定位、z-index 低），
// 官方連結／編輯／掛到我們組這些互動元件放在 z-10 的容器裡，蓋在 stretched link 之上，
// 保持各自可以獨立點擊；stretched link 不是這些元件的祖先，DOM 結構上不會巢狀出現
// <a> 包 <a>／<button>。
export function CompetitionCard({
  card,
  now,
  draft = false,
  canEdit = false,
  showAttach = false,
  attachedEntryId = null,
  attachedGroups = [],
}: {
  card: CompetitionCardData;
  now: Date;
  draft?: boolean;
  canEdit?: boolean;
  // Task 3：學生在「開放中」卡片上看到「掛到我們組」／「已掛到你們組」。
  showAttach?: boolean;
  attachedEntryId?: string | null;
  // Task 2：這場比賽已經掛上的組名（依組名自然排序，已退出的不列）。
  attachedGroups?: string[];
}) {
  const prizeText = formatPrize(card.maxPrize);
  const stages = stageSummary(card.signupDeadline, card.submissionDeadline, card.finalDate);

  return (
    <Card className="relative">
      <CardHeader>
        <CardTitle className="flex items-start justify-between gap-2 text-base font-medium">
          <div className="flex flex-col gap-0.5">
            <span className="font-heading text-lg font-bold text-foreground">{card.name}</span>
            {card.organizer && <span className="text-sm font-normal text-muted-foreground">主辦：{card.organizer}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {draft && <Badge variant="secondary">草稿</Badge>}
            {card.recommended && <Badge>幹部推薦</Badge>}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {card.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {card.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* 卡片本身在大廳頁的網格裡並不寬（page.tsx 用 sm:grid-cols-2 排兩欄），就算在 1280
            寬的桌機也只有約 350-450px；固定兩欄（2x2）讓「報名截止」這種比較長的值有足夠寬度，
            不會逼出誇張的逐字換行，同時在手機 375 寬一樣是兩欄自然換行、不會橫向溢出。 */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div>
            <p className="text-xs text-muted-foreground">報名截止</p>
            <p className="text-[var(--danger)]">
              <span className="font-mono">{formatTaipei(card.signupDeadline)}</span>{" "}
              <span>（{deadlineLabel(card.signupDeadline, now)}）</span>
            </p>
          </div>
          {prizeText && (
            <div>
              <p className="text-xs text-muted-foreground">最高獎金</p>
              <p>{prizeText}</p>
            </div>
          )}
          {card.teamSize && (
            <div>
              <p className="text-xs text-muted-foreground">隊伍</p>
              <p className="break-words">{card.teamSize}</p>
            </div>
          )}
          {stages && (
            <div>
              <p className="text-xs text-muted-foreground">賽制</p>
              <p>{stages}</p>
            </div>
          )}
        </div>

        <div className="relative z-10 flex flex-wrap items-center gap-2">
          <a
            href={card.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            官方連結
          </a>
          {canEdit && (
            <Link
              href={`/competitions/${card.id}/edit`}
              className={buttonVariants({ variant: "outline", className: "self-start" })}
            >
              編輯
            </Link>
          )}
          {showAttach && <AttachCompetitionButton competitionId={card.id} entryId={attachedEntryId} />}
        </div>

        {attachedGroups.length > 0 && (
          <p className="relative z-10 flex items-center gap-1 text-xs text-muted-foreground">
            <UsersIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="break-words">{attachedGroups.join("、")}已掛上</span>
          </p>
        )}

        <Link
          href={`/competitions/${card.id}`}
          className="absolute inset-0 z-0 rounded-[20px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="sr-only">查看「{card.name}」詳細資料</span>
        </Link>
      </CardContent>
    </Card>
  );
}
