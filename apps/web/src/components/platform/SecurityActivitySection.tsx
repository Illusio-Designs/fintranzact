import { relativeTime, RESET_VERIFICATION_METHOD_LABELS, type ResetVerificationMethod } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { SkeletonRows } from "@/components/ui/SkeletonRows";

/** Latest 50 security events for an organisation's members; admin resets stand out. */
export function SecurityActivitySection({ tenantId }: { tenantId: string }) {
  const { data, isLoading, isError } = trpc.platform.securityEvents.useQuery({ tenantId, limit: 50 });
  const items = data?.items ?? [];

  return (
    <section className="space-y-2" data-testid="platform-security-activity">
      <h3 className="text-xs font-bold uppercase tracking-wide text-text-tertiary">Security activity</h3>
      {isLoading ? (
        <SkeletonRows count={3} height="h-10" />
      ) : isError ? (
        <p className="text-sm text-red-600">Could not load security activity.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-text-tertiary">No security events yet.</p>
      ) : (
        <div className="divide-y divide-border-light overflow-hidden rounded-2xl border border-border-light">
          {items.map((e) => {
            const reset = e.type === "2fa.reset_by_admin";
            const meta = (e.metadata ?? {}) as { method?: string; reference?: string | null; reason?: string };
            return (
              <div
                key={e.id}
                data-reset={reset ? "true" : undefined}
                className={reset ? "bg-amber-50 px-4 py-3 dark:bg-amber-950" : "px-4 py-3"}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-text-primary">{e.label}</p>
                  <time dateTime={e.createdAt} className="shrink-0 text-xs text-text-tertiary">{relativeTime(e.createdAt)}</time>
                </div>
                <p className="text-xs text-text-tertiary">
                  {e.user ? (e.user.email ?? e.user.id) : "Unknown user"}
                  {e.actor ? ` · by ${e.actor.email ?? e.actor.id}` : ""}
                  {e.ip ? ` · ${e.ip}` : ""}
                </p>
                {reset && (
                  <p className="mt-1 text-xs text-text-secondary">
                    {meta.method ? (RESET_VERIFICATION_METHOD_LABELS[meta.method as ResetVerificationMethod] ?? meta.method) : ""}
                    {meta.reference ? ` · ref ${meta.reference}` : ""}
                    {meta.reason ? ` · ${meta.reason}` : ""}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
