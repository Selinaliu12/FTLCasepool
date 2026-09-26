import type { Deliverable } from "./lights";

export function onTimeRate(ds: Deliverable[], now: Date): number | null {
  const due = ds.filter((d) => d.deadline.getTime() <= now.getTime());
  if (due.length === 0) return null;

  const onTime = due.filter(
    (d) => d.submittedAt !== null && d.submittedAt.getTime() <= d.deadline.getTime()
  ).length;

  return onTime / due.length;
}
