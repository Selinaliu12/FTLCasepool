import { notFound } from "next/navigation";
import { loadCompetition } from "@/server/queries/competitions";
import { taipeiInputValues } from "@/domain/time";
import { CompetitionForm } from "../../competition-form";

// loadCompetition 已經把「不是幹部／管理員」「不存在」「id 亂填」都轉成 null——這裡只需要把
// null 轉成 404，跟 /groups/[groupId] 的寫法一致。
export default async function EditCompetitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadCompetition(id);
  if (!data) notFound();

  const signup = taipeiInputValues(data.signupDeadline);
  const submission = data.submissionDeadline ? taipeiInputValues(data.submissionDeadline) : null;
  const final = data.finalDate ? taipeiInputValues(data.finalDate) : null;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="font-heading text-2xl font-bold text-foreground">編輯競賽</h1>
      <CompetitionForm
        competitionId={data.id}
        status={data.status}
        initial={{
          name: data.name,
          organizer: data.organizer ?? "",
          theme: data.theme ?? "",
          eligibility: data.eligibility ?? "",
          teamSize: data.teamSize ?? "",
          prize: data.prize ?? "",
          url: data.url,
          signupDate: signup.date,
          signupTime: signup.time,
          submissionDate: submission?.date ?? "",
          submissionTime: submission?.time ?? "23:59",
          finalDate: final?.date ?? "",
          finalTime: final?.time ?? "23:59",
        }}
      />
    </main>
  );
}
