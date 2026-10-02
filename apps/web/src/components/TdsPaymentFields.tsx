import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils";
import { Select } from "@/components/ui/Select";
import { Disclosure } from "@/components/ui/Disclosure";
import { tdsSections } from "@fintranzact/shared";

export interface TdsPaymentValue {
  section: string;
  amount: string;
}

export const emptyTdsPayment: TdsPaymentValue = { section: "", amount: "" };

interface Props {
  partyId: string;
  /** The payment amount (gross) entered on the form. */
  amount: string;
  /** ISO date-time of the payment, so the right financial year is used. */
  paymentDate?: string;
  /** True once the payment is allocated to one or more invoices. */
  hasAllocations: boolean;
  value: TdsPaymentValue;
  onChange: (next: TdsPaymentValue) => void;
}

/**
 * Tax withheld on a payment itself. Shown for the two cases that carry TDS on
 * the payment: a customer who deducts TDS from what they pay us (TDS we can
 * claim), and an advance to a supplier that is not against a bill. TDS on a
 * purchase bill is deducted on the bill, so nothing is shown for that.
 */
export function TdsPaymentFields({ partyId, amount, paymentDate, hasAllocations, value, onChange }: Props) {
  const { data: party } = trpc.party.getById.useQuery({ id: partyId }, { enabled: !!partyId });
  const isCustomer = party?.type === "customer";
  const isAdvance = party?.type === "supplier" && !hasAllocations;

  const gross = parseFloat(amount) || 0;
  const { data: preview } = trpc.tds.preview.useQuery(
    { partyId, amount: gross.toFixed(2), paymentDate },
    { enabled: isAdvance && gross > 0 },
  );

  if (!partyId || (!isCustomer && !isAdvance)) return null;

  const tds = parseFloat(value.amount) || 0;
  const suggested = isAdvance && preview?.result?.applicable ? preview.result.tds : null;

  return (
    <div className="rounded-xl border border-border-light">
      <Disclosure label={isCustomer ? "TDS deducted by customer" : "TDS on this advance"} count={tds > 0 ? 1 : 0}>
        <div className="space-y-3 px-1">
          <p className="text-xs text-text-tertiary">
            {isCustomer
              ? "If the customer paid you after deducting income-tax TDS, enter it here. The invoice is settled in full and the TDS is kept as a credit you claim."
              : "TDS on a payment that is not against a bill. (TDS on a purchase bill is deducted on the bill itself.)"}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label mb-1 block">Section</label>
              <Select
                aria-label="TDS section"
                value={value.section}
                onChange={(e) => onChange({ ...value, section: e.target.value })}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              >
                <option value="">None</option>
                {tdsSections.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
              </Select>
            </div>
            <div>
              <label className="label mb-1 block" htmlFor="tds-payment-amount">TDS amount (₹)</label>
              <input
                id="tds-payment-amount"
                inputMode="decimal"
                value={value.amount}
                onChange={(e) => onChange({ ...value, amount: e.target.value.replace(/[^0-9.]/g, "") })}
                placeholder="0.00"
                className="w-full px-3 py-2 rounded-lg text-sm outline-none text-right tabular-nums"
                style={{ background: "var(--surface-1)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
              />
            </div>
          </div>

          {suggested && (
            <button
              type="button"
              onClick={() => onChange({ section: preview?.sectionCode ?? value.section, amount: suggested })}
              className="text-xs text-brand-600 hover:underline"
            >
              Use calculated TDS: {formatCurrency(suggested)} under {preview?.section?.label}
            </button>
          )}
          {isAdvance && preview && !preview.section && (
            <p className="text-xs text-text-tertiary">This supplier has no TDS section; choose one above if TDS applies.</p>
          )}

          {tds > 0 && gross > tds && (
            <div className="flex justify-between text-xs pt-2 border-t border-border-light">
              <span className="text-text-secondary">{isCustomer ? "Received in the account" : "Paid from the account"}</span>
              <span className="font-semibold tabular-nums text-text-primary">{formatCurrency(gross - tds)}</span>
            </div>
          )}
        </div>
      </Disclosure>
    </div>
  );
}
