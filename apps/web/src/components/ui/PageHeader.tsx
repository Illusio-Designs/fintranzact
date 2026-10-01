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
    // Wraps on narrow screens: the actions drop below the title (and wrap
    // among themselves) instead of pushing the page sideways.
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 mb-6">
      <div className="min-w-0 flex-1 basis-60">
        <h1 className={PAGE_TITLE_CLASS}>
          {title}
        </h1>
        {description && (
          <p className="text-sm mt-1 text-text-tertiary">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 [&>div]:flex-wrap">{actions}</div>}
    </div>
  );
}
