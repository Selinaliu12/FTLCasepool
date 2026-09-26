const TAIPEI_MS = 8 * 60 * 60 * 1000;

export function taipeiDateKey(d: Date): string {
  return new Date(d.getTime() + TAIPEI_MS).toISOString().slice(0, 10);
}

// 截止時間轉成 <input type="date">／<input type="time"> 要的台北 yyyy-mm-dd／HH:mm（到分）。
// 跟 formatTaipei（給人看的顯示格式）分開，是 parseTaipeiDeadline 的反向。
export function taipeiInputValues(d: Date): { date: string; time: string } {
  const iso = new Date(d.getTime() + TAIPEI_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export function parseTaipeiDeadline(date: string, time: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error("日期或時間格式錯誤");
  const d = new Date(`${date}T${time}:59.999+08:00`);
  if (Number.isNaN(d.getTime())) throw new Error("日期或時間格式錯誤");
  // Verify the date round-trips to reject invalid dates like 2026-02-30
  if (taipeiDateKey(d) !== date) throw new Error("日期或時間格式錯誤");
  return d;
}

export function daysUntil(deadline: Date, now: Date): number {
  const a = Date.parse(`${taipeiDateKey(now)}T00:00:00Z`);
  const b = Date.parse(`${taipeiDateKey(deadline)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
export function formatTaipei(d: Date): string {
  const t = new Date(d.getTime() + TAIPEI_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCMonth() + 1}/${p(t.getUTCDate())}（${WEEK[t.getUTCDay()]}）${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}
