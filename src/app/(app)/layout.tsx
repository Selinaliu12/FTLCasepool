import { requireOk } from "@/server/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireOk();
  return <>{children}</>;
}
