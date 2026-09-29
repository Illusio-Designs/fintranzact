import type { ReactNode } from "react";
import { IconCircle, type IconCircleTone, type IconSvgElement } from "./Icon";

/** Card header used by dashboard widgets: round icon chip, title and optional controls. */
export function WidgetHeader({
  title,
  icon,
  tone = "brand",
  children,
}: {
  title: string;
  icon: IconSvgElement;
  tone?: IconCircleTone;
  children?: ReactNode;
}) {
  return (
    <div className="px-5 py-3 border-b border-border-light flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2.5 text-sm font-semibold text-text-primary">
        <IconCircle icon={icon} tone={tone} size="sm" />
        {title}
      </h3>
      {children}
    </div>
  );
}
