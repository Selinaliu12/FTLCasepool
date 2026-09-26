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
