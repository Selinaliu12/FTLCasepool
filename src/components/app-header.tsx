import Link from "next/link";
import type { Access } from "@/domain/access";
import { AppNav, type NavLink } from "./app-nav";
import { SignOutButton } from "./sign-out-button";

type HeaderAccess = Extract<Access, { kind: "ok" } | { kind: "no_semester" }>;

// 依角色決定頁首連結：管理員＝學期設定＋總覽看板；專案幹部／其他幹部＝總覽看板；專案生＝我的組別。
// 還沒有任何學期的管理員（no_semester）只能先去建學期，看板沒有資料，只給「學期設定」。
// 競賽大廳（batch 2 task 2）：所有身分都加這個連結，但前提是已經有學期可看——還沒有任何學期
// 的管理員（no_semester）沒有 semesterId，大廳沒東西可查，跟總覽看板一樣先不給連結。
export function navLinksFor(access: HeaderAccess): NavLink[] {
  if (access.isAdmin) {
    return access.kind === "ok"
      ? [
          { href: "/admin", label: "學期設定" },
          { href: "/dashboard", label: "總覽看板" },
          { href: "/competitions", label: "競賽大廳" },
        ]
      : [{ href: "/admin", label: "學期設定" }];
  }
  if (access.kind !== "ok" || !access.member) return [];
  if (access.member.role === "student") {
    return [
      { href: "/my-group", label: "我的組別" },
      { href: "/competitions", label: "競賽大廳" },
    ];
  }
  return [
    { href: "/dashboard", label: "總覽看板" },
    { href: "/competitions", label: "競賽大廳" },
  ];
}

// 頁首顯示名單上的姓名；不在名單上的管理員沒有姓名，顯示登入的 email。
export function displayNameFor(access: HeaderAccess): string {
  if (access.kind === "ok") return access.member?.name ?? access.email;
  return "管理員";
}

export function AppHeader({ access }: { access: HeaderAccess }) {
  const name = displayNameFor(access);
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line,#DEE9F8)] bg-card/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
        <Link href="/" className="font-heading text-base font-bold text-foreground">
          FTL 競賽池
        </Link>
        <div className="order-3 w-full pb-1 sm:order-none sm:w-auto sm:pb-0">
          <AppNav links={navLinksFor(access)} />
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <span className="max-w-[12rem] truncate text-sm text-[var(--ink-2,#3E4F70)]" title={name}>
            {name}
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
