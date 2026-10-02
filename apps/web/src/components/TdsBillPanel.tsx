import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils";
import { Select } from "@/components/ui/Select";
import { tdsSections } from "@fintranzact/shared";

export type TdsMode = "auto" | "none" | "manual";

export interface TdsBillValue {
  mode: TdsMode;
  /** Only used in manual mode. */
  section: string;
  /** Only used in manual mode. */
  amount: string;
}

export const emptyTdsBill: TdsBillValue = { mode: "auto", section: "", amount: "" };

interface Props {
  partyId: string;
  /** Bill value excluding GST — what TDS is worked out on. */
  taxable: number;
  /** Bill total including GST. */
  total: number;
  /** ISO date-time of the bill date, so the right financial year is used. */
  billDate?: string;
  value: TdsBillValue;
  onChange: (next: TdsBillValue) => void;
}

/**
 * TDS we deduct from a supplier on a purchase bill. Worked out when the bill
 * is credited from the supplier's TDS section and what we have bought from
 * them this financial year; can be switched off or entered by hand.
 */
export function TdsBillPanel({ partyId, taxable, total, billDate, value, onChange }: Props) {
  const enabled = value.mode === "auto" && !!partyId && taxable > 0;
  const { data: preview, isLoading } = trpc.tds.preview.useQuery(
    { partyId, amount: taxable.toFixed(2), paymentDate: billDate },
    { enabled },
  );

  const tds =
    value.mode === "manual"
      ? parseFloat(value.amount) || 0
      : value.mode === "auto" && preview?.result?.applicable
        ? parseFloat(preview.result.tds)
        : 0;

  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: "var(--surface-1)", border: "1px solid var(--border-light)" }} data-testid="tds-bill-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>TDS on this purchase</p>
          <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            Deducted when the bill is credited, and settled against it.
          </p>
        </div>
        <Select
          aria-label="TDS on this bill"
          value={value.mode}
          onChange={(e) => onChange({ ...value, mode: e.target.value as TdsMode })}
          className="px-2 py-1.5 rounded-lg text-xs outline-none"
        >
          <option value="auto">Work it out</option>
          <option value="none">No TDS on this bill</option>
          <option value="manual">Enter it myself</option>
        </Select>
      </div>

      {value.mode === "auto" && (
        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {!partyId ? (
            "Choose a supplier to see the TDS."
          ) : taxable <= 0 ? (
            "Add items to see the TDS."
          ) : isLoading ? (
            "Working out TDS…"
          ) : !preview?.section ? (
            <span>{preview?.warnings[0] ?? "No TDS section is set on this supplier."} Set one on the supplier to deduct TDS automatically.</span>
          ) : preview.result?.applicable ? (
            <span>
              <strong style={{ color: "var(--text-primary)" }}>{formatCurrency(preview.result.tds)}</strong> under {preview.section.label} —{" "}
              {preview.result.rate}% of {formatCurrency(preview.result.base)}
              {parseFloat(preview.result.base) > taxable + 0.005 ? " (includes earlier purchases this year that crossed the limit)" : ""}.
            </span>
          ) : (
            <span>
              No TDS yet: purchases from this supplier this year ({formatCurrency(parseFloat(preview.ytdPaid) + taxable)}) are within the {preview.section.label} limit.
            </span>
          )}
          {preview?.warnings.filter((w) => w.startsWith("No PAN")).map((w) => (
            <p key={w} className="mt-1 text-amber-600">{w}</p>
          ))}
        </div>
      )}

      {value.mode === "manual" && (
        <div className="grid grid-cols-2 gap-2">
          <Select
            aria-label="TDS section"
            value={value.section}
            onChange={(e) => onChange({ ...value, section: e.target.value })}
            className="px-2 py-1.5 rounded-lg text-xs outline-none"
          >
            <option value="">Section…</option>
            {tdsSections.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </Select>
          <input
            aria-label="TDS amount"
            inputMode="decimal"
            value={value.amount}
            onChange={(e) => onChange({ ...value, amount: e.target.value.replace(/[^0-9.]/g, "") })}
            placeholder="TDS amount"
            className="px-2 py-1.5 rounded-lg text-xs outline-none text-right tabular-nums"
            style={{ background: "var(--surface-0)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
          />
        </div>
      )}

      {tds > 0 && (
        <div className="flex justify-between text-xs pt-1 border-t" style={{ borderColor: "var(--border-light)" }}>
          <span style={{ color: "var(--text-secondary)" }}>Payable to supplier after TDS</span>
          <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{formatCurrency(Math.max(total - tds, 0))}</span>
        </div>
      )}
    </div>
  );
}
