import { cn } from "@/lib/utils";
import { ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./Icon";

const sourceLabels: Record<string, string> = {
  mybillbook: "myBillBook",
  tally: "Tally",
  generic: "CSV Import",
};

const sourceColors: Record<string, string> = {
  mybillbook: "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-400",
  tally: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-400",
  generic: "bg-surface-2 text-text-secondary",
};

export function SourceBadge({ source, className }: { source: string | null; className?: string }) {
  if (!source) return null;
  const label = sourceLabels[source] || source;
  const color = sourceColors[source] || sourceColors.generic;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium",
        color,
        className
      )}
    >
      <Icon icon={ArrowRight02Icon} size={10} strokeWidth={2} />
      {label}
    </span>
  );
}
