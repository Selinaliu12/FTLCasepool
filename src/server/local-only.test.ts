import { describe, it, expect } from "vitest";
import { assertLocalSupabaseUrl } from "./local-only";

describe("assertLocalSupabaseUrl", () => {
  it("127.0.0.1 通過", () => {
    expect(() => assertLocalSupabaseUrl("http://127.0.0.1:54321")).not.toThrow();
  });

  it("localhost 通過", () => {
    expect(() => assertLocalSupabaseUrl("http://localhost:54321")).not.toThrow();
  });

  it("正式站網址一律擋下", () => {
    expect(() => assertLocalSupabaseUrl("https://abcdefgh.supabase.co")).toThrow(
      "Refusing to run against non-local Supabase: abcdefgh.supabase.co"
    );
  });
});

describe("isLocalSupabaseUrl（最終審查 M9：跟 assertLocalSupabaseUrl 同一套判斷，回傳布林）", () => {
  it("127.0.0.1／localhost → true；其他 host 或壞掉的網址 → false", async () => {
    const { isLocalSupabaseUrl } = await import("./local-only");
    expect(isLocalSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLocalSupabaseUrl("http://localhost:54321")).toBe(true);
    expect(isLocalSupabaseUrl("https://abcd.supabase.co")).toBe(false);
    expect(isLocalSupabaseUrl("not a url")).toBe(false);
  });
});
