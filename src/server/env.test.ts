import { describe, it, expect, afterEach } from "vitest";

describe("env.enableTestLogin", () => {
  const original = { VERCEL: process.env.VERCEL, ENABLE_TEST_LOGIN: process.env.ENABLE_TEST_LOGIN };

  afterEach(() => {
    if (original.VERCEL === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = original.VERCEL;
    if (original.ENABLE_TEST_LOGIN === undefined) delete process.env.ENABLE_TEST_LOGIN;
    else process.env.ENABLE_TEST_LOGIN = original.ENABLE_TEST_LOGIN;
  });

  it("VERCEL=1 時即使 ENABLE_TEST_LOGIN=true，enableTestLogin 仍為 false", async () => {
    process.env.ENABLE_TEST_LOGIN = "true";
    process.env.VERCEL = "1";
    const { env } = await import("./env");
    expect(env.enableTestLogin).toBe(false);
  });

  it("ENABLE_TEST_LOGIN=true 且沒有 VERCEL 時，enableTestLogin 為 true", async () => {
    process.env.ENABLE_TEST_LOGIN = "true";
    delete process.env.VERCEL;
    const { env } = await import("./env");
    expect(env.enableTestLogin).toBe(true);
  });
});
