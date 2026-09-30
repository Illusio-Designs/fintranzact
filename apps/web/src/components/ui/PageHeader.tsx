import { ReactNode } from "react";

/** Page title style shared by every screen (matches the dashboard greeting). */
export const PAGE_TITLE_CLASS =
  "font-display text-2xl font-extrabold tracking-[-0.02em] text-[#0f1b3d] dark:text-white sm:text-[28px]";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className={PAGE_TITLE_CLASS}>
          {title}
        </h1>
        {description && (
          <p className="text-sm mt-1 text-text-tertiary">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 ml-4">{actions}</div>}
    </div>
  );
}
