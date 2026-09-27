import { notFound } from "next/navigation";
import { getAccess } from "@/server/session";
import { CompetitionForm } from "../competition-form";
import { emptyCompetitionForm } from "../competition-form-defaults";

// 只有幹部與管理員可以新增競賽；學生（以及還沒有任何學期的管理員，這時沒有 semesterId 可以建）
// 打這條網址一律 404（規格第 3 節；controller ruling #4）。
export default async function NewCompetitionPage() {
  const access = await getAccess();
  const isStaff = access.kind === "ok" && access.active.role !== "student";
  if (!isStaff) notFound();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="font-heading text-2xl font-bold text-foreground">新增競賽</h1>
      <CompetitionForm initial={emptyCompetitionForm()} />
    </main>
  );
}
