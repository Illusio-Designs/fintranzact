import { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** A short, encouraging line shown below the description in a subtler style */
  encouragement?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, encouragement, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      {icon && (
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-surface-2 text-text-tertiary">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-text-primary">
        {title}
      </p>
      {description && (
        <p className="text-sm text-center max-w-xs text-text-tertiary">
          {description}
        </p>
      )}
      {encouragement && (
        <p className="text-xs text-center max-w-xs text-text-tertiary/70 italic">
          {encouragement}
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
