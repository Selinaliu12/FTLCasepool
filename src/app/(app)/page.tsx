import { redirect } from "next/navigation";
import { requireOk } from "@/server/session";
import { homeFor } from "@/domain/access";

export default async function RootPage() {
  const access = await requireOk();
  // no_semester 只可能是管理員（requireOk 已經把非管理員導走）；kind "ok" 依目前身份的首頁。
  if (access.kind === "no_semester") redirect("/admin");
  redirect(homeFor(access.active));
}
