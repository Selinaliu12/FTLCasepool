import { PageSkeleton } from "@/components/route-states";

// Final review minor 6：資料還沒讀完時的骨架畫面。放在 route group 裡，只包住這一頁本身：
// 底下會 notFound() 的子路由（報名頁、編輯頁）不能被 loading.tsx 包住，不然會串流、送出 200
// 而不是 404（controller ruling 4，commit fdf856f）。
export default function Loading() {
  return <PageSkeleton cards={3} />;
}
