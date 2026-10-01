import { cn } from "@/lib/utils";
import { IconCircle, type IconCircleTone, type IconSvgElement } from "./Icon";

interface StatCardProps {
  label: string;
  value: string | number;
  valueColor?: string;
  labelColor?: string;
  accentColor?: string;
  note?: string;
  subItems?: { label: string; value: string }[];
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Optional Hugeicon shown in a round chip above the label. */
  icon?: IconSvgElement;
  iconTone?: IconCircleTone;
}

export function StatCard({
  label,
  value,
  valueColor,
  labelColor,
  accentColor,
  note,
  subItems,
  size = "sm",
  className,
  icon,
  iconTone = "brand",
}: StatCardProps) {
  const chip = icon ? <IconCircle icon={icon} tone={iconTone} className="mb-2.5" /> : null;
  if (size === "lg") {
    return (
      <div
        className={cn(
          "card px-4 py-3",
          accentColor && `border-l-4 ${accentColor}`,
          className,
        )}
      >
        {chip}
        <p className={cn("text-ui font-medium text-text-tertiary", labelColor)}>
          {label}
        </p>
        <p
          className={cn(
            "text-2xl font-semibold tracking-tight tabular-nums mt-0.5",
            valueColor ?? "text-text-primary",
          )}
        >
          {value}
        </p>
        {note && <p className="text-xs text-text-tertiary mt-0.5">{note}</p>}
        {subItems && subItems.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {subItems.map((item) => (
              <p key={item.label} className="text-2xs text-text-tertiary">
                {item.label}: {item.value}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (size === "md") {
    return (
      <div
        className={cn(
          "card px-5 py-4",
          accentColor && `border-l-4 ${accentColor}`,
          className,
        )}
      >
        {chip}
        <p className={cn("text-ui font-medium text-text-tertiary mb-0.5", labelColor)}>{label}</p>
        <p
          className={cn(
            "text-xl font-semibold tracking-tight tabular-nums",
            valueColor ?? "text-text-primary",
          )}
        >
          {value}
        </p>
        {note && <p className="text-xs text-text-tertiary mt-0.5">{note}</p>}
        {subItems && subItems.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {subItems.map((item) => (
              <p key={item.label} className="text-2xs text-text-tertiary">
                {item.label}: {item.value}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  }

  // size === "sm" (default)
  return (
    <div
      className={cn(
        "card px-4 py-3",
        accentColor && `border-l-4 ${accentColor}`,
        className,
      )}
    >
      {chip}
      <p className={cn("text-ui font-medium text-text-tertiary mb-0.5", labelColor)}>{label}</p>
      <p
        className={cn(
          "text-base font-semibold tabular-nums",
          valueColor ?? "text-text-primary",
        )}
      >
        {value}
      </p>
      {note && <p className="text-xs text-text-tertiary mt-0.5">{note}</p>}
      {subItems && subItems.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {subItems.map((item) => (
            <p key={item.label} className="text-2xs text-text-tertiary">
              {item.label}: {item.value}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
