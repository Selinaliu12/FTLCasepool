export default async function NotInRosterPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message = reason === "no_semester" ? "本學期尚未開放" : "你不在本學期名單中，請聯絡幹部";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <p className="text-center text-lg text-foreground">{message}</p>
    </main>
  );
}
