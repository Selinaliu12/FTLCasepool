import { redirect } from "next/navigation";
import { requireOk } from "@/server/session";
import { hasAcknowledged } from "@/server/queries/acknowledgement";
import { AppHeader } from "@/components/app-header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await requireOk();
  // no_semester＋管理員沒有學期可以承認，跳過檢查（否則會卡在 /welcome 出不來）；
  // kind "ok" 一定有真的 semesterId，每學期第一次都要按過「我已了解」才能繼續。
  if (access.kind === "ok" && !(await hasAcknowledged(access.semesterId, access.email))) {
    redirect("/welcome");
  }
  return (
    <>
      <AppHeader access={access} />
      {children}
    </>
  );
}
