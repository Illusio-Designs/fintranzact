import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { CashierIcon } from "@hugeicons/core-free-icons";
import { toast } from "@/hooks/useToast";
import { Icon } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";
import { Spinner } from "@/components/ui/Spinner";
import { trpc, getBusinessId, setBusinessId } from "@/lib/trpc";
import { POSShell } from "@/features/pos/POSShell";

export const Route = createFileRoute("/pos")({
  component: POSRoute,
});

/**
 * /pos — fullscreen cashier register.
 *
 * Gated behind the per-business `pos_enabled` flag and shown via the
 * chrome-bypass branch in `__root.tsx` (no sidebar, no topbar).
 *
 * Business-selection note: the root layout auto-selects the first business
 * via an effect that fires AFTER children render. On initial mount of this
 * route `getBusinessId()` is null. Rather than race that effect, we resolve
 * the target business directly from the `business.list` result and promote
 * it into the shared getter ourselves. This way POS works:
 *   - On a fresh page load of `/pos` (no sidebar to have clicked yet)
 *   - When opened in a new browser tab used as an independent POS terminal
 *   - After logout + re-login when in-memory state was cleared
 */
function POSRoute() {
  const navigate = useNavigate();
  const { data: bizRows, isPending } = trpc.business.list.useQuery();

  // Prefer an already-selected business; otherwise fall back to the first
  // business in the tenant. This mirrors the root layout's logic but runs
  // synchronously during render so we don't flash "No business selected".
  const preselectedId = getBusinessId();
  const activeBiz =
    (preselectedId ? bizRows?.find((b) => b.id === preselectedId) : null) ??
    bizRows?.[0] ??
    null;

  // Promote the chosen business into the shared header state so any
  // `businessProcedure` calls made from POS components carry the correct
  // `x-business-id`. Safe to call every render — it's a module-level setter.
  useEffect(() => {
    if (activeBiz && activeBiz.id !== preselectedId) {
      setBusinessId(activeBiz.id);
    }
  }, [activeBiz, preselectedId]);

  const utils = trpc.useUtils();
  const { data: session } = trpc.auth.me.useQuery();
  const canEnable = ["owner", "admin", "superadmin"].includes(session?.role ?? "");
  // Turning POS on here opens the register straight away, no reload needed.
  const enable = trpc.business.setPosEnabled.useMutation({
    onSuccess: () => {
      toast.success("POS mode enabled");
      utils.business.list.invalidate();
      utils.business.getById.invalidate();
    },
    onError: (err) => toast.error("Could not turn on POS", err.message),
  });

  const ensureWalkIn = trpc.business.ensureWalkInParty.useMutation();
  const [walkInPartyId, setWalkInPartyId] = useState<string | null>(null);

  // Seed the Walk-in Customer party when we have a POS-enabled business.
  // Idempotent on the server: returns existing row if already present.
  useEffect(() => {
    if (!activeBiz || !activeBiz.posEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await ensureWalkIn.mutateAsync({ id: activeBiz.id });
        if (!cancelled) setWalkInPartyId(res.id);
      } catch (err) {
        console.error("Walk-in party seed failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBiz?.id, activeBiz?.posEnabled]);

  if (isPending) {
    return <POSGate busy title="Opening the register…" />;
  }

  if (!activeBiz) {
    return (
      <POSGate
        title="No business yet"
        description="The register bills for a business. Create one in Settings first."
        actions={
          <button className="btn-primary" onClick={() => navigate({ to: "/settings" })}>
            Go to Settings
          </button>
        }
      />
    );
  }

  if (!activeBiz.posEnabled) {
    return (
      <POSGate
        title="Point-of-Sale is off"
        description={`Turn it on to bill walk-in customers of ${activeBiz.name} from a fullscreen counter: quick item grid, barcode scanning, parked sales and thermal receipts.`}
        note={canEnable ? "You can turn it off again any time in Settings → Point-of-Sale." : "Ask an owner or admin to turn it on in Settings → Point-of-Sale."}
        actions={
          <>
            <Link to="/" className="btn-secondary">Back to Dashboard</Link>
            {canEnable && (
              <button
                className="btn-primary"
                disabled={enable.isPending}
                onClick={() => enable.mutate({ id: activeBiz.id, enabled: true })}
              >
                {enable.isPending ? "Turning on…" : "Turn on POS"}
              </button>
            )}
          </>
        }
      />
    );
  }

  if (!walkInPartyId) {
    return <POSGate busy title="Preparing the register…" />;
  }

  return <POSShell businessId={activeBiz.id} walkInPartyId={walkInPartyId} />;
}

/** The screen before the register opens: POS off, no business, or loading. Fullscreen, like the register. */
function POSGate({
  title,
  description,
  note,
  actions,
  busy,
}: {
  title: string;
  description?: string;
  note?: string;
  actions?: ReactNode;
  busy?: boolean;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-surface-1 px-4 py-10">
      <Logo className="h-8" />
      <div className="w-full max-w-md animate-scale-in rounded-2xl border border-border-light bg-surface-0 p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-400">
          {busy ? <Spinner size="sm" /> : <Icon icon={CashierIcon} size={24} />}
        </div>
        <h1 className="font-display text-xl font-extrabold tracking-[-0.02em] text-text-primary text-balance">{title}</h1>
        {description && <p className="mt-2 text-sm leading-relaxed text-text-secondary">{description}</p>}
        {actions && <div className="mt-6 flex flex-wrap justify-center gap-3">{actions}</div>}
        {note && <p className="mt-4 text-xs text-text-tertiary">{note}</p>}
      </div>
    </main>
  );
}
