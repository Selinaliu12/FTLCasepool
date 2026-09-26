import { describe, it, expect, vi } from "vitest";

// 最終審查 M8：同一個請求裡 layout、頁面、server component 各自呼叫 getAccess()，每次都重新
// 打 Supabase（getUser＋查學期＋查名單）。用 React cache() 包起來，同一個 RSC 請求只查一次。
// cache() 只有在 React Server Components 的執行環境裡才真的會記憶，這裡改成驗證「getAccess 就是
// cache() 包出來的那個函式」。
const cached = vi.fn();
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    cache: (fn: unknown) => {
      cached(fn);
      return Object.assign((...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args), { __cached: true });
    },
  };
});

describe("getAccess", () => {
  it("用 React cache() 包起來（同一個請求只查一次）", async () => {
    const { getAccess } = await import("./session");
    expect(cached).toHaveBeenCalledTimes(1);
    expect((getAccess as unknown as { __cached?: boolean }).__cached).toBe(true);
  });
});
