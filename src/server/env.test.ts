import { describe, it, expect, afterEach } from "vitest";

describe("env.enableTestLogin", () => {
  const original = {
    VERCEL: process.env.VERCEL,
    ENABLE_TEST_LOGIN: process.env.ENABLE_TEST_LOGIN,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };

  afterEach(() => {
    if (original.NEXT_PUBLIC_SUPABASE_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = original.NEXT_PUBLIC_SUPABASE_URL;
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

  it("ENABLE_TEST_LOGIN=true、沒有 VERCEL、Supabase 在本機時，enableTestLogin 為 true", async () => {
    process.env.ENABLE_TEST_LOGIN = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    delete process.env.VERCEL;
    const { env } = await import("./env");
    expect(env.enableTestLogin).toBe(true);
  });

  // 最終審查 M9：不在 Vercel 上（例如別的主機、或自己架的 staging）但連的是正式 Supabase 時，
  // 就算誤設 ENABLE_TEST_LOGIN=true，也不能開放「固定密碼直接登入」。跟 local-only.ts 同一套判斷。
  it("Supabase 不在本機時，就算 ENABLE_TEST_LOGIN=true 也為 false", async () => {
    process.env.ENABLE_TEST_LOGIN = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcd.supabase.co";
    delete process.env.VERCEL;
    const { env } = await import("./env");
    expect(env.enableTestLogin).toBe(false);
  });

  it("沒有設定 Supabase URL 時為 false（不丟例外）", async () => {
    process.env.ENABLE_TEST_LOGIN = "true";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.VERCEL;
    const { env } = await import("./env");
    expect(env.enableTestLogin).toBe(false);
  });
});

describe("env.r2 endpoint/region", () => {
  const original = { R2_ENDPOINT: process.env.R2_ENDPOINT, R2_REGION: process.env.R2_REGION };

  afterEach(() => {
    if (original.R2_ENDPOINT === undefined) delete process.env.R2_ENDPOINT;
    else process.env.R2_ENDPOINT = original.R2_ENDPOINT;
    if (original.R2_REGION === undefined) delete process.env.R2_REGION;
    else process.env.R2_REGION = original.R2_REGION;
  });

  it("有設定 R2_ENDPOINT 時，env.r2.endpoint 回傳該值", async () => {
    process.env.R2_ENDPOINT = "http://127.0.0.1:54321/storage/v1/s3";
    const { env } = await import("./env");
    expect(env.r2.endpoint).toBe("http://127.0.0.1:54321/storage/v1/s3");
  });

  it("沒有設定 R2_ENDPOINT 時，env.r2.endpoint 為 undefined", async () => {
    delete process.env.R2_ENDPOINT;
    const { env } = await import("./env");
    expect(env.r2.endpoint).toBeUndefined();
  });

  it("有設定 R2_REGION 時，env.r2.region 回傳該值", async () => {
    process.env.R2_REGION = "auto";
    const { env } = await import("./env");
    expect(env.r2.region).toBe("auto");
  });

  it("沒有設定 R2_REGION 時，env.r2.region 預設為 \"auto\"", async () => {
    delete process.env.R2_REGION;
    const { env } = await import("./env");
    expect(env.r2.region).toBe("auto");
  });
});

describe("env.r2 空字串視同沒設", () => {
  const keys = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT", "R2_REGION"] as const;
  const original = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

  afterEach(() => {
    for (const k of keys) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("R2_ENDPOINT、R2_REGION 是空字串時，endpoint 為 undefined（走真 R2）、region 為 auto", async () => {
    process.env.R2_ACCOUNT_ID = "a";
    process.env.R2_ACCESS_KEY_ID = "b";
    process.env.R2_SECRET_ACCESS_KEY = "c";
    process.env.R2_BUCKET = "x-test";
    process.env.R2_ENDPOINT = "";
    process.env.R2_REGION = "";
    const { env } = await import("./env");
    expect(env.r2.endpoint).toBeUndefined();
    expect(env.r2.region).toBe("auto");
  });
});
