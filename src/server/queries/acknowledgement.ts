import "server-only";
import { createServiceSupabase } from "@/server/supabase";

// 這個學期、這個 email 按過「我已了解」沒有（規格 4.2）。
// 刻意不放在 "use server" 檔案裡：那種檔案匯出的每個 async 函式都會變成瀏覽器可以直接呼叫的
// server action，任何人都能拿任意 semesterId／email 探測誰按過。這裡是 server-only 的查詢，
// 只給 layout／頁面／server action 在伺服器端呼叫。
export async function hasAcknowledged(semesterId: string, email: string): Promise<boolean> {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("acknowledgements")
    .select("semester_id")
    .eq("semester_id", semesterId)
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}
