import { cn } from "@/lib/utils";
import { Bone } from "./Skeleton";

interface SkeletonRowsProps {
  count?: number;
  height?: string;
  className?: string;
}

const WIDTHS = ["w-2/5", "w-1/3", "w-1/2", "w-1/4"];

/**
 * Generic loading rows for lists without a dedicated skeleton: each row reads
 * like a line of the list (a name, a detail and an amount), not a grey slab.
 * Pages with a table use TableSkeleton with their real column headings.
 */
export function SkeletonRows({ count = 6, height = "h-14", className }: SkeletonRowsProps) {
  // Short rows (detail panels, small widgets) are bare lines without a card.
  const compact = /\bh-(\d+)\b/.test(height) && Number(height.match(/\bh-(\d+)\b/)![1]) < 10;
  return (
    <div role="status" aria-label="Loading" className={cn("space-y-2", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          className={cn("flex items-center gap-4", compact ? "" : "rounded-lg border border-border-light bg-surface-0 px-4", height)}
        >
          <div className="grid min-w-0 flex-1 gap-1.5">
            <Bone className={WIDTHS[i % WIDTHS.length]} />
            {!compact && <Bone className="h-2.5 w-24 opacity-70" />}
          </div>
          <Bone className="w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}
