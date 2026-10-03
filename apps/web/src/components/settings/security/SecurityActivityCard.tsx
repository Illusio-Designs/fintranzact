import { relativeTime, securityActivityDetail } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";

/** The caller's own recent security events: setup, sign-ins with a code, failures, resets. */
export function SecurityActivityCard() {
  const { data, isLoading, isError } = trpc.auth.securityActivity.useQuery({ limit: 20 });
  const items = data ?? [];

  return (
    <div className="card px-6 py-5" data-testid="security-activity">
      <h3 className="text-sm font-semibold text-text-primary">Recent security activity</h3>
      <p className="mt-1 text-sm text-text-tertiary">Two-factor events on your account. If something here is not you, change your password and turn two-factor on.</p>
      {isLoading ? (
        <p className="mt-4 text-sm text-text-tertiary">Loading…</p>
      ) : isError ? (
        <p className="mt-4 text-sm text-red-600">Could not load your security activity.</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm text-text-tertiary">Nothing yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border-light">
          {items.map((e) => {
            const detail = securityActivityDetail(e);
            const bad = e.type === "2fa.failed" || e.type === "2fa.locked" || e.type === "2fa.reset_by_admin";
            return (
              <li key={e.id} className="flex items-start justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className={bad ? "text-sm font-medium text-amber-700 dark:text-amber-400" : "text-sm font-medium text-text-primary"}>{e.label}</p>
                  {detail && <p className="truncate text-xs text-text-tertiary">{detail}</p>}
                </div>
                <time dateTime={e.createdAt} title={new Date(e.createdAt).toLocaleString()} className="shrink-0 text-xs text-text-tertiary">
                  {relativeTime(e.createdAt)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
