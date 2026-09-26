import { describe, it, expect } from "vitest";
import { mapCheckinHistory } from "./checkin-history";

describe("mapCheckinHistory", () => {
  it("把原始 checkins 列（created_by／created_at）轉成顯示用姓名與 Date，找不到姓名時退回 email", () => {
    const rows = [
      { light: "red" as const, note: "卡在資料串接", created_by: "a1@g.nccu.edu.tw", created_at: "2026-09-27T00:46:00Z" },
      { light: "green" as const, note: null, created_by: "ghost@g.nccu.edu.tw", created_at: "2026-09-26T00:00:00Z" },
    ];
    const nameByEmail = new Map([["a1@g.nccu.edu.tw", "甲一"]]);

    const result = mapCheckinHistory(rows, nameByEmail);

    expect(result).toEqual([
      { light: "red", note: "卡在資料串接", by: "甲一", at: new Date("2026-09-27T00:46:00Z") },
      { light: "green", note: null, by: "ghost@g.nccu.edu.tw", at: new Date("2026-09-26T00:00:00Z") },
    ]);
  });
});
