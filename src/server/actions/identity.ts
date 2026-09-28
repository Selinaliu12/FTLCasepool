"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAccess } from "@/server/session";
import { IDENTITY_COOKIE, homeFor, identityId } from "@/domain/access";

// 半年：規格 §14 第 3 點「登入後進上次用的身份」，cookie 要撐過瀏覽器關掉再開。
const ONE_HUNDRED_EIGHTY_DAYS = 60 * 60 * 24 * 180;

// 頁首身份切換（規格 §14 第 3 點）。只接受呼叫者自己的身份：id 不在這次 getAccess() 查到的
// identities 裡（別人的名單列 id、不存在的 id、非管理員傳 "admin"）一律不動 cookie，導回目前
// 身份的首頁——不報錯，也絕不把外來的 id 寫進 cookie。就算 cookie 被手動改掉，getAccess() 每次
// 也會重新對照名單驗證，這裡只是第一道關。
export async function switchIdentity(id: string): Promise<void> {
  const access = await getAccess();
  if (access.kind !== "ok") redirect("/");

  const target = typeof id === "string" ? access.identities.find((i) => identityId(i) === id) : undefined;
  if (!target) redirect(homeFor(access.active));

  const store = await cookies();
  store.set(IDENTITY_COOKIE, identityId(target), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_HUNDRED_EIGHTY_DAYS,
  });
  redirect(homeFor(target));
}
