import { useEffect, useId, useMemo, useState } from "react";
import { INDIAN_STATES, stateByCode, stateCodeFromGstin } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { Combobox } from "@/components/ui/Combobox";

export interface BillingDetails {
  name: string;
  gstin: string | null;
  address: string | null;
  email: string | null;
  /** GST state code, or null. */
  state?: string | null;
}

const STATE_OPTIONS = INDIAN_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }));

/**
 * The state the tax is worked out by. A valid GSTIN decides (its first two
 * digits) and the field is filled from it and locked; without one the chosen
 * state is used. `mismatch` is set when a saved state differs from the GSTIN's.
 */
export function effectiveBillingState(gstin: string, state: string | null | undefined) {
  const fromGstin = stateCodeFromGstin(gstin);
  return {
    code: fromGstin ?? state ?? "",
    locked: !!fromGstin,
    mismatch: !!fromGstin && !!state && state !== fromGstin,
  };
}

/** Billing details printed on the GST invoices we issue for the subscription. */
export function BillingDetailsForm({ initial, onSaved }: { initial: BillingDetails; onSaved: () => void }) {
  const noteId = useId();
  const read = (d: BillingDetails) => ({
    name: d.name,
    gstin: d.gstin ?? "",
    address: d.address ?? "",
    email: d.email ?? "",
    state: d.state ?? "",
  });
  const [form, setForm] = useState(read(initial));
  useEffect(() => {
    setForm(read(initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.name, initial.gstin, initial.address, initial.email, initial.state]);

  const eff = effectiveBillingState(form.gstin, form.state);
  const stateName = stateByCode(eff.code);

  const dirty = useMemo(
    () =>
      form.name !== initial.name ||
      form.gstin !== (initial.gstin ?? "") ||
      form.address !== (initial.address ?? "") ||
      form.email !== (initial.email ?? "") ||
      eff.code !== (initial.state ?? ""),
    [form, initial, eff.code],
  );

  const save = trpc.billing.updateBillingDetails.useMutation({
    onSuccess: () => {
      toast.success("Billing details saved", "They appear on your next invoices.");
      onSaved();
    },
    onError: (e) => toast.error("Could not save", e.message),
  });

  return (
    <section className="card p-5">
      <h3 className="text-sm font-semibold text-text-primary">Billing details</h3>
      <p className="mt-1 text-xs text-text-tertiary">Printed on the GST invoices we issue for your subscription. Add your GSTIN to claim the input credit.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">Billed to (name)</span>
          <input className="input w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">GSTIN (optional)</span>
          <input
            className="input w-full uppercase"
            value={form.gstin}
            maxLength={15}
            placeholder="22AAAAA0000A1Z5"
            onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-text-secondary">Address (optional)</span>
          <input className="input w-full" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </label>
        <div className="block">
          {eff.locked ? (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-secondary">State / UT (for GST)</span>
              <input
                className="input w-full"
                readOnly
                aria-describedby={noteId}
                value={stateName ? `${stateName.name} (${stateName.code})` : eff.code}
              />
            </label>
          ) : (
            <Combobox
              label="State / UT (for GST)"
              value={form.state}
              onChange={(v) => setForm({ ...form, state: v })}
              options={STATE_OPTIONS}
              placeholder="Select state or UT…"
              emptyMessage="No state matches"
            />
          )}
          <p id={noteId} className="mt-1 text-xs text-text-tertiary">
            {eff.locked
              ? "From your GSTIN: its state decides the GST on your invoices."
              : "Needed to charge CGST + SGST (Gujarat) or IGST (other states). Without it we charge IGST."}
          </p>
          {eff.mismatch ? (
            <p role="status" className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              Your saved state differs from your GSTIN's state; the GSTIN's state ({stateName?.name ?? eff.code}) is used.
            </p>
          ) : null}
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">Billing email (optional)</span>
          <input className="input w-full" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
      </div>
      <div className="mt-4">
        <button
          type="button"
          className="btn-primary text-sm"
          disabled={!dirty || save.isPending || !form.name.trim()}
          onClick={() =>
            save.mutate({
              name: form.name.trim(),
              gstin: form.gstin.trim() || null,
              address: form.address.trim() || null,
              email: form.email.trim() || null,
              state: eff.code || null,
            })
          }
        >
          {save.isPending ? "Saving…" : "Save details"}
        </button>
      </div>
    </section>
  );
}
