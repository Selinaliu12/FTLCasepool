import { redirect } from "next/navigation";
import { getAccess } from "@/server/session";
import { createServiceSupabase } from "@/server/supabase";
import { formatTaipei } from "@/domain/time";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateSemesterForm } from "./create-semester-form";
import { RosterImport } from "./roster-import";
import { PeriodsForm, type PeriodRow } from "./periods-form";
import { PmAssign } from "./pm-assign";
import { SettingsForm } from "./settings-form";
import { MoveMemberForm } from "./move-member-form";

export default async function AdminPage() {
  const access = await getAccess();
  // (app)/layout.tsx 的 requireOk() 已經擋掉 wrong_domain／not_in_roster／
  // no_semester+非管理員；這裡只需要再擋「有學期但不是管理員」這一種漏網之魚。
  if (access.kind === "ok" && !access.isAdmin) redirect("/");

  const semesterId = access.kind === "ok" ? access.semesterId : null;

  if (!semesterId) {
    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
        <h1 className="font-heading text-2xl font-bold text-foreground">管理員設定</h1>
        <Card>
          <CardHeader>
            <CardTitle>本學期</CardTitle>
            <CardDescription>還沒有任何學期，先建立一個才能匯入名單。</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateSemesterForm />
          </CardContent>
        </Card>
      </main>
    );
  }

  const db = createServiceSupabase();

  const [semesterRes, groupsRes, membersRes, periodsRes, pmAssignmentsRes] = await Promise.all([
    db.from("semesters").select("id, name, red_after_hours").eq("id", semesterId).single(),
    db.from("groups").select("id, name, project_name").eq("semester_id", semesterId).order("name"),
    db.from("members").select("id, name, email, role, group_id").eq("semester_id", semesterId).order("name"),
    db.from("periods").select("id, seq, deadline").eq("semester_id", semesterId).order("seq"),
    db.from("pm_assignments").select("pm_member_id, group_id"),
  ]);

  const { data: semester, error: semesterError } = semesterRes;
  const { data: groups, error: groupsError } = groupsRes;
  const { data: members, error: membersError } = membersRes;
  const { data: periods, error: periodsError } = periodsRes;
  const { data: pmAssignments, error: pmAssignmentsError } = pmAssignmentsRes;

  const sectionErrors: Record<string, boolean> = {
    本學期: !!semesterError,
    名單匯入: !!(groupsError || membersError),
    期別表: !!periodsError,
    專案幹部負責組別: !!(groupsError || membersError || pmAssignmentsError),
    燈號門檻: !!semesterError,
    換組: !!(groupsError || membersError),
  };

  function ErrorCard({ title, section }: { title: string; section: string }) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p role="alert" className="text-sm text-destructive">
            讀取資料失敗，請重新整理（{section}）
          </p>
        </CardContent>
      </Card>
    );
  }

  const groupList = groups ?? [];
  const memberList = members ?? [];
  const periodList = periods ?? [];
  const pmList = memberList.filter((m) => m.role === "pm");
  const studentList = memberList.filter((m) => m.role === "student");
  const alreadyImported = memberList.length > 0;

  const groupNameById = new Map(groupList.map((g) => [g.id as string, g.name as string]));

  const initialAssignments: Record<string, string[]> = {};
  for (const pm of pmList) initialAssignments[pm.id as string] = [];
  for (const a of pmAssignments ?? []) {
    const list = initialAssignments[a.pm_member_id as string] ?? [];
    list.push(a.group_id as string);
    initialAssignments[a.pm_member_id as string] = list;
  }

  const initialPeriodRows: PeriodRow[] = periodList.map((p) => {
    const d = new Date(p.deadline as string);
    // formatTaipei 是給人看的顯示格式；期別表輸入用得到 <input type="date/time"> 需要的
    // yyyy-mm-dd／HH:mm，所以這裡另外算，不重用 formatTaipei 的輸出格式。
    const taipei = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      date: `${taipei.getUTCFullYear()}-${pad(taipei.getUTCMonth() + 1)}-${pad(taipei.getUTCDate())}`,
      time: `${pad(taipei.getUTCHours())}:${pad(taipei.getUTCMinutes())}`,
    };
  });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="font-heading text-2xl font-bold text-foreground">管理員設定</h1>

      {sectionErrors.本學期 ? (
        <ErrorCard title="本學期" section="本學期" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>本學期</CardTitle>
            <CardDescription>目前學期：{semester?.name}</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateSemesterForm />
          </CardContent>
        </Card>
      )}

      {sectionErrors.名單匯入 ? (
        <ErrorCard title="名單匯入" section="名單匯入" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>名單匯入</CardTitle>
            <CardDescription>貼上或上傳 CSV：email、姓名、角色、組別、專案名稱。</CardDescription>
          </CardHeader>
          <CardContent>
            <RosterImport semesterId={semesterId} alreadyImported={alreadyImported} />
          </CardContent>
        </Card>
      )}

      {sectionErrors.期別表 ? (
        <ErrorCard title="期別表" section="期別表" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>期別表</CardTitle>
            <CardDescription>依截止日期排序，自動編為第 1、2、3…期。</CardDescription>
          </CardHeader>
          <CardContent>
            <PeriodsForm semesterId={semesterId} initialRows={initialPeriodRows} />
          </CardContent>
        </Card>
      )}

      {sectionErrors.專案幹部負責組別 ? (
        <ErrorCard title="專案幹部負責組別" section="專案幹部負責組別" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>專案幹部負責組別</CardTitle>
            <CardDescription>勾選每位專案幹部負責看哪些組。</CardDescription>
          </CardHeader>
          <CardContent>
            <PmAssign
              pms={pmList.map((p) => ({ id: p.id as string, name: p.name as string }))}
              groups={groupList.map((g) => ({ id: g.id as string, name: g.name as string }))}
              initialAssignments={initialAssignments}
            />
          </CardContent>
        </Card>
      )}

      {sectionErrors.燈號門檻 ? (
        <ErrorCard title="燈號門檻" section="燈號門檻" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>燈號門檻</CardTitle>
            <CardDescription>超過這個小時數沒有回應，燈號自動轉紅。</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingsForm semesterId={semesterId} initialHours={(semester?.red_after_hours as number) ?? 72} />
          </CardContent>
        </Card>
      )}

      {sectionErrors.換組 ? (
        <ErrorCard title="換組" section="換組" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>換組</CardTitle>
            <CardDescription>學期中把專案生調到另一組；舊組的進度紀錄不會被搬動。</CardDescription>
          </CardHeader>
          <CardContent>
            <MoveMemberForm
              students={studentList.map((s) => ({
                id: s.id as string,
                name: s.name as string,
                groupName: s.group_id ? groupNameById.get(s.group_id as string) ?? null : null,
              }))}
              groups={groupList.map((g) => ({ id: g.id as string, name: g.name as string }))}
            />
          </CardContent>
        </Card>
      )}

      {periodList.length > 0 && (
        <p className="text-sm text-muted-foreground">
          最近一期截止：{formatTaipei(new Date(periodList[periodList.length - 1].deadline as string))}
        </p>
      )}
    </main>
  );
}
