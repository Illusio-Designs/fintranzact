import { cn } from "@/lib/utils";

interface KbdShortcutProps {
  keys: string[];
  className?: string;
}

export function KbdShortcut({ keys, className }: KbdShortcutProps) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {keys.map((key, i) =>
        // Connector words in a sequence ("G then D") are prose, not keycaps.
        key === "then" ? (
          <span key={i} className="px-0.5 text-2xs text-text-tertiary">
            then
          </span>
        ) : (
          <kbd
            key={i}
            className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded bg-surface-2 text-2xs font-mono font-medium text-text-tertiary border border-border-light"
          >
            {key}
          </kbd>
        ),
      )}
    </span>
  );
}
