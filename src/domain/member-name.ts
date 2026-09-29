// Task 7（規格 §16 第 5 點）：已離開的人，紀錄上（交件人、點燈的人、參賽成員…）照常顯示，但名字
// 後面標「（已離開）」。

export function memberDisplayName(name: string, leftAt: string | null): string {
  return leftAt ? `${name}（已離開）` : name;
}

export type NameRow = { email: string; name: string; left_at: string | null };

// 以信箱找名字（進度、點燈紀錄都用信箱記「是誰」）。同一個人可能有好幾個身份：只要還有任何一個
// 身份在，他就還在名單上，顯示正常姓名；這個信箱的所有身份都離開了才標「（已離開）」。重新加回
// （恢復那一列）之後 left_at 清掉，名字自然恢復正常。
export function nameByEmailMap(rows: NameRow[]): Map<string, string> {
  const byEmail = new Map<string, { name: string; allLeft: boolean }>();
  for (const r of rows) {
    const cur = byEmail.get(r.email);
    if (!cur) {
      byEmail.set(r.email, { name: r.name, allLeft: !!r.left_at });
    } else if (!r.left_at) {
      byEmail.set(r.email, { name: r.name, allLeft: false });
    }
  }
  return new Map([...byEmail].map(([email, v]) => [email, v.allLeft ? `${v.name}（已離開）` : v.name]));
}
