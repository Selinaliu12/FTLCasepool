import { redirect } from "next/navigation";
import { requireOk } from "@/server/session";

export default async function RootPage() {
  const access = await requireOk();
  if (access.isAdmin) redirect("/admin");
  if (access.kind === "ok" && (access.member?.role === "pm" || access.member?.role === "officer")) redirect("/dashboard");
  redirect("/my-group");
}
