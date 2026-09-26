import { systemLight, reporterLight, displayLight, type Light, type Deliverable } from "./lights";
import { onTimeRate } from "./on-time";
import { daysUntil, formatTaipei } from "./time";

export type GroupCard = {
  groupId: string;
  groupName: string;
  projectName: string;
  lines: { lineId: string; kind: "project"; light: Light; source: string; onTime: number | null }[];
  stage: string;
  nextDeadline: { at: Date; daysLeft: number } | null;
};

const SEVERITY: Record<Light, number> = { red: 2, yellow: 1, green: 0 };

export function worstLight(card: GroupCard): Light {
  let worst: Light = "green";
  for (const line of card.lines) {
    if (SEVERITY[line.light] > SEVERITY[worst]) worst = line.light;
  }
  return worst;
}

export function sortGroupCards(cards: GroupCard[]): GroupCard[] {
  return [...cards].sort((a, b) => {
    const diff = SEVERITY[worstLight(b)] - SEVERITY[worstLight(a)];
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
    label: `第 ${p.seq} 期`,
    deadline: p.deadline,
    submittedAt: submissions.find((s) => s.periodSeq === p.seq)?.submittedAt ?? null,
  }));

  const sys = systemLight(deliverables, now, { redAfterHours });
  const reporter = reporterLight(events);
  const display = displayLight(reporter, sys);
  const onTime = onTimeRate(deliverables, now);

  const upcoming = periods
    .filter((p) => p.deadline.getTime() > now.getTime())
    .sort((a, b) => a.deadline.getTime() - b.deadline.getTime())[0];

  const nextDeadline = upcoming
    ? { at: upcoming.deadline, daysLeft: daysUntil(upcoming.deadline, now) }
    : null;
  const stage = upcoming ? `第 ${upcoming.seq} 期` : "本學期期別已結束";

  return {
    groupId: group.id,
    groupName: group.name,
    projectName: group.projectName,
    lines: [{ lineId, kind: "project", light: display.light, source: display.source, onTime }],
    stage,
    nextDeadline,
  };
}

export function formatNextDeadline(nextDeadline: { at: Date; daysLeft: number } | null): string {
  if (nextDeadline === null) return "本學期期別已結束";
  const left = nextDeadline.daysLeft === 0 ? "今天截止" : `剩 ${nextDeadline.daysLeft} 天`;
  return `${formatTaipei(nextDeadline.at)} · ${left}`;
}
