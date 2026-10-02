import { useState } from "react";
import dayjs from "dayjs";
import { trpc } from "@/lib/trpc";
import { useTwoFactorRequirement } from "@/hooks/useTwoFactorRequirement";
import { policyCoversRole, policyLabel } from "@/lib/two-factor-enforcement";
import { clearTrustedDeviceToken } from "@/lib/desktop-session";
import { SetupDialog } from "./security/SetupDialog";
import { ReauthDialog, type ReauthMode } from "./security/ReauthDialog";
import { TrustedDevicesCard } from "./security/TrustedDevicesCard";

/** Settings → Account → Security: two-factor status, turn on/off, backup codes, trusted devices. */
export function SecurityTab() {
  const { data: me } = trpc.auth.me.useQuery();
  const { data: status, isLoading, isError } = trpc.auth.twoFactorStatus.useQuery();
  const [setupOpen, setSetupOpen] = useState(false);
  const [reauth, setReauth] = useState<ReauthMode | null>(null);
  const email = me?.user?.email ?? "";
  // When the organisation requires 2FA of this user, say so up front instead of
  // letting "Turn off" fail (the server refuses it either way).
  const { policy } = useTwoFactorRequirement();
  const enforced = policyCoversRole(policy, me?.role);

  const locked = status?.lockedUntil && new Date(status.lockedUntil).getTime() > Date.now() ? status.lockedUntil : null;
  const remaining = status?.backupCodesRemaining ?? 0;

  return (
    <div className="space-y-4">
      <div className="card px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-text-primary">Two-factor authentication</h3>
              {status && (
                <span
                  className={
                    status.enabled
                      ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      : "rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-text-tertiary"
                  }
                >
                  {status.enabled ? "On" : "Off"}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-text-tertiary">
              Ask for a 6-digit code from an authenticator app, as well as your password, when you sign in.
            </p>
          </div>
          {status && (
            <div className="flex flex-wrap gap-2">
              {status.enabled ? (
                <>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setReauth("regenerate")}>
                    New backup codes
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm text-red-600"
                    onClick={() => setReauth("disable")}
                    disabled={enforced}
                    title={enforced ? "Your organisation requires two-factor authentication" : undefined}
                  >
                    Turn off
                  </button>
                </>
              ) : (
                <button type="button" className="btn-primary btn-sm" onClick={() => setSetupOpen(true)}>
                  Turn on
                </button>
              )}
            </div>
          )}
        </div>

        {enforced && status?.enabled && (
          <p data-testid="two-factor-enforced-note" className="mt-4 rounded-lg bg-surface-2 px-4 py-3 text-sm text-text-secondary">
            Your organisation requires two-factor authentication ({policyLabel(policy).toLowerCase()}), so it cannot be turned off here.
            Ask an owner of the organisation to relax the policy first.
          </p>
        )}
        {isLoading && <p className="mt-4 text-sm text-text-tertiary">Loading…</p>}
        {isError && <p className="mt-4 text-sm text-red-600">Could not load your two-factor status. Refresh and try again.</p>}
        {status?.enabled && (
          <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-text-tertiary">Backup codes left</dt>
              <dd className={remaining <= 2 ? "font-medium text-amber-600 dark:text-amber-400" : "text-text-primary"}>
                {remaining}
                {remaining <= 2 && <span className="ml-1 text-xs font-normal">(generate new ones soon)</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-tertiary">Trusted devices</dt>
              <dd className="text-text-primary">{status.trustedDeviceCount}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-tertiary">Turned on</dt>
              <dd className="text-text-primary">{status.createdAt ? dayjs(status.createdAt).format("D MMM YYYY") : "—"}</dd>
            </div>
          </dl>
        )}
        {locked && (
          <p role="status" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-600/40 dark:bg-amber-900/20 dark:text-amber-300">
            Too many wrong codes. Code checks are paused until {dayjs(locked).format("D MMM, h:mm A")}.
          </p>
        )}
      </div>

      {status?.enabled && <TrustedDevicesCard />}

      <SetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} email={email} />
      <ReauthDialog
        mode={reauth}
        onClose={() => setReauth(null)}
        email={email}
        // Turning off removes every trusted device server side; forget this one too.
        onDisabled={() => void clearTrustedDeviceToken()}
      />
    </div>
  );
}
