import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "@/lib/utils";

export type { IconSvgElement };

interface IconProps {
  icon: IconSvgElement;
  /** Pixel size of the square icon. Defaults to 18. */
  size?: number;
  strokeWidth?: number;
  className?: string;
}

/**
 * The single icon primitive for the web app. Every icon comes from the
 * Hugeicons "stroke rounded" free set (`@hugeicons/core-free-icons`) and
 * inherits its colour from `currentColor`. Icons are decorative by default —
 * give the surrounding button an aria-label when the icon is the only content.
 */
export function Icon({ icon, size = 18, strokeWidth = 1.75, className }: IconProps) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={strokeWidth}
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    />
  );
}

export type IconCircleTone =
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "purple"
  | "cyan"
  | "neutral"
  | "solid";

const TONE_CLASSES: Record<IconCircleTone, string> = {
  brand: "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-200",
  success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  warning: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  danger: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  info: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  purple: "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  cyan: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
  neutral: "bg-surface-2 text-text-tertiary",
  solid: "bg-brand-600 text-white",
};

const CIRCLE_SIZES = {
  sm: { box: "h-8 w-8", icon: 16 },
  md: { box: "h-10 w-10", icon: 20 },
  lg: { box: "h-12 w-12", icon: 24 },
  xl: { box: "h-14 w-14", icon: 26 },
} as const;

interface IconCircleProps {
  icon: IconSvgElement;
  tone?: IconCircleTone;
  size?: keyof typeof CIRCLE_SIZES;
  className?: string;
}

/** A Hugeicon centred in a round, tinted chip — used for card and widget headers. */
export function IconCircle({ icon, tone = "brand", size = "md", className }: IconCircleProps) {
  const s = CIRCLE_SIZES[size];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        s.box,
        TONE_CLASSES[tone],
        className,
      )}
      aria-hidden="true"
    >
      <Icon icon={icon} size={s.icon} />
    </span>
  );
}
