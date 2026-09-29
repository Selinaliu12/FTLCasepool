import { systemLight, reporterLight, displayLight, LIGHT_SEVERITY, periodLabel, type Light, type Deliverable } from "./lights";
import { onTimeRate } from "./on-time";
import { daysUntil, formatTaipei } from "./time";
import type { CompetitionStatus } from "./competition-line";
import { compareNatural } from "./natural-sort";

// fix round 1（controller ruling）：一條線可以「結束」（已退出／得獎／未入選）——結束的線
// light 是 null，不是綠燈，UI 改顯示成果徽章（status）而不是 LightBadge。project 線永遠不會
// 結束，status 固定 null、light 永遠有值。
export type GroupCardLine = {
  lineId: string;
  kind: "project" | "competition";
  label: string;
  status: CompetitionStatus | null;
  light: Light | null;
  source: string | null;
  onTime: number | null;
  // 比賽線才有：下一個必要、還沒完成的階段（nextRequiredStage）與顯示文字
  // （formatStageDeadline）。專案線不填。
  nextStage?: { label: string; at: Date; text: string } | null;
};

// Task 4（規格 §14 第 5、6 點）：組員「姓名 · 系級」（系級 null → 「—」由元件層決定）。
export type GroupCardMember = { name: string; deptYear: string | null };

export type GroupCard = {
  groupId: string;
  groupName: string;
  // Adjustments controller ruling：專案名稱選填，只有填了才顯示（由元件層決定）。
  projectName: string | null;
  // 組別備註（「訂題後的主題」）：沒填是 null，顯示「尚未訂題」由元件層決定。
  note: string | null;
  // 依姓名排序（見 sortMembersByName），buildGroupCard 已經排好序。
  members: GroupCardMember[];
  lines: GroupCardLine[];
  stage: string;
  // lineLabel：這個截止日屬於哪一條線（「專案」或「<比賽名稱> <階段>」）。
  nextDeadline: { at: Date; daysLeft: number; lineLabel: string } | null;
};

// 依姓名為數字感知排序（第1組在第10組前面同一套規則），dashboard／my-group／group-detail
// 的組員清單共用。
export function sortMembersByName<M extends { name: string }>(members: M[]): M[] {
  return [...members].sort((a, b) => compareNatural(a.name, b.name));
}

export function worstLight(card: GroupCard): Light {
  let worst: Light = "green";
  for (const line of card.lines) {
    if (line.light === null) continue; // 已結束的線沒有燈，不影響排序或整組的顯示燈。
    if (LIGHT_SEVERITY[line.light] > LIGHT_SEVERITY[worst]) worst = line.light;
  }
  return worst;
}

export function sortGroupCards(cards: GroupCard[]): GroupCard[] {
  return [...cards].sort((a, b) => {
    const diff = LIGHT_SEVERITY[worstLight(b)] - LIGHT_SEVERITY[worstLight(a)];
    if (diff !== 0) return diff;
    return compareNatural(a.groupName, b.groupName);
  });
}

export function buildGroupCard(input: {
  group: { id: string; name: string; projectName: string | null };
  lineId: string;
  periods: { seq: number; deadline: Date }[];
  submissions: { periodSeq: number; submittedAt: Date }[];
  events: { light: Light; at: Date }[];
  now: Date;
  redAfterHours: number;
  note?: string | null;
  members?: GroupCardMember[];
}): GroupCard {
  const { group, lineId, periods, submissions, events, now, redAfterHours, note = null, members = [] } = input;

  const deliverables: Deliverable[] = periods.map((p) => ({
    label: periodLabel(p.seq),
    deadline: p.deadline,
    submittedAt: submissions.find((s) => s.periodSeq === p.seq)?.submittedAt ?? null,
  }));

  const sys = systemLight(deliverables, now, { redAfterHours });
  const reporter = reporterLight(events);
  const display = displayLight(reporter, sys);
  const onTime = onTimeRate(deliverables, now);

  const upcoming = upcomingPeriod(periods, now);

  const nextDeadline = upcoming
    ? { at: upcoming.deadline, daysLeft: daysUntil(upcoming.deadline, now), lineLabel: "專案" }
    : null;
  const stage = upcoming ? periodLabel(upcoming.seq) : "本學期期別已結束";

  return {
    groupId: group.id,
    groupName: group.name,
    projectName: group.projectName,
    note,
    members: sortMembersByName(members),
    lines: [{ lineId, kind: "project", label: "專案", status: null, light: display.light, source: display.source, onTime }],
    stage,
    nextDeadline,
  };
}

// Final review IMPORTANT 2：卡片層級的「下一個截止」＝所有還沒結束的線裡最早、而且還沒過的
// 截止日——專案線是下一個期別（buildGroupCard 算好的），比賽線是 nextStage（下一個必要、
// 還沒完成的階段）。已經過了的比賽階段不算「下一個」（逾期已經由燈號表示），跟專案線只看
// 還沒截止的期別同一個規則。結束的比賽線沒有必要階段，nextStage 本來就是 null。
export function foldCompetitionDeadlines(card: GroupCard, now: Date): GroupCard {
  let best = card.nextDeadline;
  for (const line of card.lines) {
    if (line.kind !== "competition" || !line.nextStage) continue;
    const at = line.nextStage.at;
    if (at.getTime() < now.getTime()) continue;
    if (best === null || at.getTime() < best.at.getTime()) {
      best = { at, daysLeft: daysUntil(at, now), lineLabel: `${line.label} ${line.nextStage.label}` };
    }
  }
  return { ...card, nextDeadline: best };
}

// 下一個還沒截止的期別（截止時間最早的那一期）；全部都截止了回傳 null。看板與管理頁共用。
export function upcomingPeriod<P extends { deadline: Date }>(periods: P[], now: Date): P | null {
  return (
    periods
      .filter((p) => p.deadline.getTime() > now.getTime())
      .sort((a, b) => a.deadline.getTime() - b.deadline.getTime())[0] ?? null
  );
}

export function formatNextDeadline(nextDeadline: { at: Date; daysLeft: number } | null): string {
  if (nextDeadline === null) return "本學期期別已結束";
  const left = nextDeadline.daysLeft === 0 ? "今天截止" : `剩 ${nextDeadline.daysLeft} 天`;
  return `${formatTaipei(nextDeadline.at)} · ${left}`;
}
