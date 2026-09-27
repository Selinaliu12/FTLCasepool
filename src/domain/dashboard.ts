import { systemLight, reporterLight, displayLight, LIGHT_SEVERITY, periodLabel, type Light, type Deliverable } from "./lights";
import { onTimeRate } from "./on-time";
import { daysUntil, formatTaipei } from "./time";

export type GroupCardLine = {
  lineId: string;
  kind: "project" | "competition";
  label: string;
  light: Light;
  source: string;
  onTime: number | null;
};

export type GroupCard = {
  groupId: string;
  groupName: string;
  projectName: string;
  lines: GroupCardLine[];
  stage: string;
  nextDeadline: { at: Date; daysLeft: number } | null;
};

export function worstLight(card: GroupCard): Light {
  let worst: Light = "green";
  for (const line of card.lines) {
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
    ? { at: upcoming.deadline, daysLeft: daysUntil(upcoming.deadline, now) }
    : null;
  const stage = upcoming ? periodLabel(upcoming.seq) : "本學期期別已結束";

  return {
    groupId: group.id,
    groupName: group.name,
    projectName: group.projectName,
    lines: [{ lineId, kind: "project", label: "專案", light: display.light, source: display.source, onTime }],
    stage,
    nextDeadline,
  };
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
