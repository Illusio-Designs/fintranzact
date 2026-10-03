import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MAX_GRACE_DAYS_UI, describePolicyChange, policyLabel, POLICY_OPTIONS, summariseMembers } from "@/lib/two-factor-enforcement";
import type { TwoFactorPolicy } from "@fintranzact/shared";

/**
 * Team tab: the organisation's two-factor policy. Owners and superadmins can
 * change it; admins see it read-only. The "N of M still need to set up"
 * summary uses tenant.members, which only returns the flag to owners/admins.
 */
export function TwoFactorPolicyCard({ role, members }: { role: string | undefined; members: Array<{ role: string; twoFactorEnabled?: boolean }> | undefined }) {
  const utils = trpc.useUtils();
  const isOwner = role === "owner" || role === "superadmin";
  const isAdmin = isOwner || role === "admin";
  const { data: tenant } = trpc.tenant.current.useQuery(undefined, { enabled: isAdmin });
  const { data: me } = trpc.auth.me.useQuery();

  const [policy, setPolicy] = useState<TwoFactorPolicy>("off");
  const [graceDays, setGraceDays] = useState(7);
  const [confirming, setConfirming] = useState(false);

  const savedPolicy = (tenant?.twoFactorPolicy as TwoFactorPolicy | undefined) ?? "off";
  const savedGrace = tenant?.twoFactorGraceDays ?? 7;
  useEffect(() => {
    setPolicy(savedPolicy);
    setGraceDays(savedGrace);
  }, [savedPolicy, savedGrace]);

  const save = trpc.tenant.setSecurityPolicy.useMutation({
    onSuccess: () => {
      toast.success("Two-factor policy saved");
      setConfirming(false);
      void utils.tenant.current.invalidate();
      void utils.tenant.members.invalidate();
    },
    onError: (err) => {
      setConfirming(false);
      toast.error("Could not save the policy", err.message);
    },
  });

  if (!isAdmin) return null;

  const dirty = policy !== savedPolicy || (policy !== "off" && graceDays !== savedGrace);
  const ownHasTwoFactor = me?.twoFactor?.enabled === true;
  const summary = members ? summariseMembers(members, savedPolicy) : null;
  const graceValid = Number.isInteger(graceDays) && graceDays >= 0 && graceDays <= MAX_GRACE_DAYS_UI;

  return (
    <div className="card px-6 py-5" data-testid="two-factor-policy-card">
      <h3 className="text-sm font-semibold text-text-primary">Two-factor authentication</h3>
      <p className="mt-0.5 text-xs text-text-tertiary">
        Require members to sign in with a code from an authenticator app. API keys are not affected.
      </p>

      {isOwner ? (
        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">Who must use two-factor authentication</legend>
          {POLICY_OPTIONS.map((o) => (
            <label key={o.value} className="flex items-start gap-3 text-sm">
              <input
                type="radio"
                name="two-factor-policy"
                value={o.value}
                checked={policy === o.value}
                onChange={() => setPolicy(o.value)}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-text-primary">{o.label}</span>
                <span className="block text-xs text-text-tertiary">{o.hint}</span>
              </span>
            </label>
          ))}
          {policy !== "off" && (
            <div className="pt-2">
              <label className="label" htmlFor="two-factor-grace">Grace period (days)</label>
              <input
                id="two-factor-grace"
                type="number"
                min={0}
                max={MAX_GRACE_DAYS_UI}
                value={Number.isNaN(graceDays) ? "" : graceDays}
                onChange={(e) => setGraceDays(e.target.value === "" ? Number.NaN : Number(e.target.value))}
                className="input w-28"
              />
              <p className="mt-1 text-xs text-text-tertiary">Time people get to set it up before they are blocked. 0 blocks at once.</p>
            </div>
          )}
          {policy !== "off" && !ownHasTwoFactor && (
            <p role="note" className="text-xs text-amber-700 dark:text-amber-400">
              Turn on two-factor authentication for your own account first (Account, Security).
            </p>
          )}
          <div className="pt-2">
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={!dirty || !graceValid || save.isPending || (policy !== "off" && !ownHasTwoFactor)}
              onClick={() => setConfirming(true)}
            >
              Save policy
            </button>
          </div>
        </fieldset>
      ) : (
        <p className="mt-4 text-sm text-text-secondary" data-testid="two-factor-policy-readonly">
          Current policy: <span className="font-medium text-text-primary">{policyLabel(savedPolicy)}</span>
          {savedPolicy !== "off" && <> · grace period {savedGrace} day{savedGrace === 1 ? "" : "s"}</>}. Only the organisation owner can change it.
        </p>
      )}

      {summary && summary.total > 0 && (
        <p className="mt-4 text-sm text-text-secondary" data-testid="two-factor-summary">
          {savedPolicy === "off"
            ? `${summary.missing} of ${summary.total} members have not set up two-factor authentication.`
            : `${summary.missing} of ${summary.total} members still need to set up two-factor authentication.`}
        </p>
      )}

      <ConfirmDialog
        open={confirming}
        title={policy === "off" ? "Make two-factor authentication optional?" : "Require two-factor authentication?"}
        description={describePolicyChange(policy, graceDays)}
        confirmLabel="Save policy"
        loading={save.isPending}
        onConfirm={() => save.mutate({ policy, graceDays: policy === "off" ? undefined : graceDays })}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
