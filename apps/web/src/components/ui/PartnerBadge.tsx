import { Award01Icon } from "@hugeicons/core-free-icons";
import { partnerBadges, type PartnerBadgeId } from "@fintranzact/shared";
import { Icon } from "./Icon";
import { cn } from "@/lib/utils";

const TONE: Record<PartnerBadgeId, string> = {
  registered: "bg-surface-2 text-text-secondary ring-border-light",
  silver: "bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600",
  gold: "bg-amber-50 text-amber-800 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-700",
  platinum: "bg-indigo-50 text-indigo-800 ring-indigo-300 dark:bg-indigo-950 dark:text-indigo-200 dark:ring-indigo-700",
};

/** A partner's badge (Registered, Silver, Gold, Platinum) as a small pill. */
export function PartnerBadge({ badge, size = "sm", className }: { badge: string; size?: "sm" | "md"; className?: string }) {
  const info = partnerBadges.find((b) => b.id === badge) ?? partnerBadges[0];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold ring-1 ring-inset",
        size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs",
        TONE[info.id],
        className,
      )}
    >
      <Icon icon={Award01Icon} size={size === "md" ? 16 : 13} />
      {info.label}
    </span>
  );
}
