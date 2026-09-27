import { systemLight, reporterLight, displayLight, LIGHT_SEVERITY, periodLabel, type Light, type Deliverable } from "./lights";
import { onTimeRate } from "./on-time";
import { daysUntil, formatTaipei } from "./time";
import type { CompetitionStatus } from "./competition-line";

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

export type GroupCard = {
  groupId: string;
  groupName: string;
  projectName: string;
  lines: GroupCardLine[];
  stage: string;
  // lineLabel：這個截止日屬於哪一條線（「專案」或「<比賽名稱> <階段>」）。
  nextDeadline: { at: Date; daysLeft: number; lineLabel: string } | null;
};

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
    return a.groupName.localeCompare(b.groupName, "zh-Hant", { numeric: true });
  });
}

export function buildGroupCard(input: {
  group: { id: string; name: string; projectName: string };
  lineId: string;
  periods: { seq: number; deadline: Date }[];
  submissions: { periodSeq: number; submittedAt: Date }[];
  events: { light: Light; at: Date }[];
  now: Date;
  redAfterHours: number;
}): GroupCard {
  const { group, lineId, periods, submissions, events, now, redAfterHours } = input;

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
