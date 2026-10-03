import { useEffect, useState } from "react";
import {
  MIN_RESET_CHECKS,
  MIN_RESET_REASON_LENGTH,
  RESET_IDENTITY_CHECKS,
  RESET_IDENTITY_CHECK_LABELS,
  RESET_VERIFICATION_METHODS,
  RESET_VERIFICATION_METHOD_LABELS,
  resetEmailConfirmed,
  validateResetVerification,
  type ResetVerificationMethod,
} from "@fintranzact/shared";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { InputField, TextareaField } from "@/components/ui/FormField";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";

export interface ResetTarget {
  userId: string;
  name: string | null;
  email: string;
}

/** Platform admin: reset a member's two-factor authentication after checking who they are. */
export function ResetTwoFactorDialog({
  target,
  tenantId,
  onClose,
}: {
  target: ResetTarget | null;
  tenantId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [method, setMethod] = useState<ResetVerificationMethod | "">("");
  const [checks, setChecks] = useState<string[]>([]);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");

  useEffect(() => {
    if (target) {
      setMethod("");
      setChecks([]);
      setReference("");
      setReason("");
      setConfirmEmail("");
    }
  }, [target?.userId]);

  const mutation = trpc.platform.resetTwoFactor.useMutation({
    onSuccess: async (r) => {
      if (r.reset) {
        toast.success("Two-factor reset", r.message);
      } else {
        toast.info("Nothing to reset", r.message);
      }
      await Promise.all([utils.platform.tenant.invalidate(), utils.platform.securityEvents.invalidate()]);
      onClose();
    },
    onError: (err) => toast.error("Could not reset two-factor", err.message),
  });

  const problems = validateResetVerification({ method, checks, reason });
  const emailOk = !!target && resetEmailConfirmed(confirmEmail, target.email);
  const valid = !!target && problems.length === 0 && emailOk;

  function toggle(check: string) {
    setChecks((c) => (c.includes(check) ? c.filter((x) => x !== check) : [...c, check]));
  }

  function submit() {
    if (!target || !valid || method === "") return;
    mutation.mutate({
      userId: target.userId,
      tenantId,
      confirmEmail,
      verification: { method, checks, reference: reference.trim() || undefined, reason: reason.trim() },
    });
  }

  return (
    <Modal open={!!target} onClose={onClose} title="Reset two-factor authentication">
      {target && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            This turns two-factor off for <strong>{target.name ?? target.email}</strong>. All their sessions are signed out, trusted
            devices are forgotten, their backup codes stop working, and they are emailed. Only do this after you have checked who they
            are. It is recorded with your name.
          </p>

          <div>
            <p className="mb-1 text-sm font-medium text-text-primary">How was the user verified?</p>
            <Select aria-label="How was the user verified?" value={method} onChange={(e) => setMethod(e.target.value as ResetVerificationMethod | "")}>
              <option value="">Choose…</option>
              {RESET_VERIFICATION_METHODS.map((m) => (
                <option key={m} value={m}>{RESET_VERIFICATION_METHOD_LABELS[m]}</option>
              ))}
            </Select>
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-medium text-text-primary">Identity checks done (at least {MIN_RESET_CHECKS})</legend>
            <div className="space-y-1.5">
              {RESET_IDENTITY_CHECKS.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm text-text-secondary">
                  <input type="checkbox" checked={checks.includes(c)} onChange={() => toggle(c)} />
                  {RESET_IDENTITY_CHECK_LABELS[c]}
                </label>
              ))}
            </div>
          </fieldset>

          <InputField label="Ticket or reference (optional)" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />

          <TextareaField
            label="Reason"
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this reset needed, and what was checked?"
            error={reason.length > 0 && reason.trim().length < MIN_RESET_REASON_LENGTH ? `At least ${MIN_RESET_REASON_LENGTH} characters (${reason.trim().length} so far).` : undefined}
          />

          <InputField
            label={`Type ${target.email} to confirm`}
            required
            autoComplete="off"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
          />

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={!valid || mutation.isPending}>
              {mutation.isPending ? "Resetting…" : "Reset two-factor"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
