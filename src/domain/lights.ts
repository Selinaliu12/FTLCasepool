export type Light = "green" | "yellow" | "red";

export const LIGHT_LABEL: Record<Light, string> = {
  green: "綠燈",
  yellow: "黃燈",
  red: "紅燈",
};

// 燈號嚴重程度：紅 > 黃 > 綠。顯示燈（取較嚴重者）、看板排序都用這一份，不要各自再定義。
export const LIGHT_SEVERITY: Record<Light, number> = { red: 2, yellow: 1, green: 0 };

// 期別名稱全站統一「第 N 期」（有空格）：組頁、看板、系統判定燈的來源文字都用這個。
export function periodLabel(seq: number): string {
  return `第 ${seq} 期`;
}

export type Deliverable = {
  label: string;
  deadline: Date;
  submittedAt: Date | null;
  returned?: boolean;
};

export type SystemLight = { light: Light; reason: string | null };

export function overdueLabel(hours: number): string {
  if (hours < 24) return `逾期 ${Math.floor(hours)} 小時`;
  return `逾期 ${Math.floor(hours / 24)} 天`;
}

export function systemLight(ds: Deliverable[], now: Date, s: { redAfterHours: number }): SystemLight {
  let worst: { light: Light; reason: string; hours: number } | null = null;

  for (const d of ds) {
    let hours: number;
    let light: Light;

    if (d.returned) {
      hours = 0;
      light = "yellow";
    } else if (d.submittedAt === null && now.getTime() > d.deadline.getTime()) {
      hours = (now.getTime() - d.deadline.getTime()) / 3_600_000;
      light = hours >= s.redAfterHours ? "red" : "yellow";
    } else {
      continue;
    }

    const reason = d.returned ? `系統：${d.label}被退回` : `系統：${d.label}${overdueLabel(hours)}`;
    const severity = LIGHT_SEVERITY[light];
    const worstSeverity = worst ? LIGHT_SEVERITY[worst.light] : -1;

    if (
      !worst ||
      severity > worstSeverity ||
      (severity === worstSeverity && hours > worst.hours)
    ) {
      worst = { light, reason, hours };
    }
  }

  if (!worst) return { light: "green", reason: null };
  return { light: worst.light, reason: worst.reason };
}

export function displayLight(reporter: Light | null, system: SystemLight): { light: Light; source: string } {
  if (reporter === null) {
    if (system.light === "green") return { light: "green", source: "系統：沒有欠交" };
    return { light: system.light, source: system.reason as string };
  }

  const reporterSev = LIGHT_SEVERITY[reporter];
  const systemSev = LIGHT_SEVERITY[system.light];

  if (reporterSev > systemSev) {
    return { light: reporter, source: "組員回報" };
  }
  if (systemSev > reporterSev) {
    return { light: system.light, source: system.reason as string };
  }
  // equal severity
  if (reporter === "green") {
    return { light: "green", source: "組員回報" };
  }
  return { light: reporter, source: `組員回報＋${system.reason}` };
}

export function reporterLight(events: { light: Light; at: Date }[]): Light | null {
  if (events.length === 0) return null;
  let latest = events[0];
  for (const e of events) {
    if (e.at.getTime() > latest.at.getTime()) latest = e;
  }
  return latest.light;
}
