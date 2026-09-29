// Task 7（規格 §16 第 5 點）：已離開的人，紀錄上（交件人、點燈的人、參賽成員…）照常顯示，但名字
// 後面標「（已離開）」。

export function memberDisplayName(name: string, leftAt: string | null): string {
  return leftAt ? `${name}（已離開）` : name;
}

export type NameRow = { email: string; name: string; left_at: string | null };

// 以信箱找名字（進度、點燈紀錄都用信箱記「是誰」）。「已離開」是在呼叫端傳進來的這批 rows 範圍
// 內判斷的，不是看這個人在整個學期的所有身份（Task 7 review minor 3 的裁決：以看的人能看到的
// 範圍為準）。呼叫端傳整個學期的名單（管理員頁）就是整個學期範圍；傳單一組的名單（學生看自己組
// 的組別頁）就是那個組的範圍——同一個人如果在別組還在、只是這一組的身份離開了，組員看到的會是
// 「（已離開）」，即使這個人其實還活躍在別的地方。只要傳進來的這批 rows 裡，這個信箱還有任何一列
// 沒離開，就顯示正常姓名；全部離開才標「（已離開）」。重新加回（恢復那一列）之後 left_at 清掉，
// 名字自然恢復正常。
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
