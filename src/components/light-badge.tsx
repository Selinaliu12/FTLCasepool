import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import type { Light } from "@/domain/lights";

const LIGHT_TEXT: Record<Light, string> = {
  green: "綠燈",
  yellow: "黃燈",
  red: "紅燈",
};

const LIGHT_DOT_CLASS: Record<Light, string> = {
  green: "bg-[var(--ok)]",
  yellow: "bg-[var(--warn)]",
  red: "bg-[var(--danger)]",
};

export function LightBadge({ light, source }: { light: Light; source: string }) {
  const text = LIGHT_TEXT[light];
  return (
    <Badge variant="outline" aria-label={`${text}，${source}`}>
      <span className={cn("inline-block size-2 rounded-full", LIGHT_DOT_CLASS[light])} aria-hidden="true" />
      <span>{text}</span>
      <span>{source}</span>
    </Badge>
  );
}
