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
    <div className="flex flex-col items-center justify-center py-14 gap-1.5 text-center animate-fade-in">
      {icon && (
        <div className="mb-2 flex items-center justify-center w-11 h-11 rounded-xl bg-surface-2 text-text-secondary">
          {icon}
        </div>
      )}
      <p className="text-[15px] font-semibold text-text-primary">
        {title}
      </p>
      {description && (
        <p className="text-ui text-center max-w-sm text-text-tertiary">
          {description}
        </p>
      )}
      {encouragement && (
        <p className="text-xs text-center max-w-sm text-text-tertiary">
          {encouragement}
        </p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
