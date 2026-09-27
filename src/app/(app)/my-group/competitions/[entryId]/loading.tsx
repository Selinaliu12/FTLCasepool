import { PageSkeleton } from "@/components/route-states";

// Final review minor 6：資料還沒讀完時的骨架畫面。
export default function Loading() {
  return <PageSkeleton cards={3} />;
}
