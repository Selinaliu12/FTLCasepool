// 純資料，沒有 "use client"：new/page.tsx（server component）要拿一份空白表單初始值餵給
// <CompetitionForm />，不能從 server 呼叫定義在 "use client" 檔案裡的函式（那些函式只能被
// render 成元件或當 props 傳，不能直接呼叫——見 competition-form.tsx 開頭的 "use client"）。
export type CompetitionFormValues = {
  name: string;
  organizer: string;
  theme: string;
  eligibility: string;
  teamSize: string;
  prize: string;
  url: string;
  signupDate: string;
  signupTime: string;
  submissionDate: string;
  submissionTime: string;
  finalDate: string;
  finalTime: string;
  summary: string;
  tags: string[];
  maxPrize: string;
  perks: string;
  infoSessionDate: string;
  infoSessionTime: string;
  signupNote: string;
  submissionNote: string;
  finalNote: string;
  finalFormat: string;
  fee: string;
  documents: string;
  skills: string;
  recommended: boolean;
  staffNote: string;
};

const DEFAULT_TIME = "23:59";

export function emptyCompetitionForm(): CompetitionFormValues {
  return {
    name: "",
    organizer: "",
    theme: "",
    eligibility: "",
    teamSize: "",
    prize: "",
    url: "",
    signupDate: "",
    signupTime: DEFAULT_TIME,
    submissionDate: "",
    submissionTime: DEFAULT_TIME,
    finalDate: "",
    finalTime: DEFAULT_TIME,
    summary: "",
    tags: [],
    maxPrize: "",
    perks: "",
    infoSessionDate: "",
    infoSessionTime: DEFAULT_TIME,
    signupNote: "",
    submissionNote: "",
    finalNote: "",
    finalFormat: "",
    fee: "",
    documents: "",
    skills: "",
    recommended: false,
    staffNote: "",
  };
}
