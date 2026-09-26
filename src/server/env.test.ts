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
