// Fix round 1（F4）：抽出唯一一份數字感知（natural）字串排序比較器，供組名／姓名排序共用
// （原本 dashboard.ts 的 sortMembersByName／sortGroupCards 與 competitions.ts 的
// sortGroupNames 各自內嵌同一段 localeCompare(…, "zh-Hant", { numeric: true })）。
//
// numeric: true 讓 "第2組" 排在 "第10組" 前面（數字部分照數值比較，不是逐字元的字典序）。
export function compareNatural(a: string, b: string): number {
  return a.localeCompare(b, "zh-Hant", { numeric: true });
}

// 依組名自然排序，去重不是這個函式的責任（呼叫端如果要去重，先用 Set 收斂再傳進來）。
export function sortNatural(values: string[]): string[] {
  return [...values].sort(compareNatural);
}
