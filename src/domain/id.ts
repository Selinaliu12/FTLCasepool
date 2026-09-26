const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 打資料庫前先擋掉不是 UUID 格式的 id：PostgREST 對非 uuid 格式的 eq() 條件會丟 22P02
// （invalid_text_representation），不是「查無此列」——不擋的話，亂填的網址（/groups/abc、
// 下載一個假的 reportId）會變成未處理的例外／500，不是我們要的「找不到」。
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
