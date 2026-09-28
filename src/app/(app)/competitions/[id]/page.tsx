import { notFound } from "next/navigation";
import Link from "next/link";
import { CalendarIcon, TrophyIcon, UsersIcon, FileTextIcon, StickyNoteIcon } from "lucide-react";
import { loadCompetitionDetail } from "@/server/queries/competitions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { AttachCompetitionButton } from "@/components/attach-competition-button";
import { formatTaipei } from "@/domain/time";
import { deadlineLabel } from "@/domain/competition-label";
import { formatPrize, canShowAttach } from "@/domain/competition";
import type { CompetitionCard as CompetitionCardData } from "@/domain/competition";

// 詳細頁（Task 4，規格第 15 節、樣張 B）：loadCompetitionDetail 已經把「不是幹部／管理員看草稿」
// 「別學期」「id 亂填」「找不到」都轉成 null——這裡只需要把 null 轉成 404，跟
// /competitions/[id]/edit、/groups/[groupId] 的寫法一致。
//
// 刻意沒有 loading.tsx：這一頁會 notFound()，加 loading.tsx 會讓這個 route segment 用串流回應
// （先送出 200，資料讀完才決定要不要轉 404），草稿網址在還沒 notFound() 之前就已經回了 200——
// 跟 /groups/[groupId]、/my-group/competitions/[entryId] 刻意不加 loading.tsx 的理由一樣
// （controller ruling 4，見 src/app/(app)/route-states.test.tsx 的說明），這裡沿用同一個規則。
export default async function CompetitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await loadCompetitionDetail(id);
  if (!detail) notFound();

  const { card, canEdit, isStudent, attachedEntryId, attachedGroups } = detail;
  const now = new Date();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <Header card={card} canEdit={canEdit} isStudent={isStudent} attachedEntryId={attachedEntryId} now={now} />

      {card.summary && <p className="whitespace-pre-wrap break-words text-base text-foreground">{card.summary}</p>}

      {card.eligibility && (
        <Section title="參賽資格">
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{card.eligibility}</p>
        </Section>
      )}

      <ScheduleSection card={card} now={now} />
      <RewardsSection card={card} />
      <TeamSection card={card} />
      <SignupSection card={card} />

      {card.staffNote && (
        <Section title="幹部備註" icon={<StickyNoteIcon className="size-4 shrink-0" aria-hidden="true" />}>
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{card.staffNote}</p>
        </Section>
      )}

      {attachedGroups.length > 0 && (
        <Section title="已掛上的組別" icon={<UsersIcon className="size-4 shrink-0" aria-hidden="true" />}>
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{attachedGroups.join("、")}</p>
        </Section>
      )}
    </main>
  );
}

function Header({
  card,
  canEdit,
  isStudent,
  attachedEntryId,
  now,
}: {
  card: CompetitionCardData;
  canEdit: boolean;
  isStudent: boolean;
  attachedEntryId: string | null;
  now: Date;
}) {
  // Task 4 fix round 1（F1）：跟大廳卡片同一套規則（canShowAttach，見 domain/competition.ts）——
  // 已過報名截止日且這組還沒掛過時不顯示按鈕，不是一個按下去只會被 DEADLINE_PASSED 擋掉的假動作。
  const showAttach = isStudent && canShowAttach(card, now, attachedEntryId);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-heading text-2xl font-bold text-foreground break-words">{card.name}</h1>
          {card.organizer && <p className="text-sm text-muted-foreground break-words">主辦：{card.organizer}</p>}
        </div>
        {card.recommended && <Badge className="shrink-0">幹部推薦</Badge>}
      </div>

      {card.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {card.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <Link href={`/competitions/${card.id}/edit`} className={buttonVariants({ variant: "outline", className: "self-start" })}>
            編輯
          </Link>
        ) : (
          showAttach && <AttachCompetitionButton competitionId={card.id} entryId={attachedEntryId} />
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base font-medium">
          {icon}
          <span>{title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

function ScheduleRow({
  label,
  date,
  danger = false,
  daysLabel,
  note,
  extra,
}: {
  label: string;
  date: Date | null;
  danger?: boolean;
  daysLabel?: string;
  note?: string | null;
  extra?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {date && (
          <span className={danger ? "font-mono text-sm text-[var(--danger)]" : "font-mono text-sm text-foreground"}>
            {formatTaipei(date)}
            {daysLabel && <span className="ml-1">（{daysLabel}）</span>}
          </span>
        )}
      </div>
      {note && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{note}</p>}
      {extra && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{extra}</p>}
    </div>
  );
}

// 賽程與繳交：說明會、報名、繳件、決賽——只有真的有日期或備註才出現那一列；報名截止日一定有值
// （必填欄位），一定會出現。
function ScheduleSection({ card, now }: { card: CompetitionCardData; now: Date }) {
  const showInfoSession = !!card.infoSessionAt;
  const showSubmission = !!card.submissionDeadline || !!card.submissionNote;
  const showFinal = !!card.finalDate || !!card.finalNote || !!card.finalFormat;

  return (
    <Section title="賽程與繳交" icon={<CalendarIcon className="size-4 shrink-0" aria-hidden="true" />}>
      {showInfoSession && <ScheduleRow label="說明會" date={card.infoSessionAt} />}
      <ScheduleRow
        label="報名"
        date={card.signupDeadline}
        danger
        daysLabel={deadlineLabel(card.signupDeadline, now)}
        note={card.signupNote}
      />
      {showSubmission && <ScheduleRow label="繳件" date={card.submissionDeadline} note={card.submissionNote} />}
      {showFinal && <ScheduleRow label="決賽" date={card.finalDate} note={card.finalNote} extra={card.finalFormat} />}
    </Section>
  );
}

function RewardsSection({ card }: { card: CompetitionCardData }) {
  const prizeText = formatPrize(card.maxPrize);
  if (!card.prize && !prizeText && !card.perks) return null;

  return (
    <Section title="獎勵與機會" icon={<TrophyIcon className="size-4 shrink-0" aria-hidden="true" />}>
      {card.prize && <p className="whitespace-pre-wrap break-words text-sm text-foreground">{card.prize}</p>}
      {prizeText && (
        <div>
          <p className="text-xs text-muted-foreground">最高獎金</p>
          <p className="text-sm text-foreground">{prizeText}</p>
        </div>
      )}
      {card.perks && <p className="whitespace-pre-wrap break-words text-sm text-foreground">{card.perks}</p>}
    </Section>
  );
}

function TeamSection({ card }: { card: CompetitionCardData }) {
  if (!card.teamSize && !card.skills) return null;

  return (
    <Section title="組隊需求" icon={<UsersIcon className="size-4 shrink-0" aria-hidden="true" />}>
      {card.teamSize && (
        <div>
          <p className="text-xs text-muted-foreground">隊伍人數</p>
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{card.teamSize}</p>
        </div>
      )}
      {card.skills && (
        <div>
          <p className="text-xs text-muted-foreground">建議技能</p>
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{card.skills}</p>
        </div>
      )}
    </Section>
  );
}

// 報名方式一定會顯示（至少有官方連結按鈕——url 是必填欄位），不像其他區塊會整區省略。
function SignupSection({ card }: { card: CompetitionCardData }) {
  return (
    <Section title="報名方式" icon={<FileTextIcon className="size-4 shrink-0" aria-hidden="true" />}>
      {card.fee && (
        <div>
          <p className="text-xs text-muted-foreground">報名費</p>
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{card.fee}</p>
        </div>
      )}
      {card.documents && (
        <div>
          <p className="text-xs text-muted-foreground">需準備文件</p>
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{card.documents}</p>
        </div>
      )}
      <a
        href={card.url}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ variant: "outline", className: "self-start" })}
      >
        官方連結
      </a>
    </Section>
  );
}
