import { describe, it, expect } from "vitest";
import { nameByEmailMap, memberDisplayName } from "./member-name";

// Task 7（規格 §16 第 5 點）：紀錄上顯示做事的人時，已離開的人顯示「姓名（已離開）」。
describe("memberDisplayName", () => {
  it("還在 → 姓名；已離開 → 姓名（已離開）", () => {
    expect(memberDisplayName("王小明", null)).toBe("王小明");
    expect(memberDisplayName("王小明", "2026-09-29T00:00:00Z")).toBe("王小明（已離開）");
  });
});

describe("nameByEmailMap（以信箱找名字）", () => {
  it("這個信箱所有身份都離開 → 姓名（已離開）", () => {
    const map = nameByEmailMap([
      { email: "wang@g.nccu.edu.tw", name: "王小明", left_at: "2026-09-29T00:00:00Z" },
      { email: "wang@g.nccu.edu.tw", name: "王小明", left_at: "2026-09-29T01:00:00Z" },
    ]);
    expect(map.get("wang@g.nccu.edu.tw")).toBe("王小明（已離開）");
  });

  it("還有任何一個身份在（例如只移除了專案生、還是幹部）→ 正常姓名，不論列的順序", () => {
    const rows = [
      { email: "wang@g.nccu.edu.tw", name: "王小明", left_at: "2026-09-29T00:00:00Z" },
      { email: "wang@g.nccu.edu.tw", name: "王小明", left_at: null },
    ];
    expect(nameByEmailMap(rows).get("wang@g.nccu.edu.tw")).toBe("王小明");
    expect(nameByEmailMap([...rows].reverse()).get("wang@g.nccu.edu.tw")).toBe("王小明");
  });

  it("不在名單上的信箱查不到（呼叫端退回顯示信箱）", () => {
    expect(nameByEmailMap([]).get("x@g.nccu.edu.tw")).toBeUndefined();
  });
});
