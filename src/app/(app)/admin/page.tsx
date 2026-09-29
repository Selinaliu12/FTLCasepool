import { redirect } from "next/navigation";
import { getAccess } from "@/server/session";
import { createServiceSupabase } from "@/server/supabase";
import { formatTaipei, taipeiInputValues } from "@/domain/time";
import { periodLabel } from "@/domain/lights";
import { upcomingPeriod } from "@/domain/dashboard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateSemesterForm } from "./create-semester-form";
import { RosterImport } from "./roster-import";
import { PeriodsForm, type PeriodRow } from "./periods-form";
import { PmAssign } from "./pm-assign";
import { SettingsForm } from "./settings-form";
import { MoveMemberForm } from "./move-member-form";
import { MembersSection } from "./members-section";
import type { MemberListRow } from "@/domain/member-list";

export default async function AdminPage() {
  const access = await getAccess();
  // (app)/layout.tsx 的 requireOk() 已經擋掉 wrong_domain／not_in_roster／
  // no_semester+非管理員；這裡只需要再擋「有學期但目前身份不是管理員」這一種漏網之魚
  // （Adjustments Task 3：管理員兼名單身份的人要切回「管理員」身份才看得到這頁）。
  if (access.kind === "ok" && access.active.role !== "admin") redirect("/");

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
            <CreateSemesterForm currentSemesterName={null} />
          </CardContent>
        </Card>
      </main>
    );
  }

  const db = createServiceSupabase();

  const [semesterRes, groupsRes, membersRes, periodsRes, pmAssignmentsRes] = await Promise.all([
    db.from("semesters").select("id, name, red_after_hours").eq("id", semesterId).single(),
    db.from("groups").select("id, name, project_name").eq("semester_id", semesterId).order("name"),
    db
      .from("members")
      .select("id, name, email, role, student_id, dept_year, group_id, left_at")
      .eq("semester_id", semesterId)
      .order("name"),
    db.from("periods").select("id, seq, deadline, suggestion").eq("semester_id", semesterId).order("seq"),
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
    成員: !!(groupsError || membersError),
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
  // Task 7：已離開的身份不出現在「專案幹部負責組別」與「換組」選單。
  const activeMembers = memberList.filter((m) => !m.left_at);
  const pmList = activeMembers.filter((m) => m.role === "pm");
  const studentList = activeMembers.filter((m) => m.role === "student");
  const alreadyImported = memberList.length > 0;

  const groupNameById = new Map(groupList.map((g) => [g.id as string, g.name as string]));

  // 「成員」區塊（Task 5）：每一列身份，連同組名與是否已離開；以人為單位合併在元件裡做。
  const memberRows: MemberListRow[] = memberList.map((m) => ({
    id: m.id as string,
    email: m.email as string,
    name: m.name as string,
    role: m.role as MemberListRow["role"],
    groupName: m.group_id ? groupNameById.get(m.group_id as string) ?? null : null,
    studentId: (m.student_id as string | null) ?? null,
    deptYear: (m.dept_year as string | null) ?? null,
    leftAt: (m.left_at as string | null) ?? null,
  }));

  const initialAssignments: Record<string, string[]> = {};
  for (const pm of pmList) initialAssignments[pm.id as string] = [];
  for (const a of pmAssignments ?? []) {
    const list = initialAssignments[a.pm_member_id as string] ?? [];
    list.push(a.group_id as string);
    initialAssignments[a.pm_member_id as string] = list;
  }

  const nextPeriod = upcomingPeriod(
    periodList.map((p) => ({ seq: p.seq as number, deadline: new Date(p.deadline as string) })),
    new Date()
  );

  // 規格 §14 第 8 點：每一期都能改、都能刪（刪除有人交件的期別時，期別表會先跳確認視窗）。
  const initialPeriodRows: PeriodRow[] = periodList.map((p) => ({
    id: p.id as string,
    ...taipeiInputValues(new Date(p.deadline as string)),
    suggestion: (p.suggestion as string | null) ?? "",
  }));

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
            <CreateSemesterForm currentSemesterName={(semester?.name as string | undefined) ?? "目前學期"} />
          </CardContent>
        </Card>
      )}

      {sectionErrors.名單匯入 ? (
        <ErrorCard title="名單匯入" section="名單匯入" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>名單匯入</CardTitle>
            <CardDescription>貼上或上傳 CSV：email、姓名、角色、學號、系級、組別、專案名稱（專案名稱選填）。</CardDescription>
          </CardHeader>
          <CardContent>
            <RosterImport semesterId={semesterId} alreadyImported={alreadyImported} />
          </CardContent>
        </Card>
      )}

      {sectionErrors.成員 ? (
        <ErrorCard title="成員" section="成員" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>成員</CardTitle>
            <CardDescription>本學期名單上的每個人與他們的身份。名單匯入之後，學期中要加人，或替已在名單上的人加一個身份，按「新增成員」。</CardDescription>
          </CardHeader>
          <CardContent>
            <MembersSection
              rows={memberRows}
              groups={groupList
                .map((g) => ({ id: g.id as string, name: g.name as string }))
                .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true }))}
            />
          </CardContent>
        </Card>
      )}

      {sectionErrors.期別表 ? (
        <ErrorCard title="期別表" section="期別表" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>期別表</CardTitle>
            <CardDescription>依截止日期排序，自動編為第 1、2、3…期。任何一期都可以修改或刪除；刪除已有人交件的期別會一併刪掉那些進度與檔案。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {periodList.length > 0 && (
              <p className="text-sm text-[var(--ink-2,#3E4F70)]">
                {nextPeriod ? (
                  <>
                    下一期截止：{periodLabel(nextPeriod.seq)} ·{" "}
                    <span className="font-mono">{formatTaipei(nextPeriod.deadline)}</span>
                  </>
                ) : (
                  "本學期期別已結束"
                )}
              </p>
            )}
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
          <CardContent className="flex flex-col gap-3">
            {(() => {
              const assignedGroupIds = new Set((pmAssignments ?? []).map((a) => a.group_id as string));
              const unassigned = groupList.filter((g) => !assignedGroupIds.has(g.id as string));
              if (unassigned.length === 0) return null;
              return (
                <ul className="flex flex-col gap-1">
                  {unassigned.map((g) => (
                    <li key={g.id as string} role="alert" className="text-sm text-destructive">
                      {g.name as string}還沒有負責的專案幹部，比賽階段沒人能審核
                    </li>
                  ))}
                </ul>
              );
            })()}
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
            <CardDescription>逾期超過幾小時轉紅燈：期別過了截止時間還沒交，未滿這個小時數是黃燈，滿了就轉紅燈。</CardDescription>
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
                studentId: s.student_id as string | null,
                groupName: s.group_id ? groupNameById.get(s.group_id as string) ?? null : null,
              }))}
              groups={groupList.map((g) => ({ id: g.id as string, name: g.name as string }))}
            />
          </CardContent>
        </Card>
      )}

    </main>
  );
}
