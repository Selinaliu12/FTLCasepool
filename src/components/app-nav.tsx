"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

export type NavLink = { href: string; label: string };

// 頁首的導覽連結。只有這一小塊需要 usePathname（標出目前所在頁），其餘頁首都留在 server component。
export function AppNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  if (links.length === 0) return null;
  return (
    <nav aria-label="主要導覽" className="flex items-center gap-1">
      {links.map((l) => {
        const active = pathname === l.href || pathname.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center rounded-[var(--r-sm,12px)] px-3 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active ? "bg-primary/10 text-primary" : "text-[var(--ink-2,#3E4F70)] hover:bg-muted hover:text-foreground"
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
