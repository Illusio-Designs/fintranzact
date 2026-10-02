import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils";
import { Select } from "@/components/ui/Select";
import { tdsSections } from "@fintranzact/shared";

export type ExpenseTdsMode = "none" | "auto" | "manual";

export interface TdsExpenseValue {
  mode: ExpenseTdsMode;
  /** Who was paid. Needed for any TDS. */
  partyId: string;
  /** Chosen section; in auto mode empty means the payee's own section. */
  section: string;
  /** Only used in manual mode. */
  amount: string;
}

export const emptyTdsExpense: TdsExpenseValue = { mode: "none", partyId: "", section: "", amount: "" };

interface Props {
  /** Gross amount of the expense — what TDS is worked out on. */
  amount: number;
  /** ISO date-time of the expense, so the right financial year is used. */
  expenseDate?: string;
  /** The expense being edited, so it is not counted against the year twice. */
  expenseId?: string | null;
  value: TdsExpenseValue;
  onChange: (next: TdsExpenseValue) => void;
}

/**
 * TDS deducted from an expense paid to a payee (rent, professional fees…).
 * Worked out from the section, the payee's PAN and what has been paid to them
 * this financial year; can be switched off or entered by hand. The bank pays
 * the amount less the TDS.
 */
export function TdsExpensePanel({ amount, expenseDate, expenseId, value, onChange }: Props) {
  const { data: partiesData } = trpc.party.list.useQuery({ page: 1, limit: 100 });
  const parties = partiesData?.data ?? [];

  const enabled = value.mode === "auto" && !!value.partyId && amount > 0;
  const { data: preview, isLoading } = trpc.tds.preview.useQuery(
    {
      partyId: value.partyId,
      amount: amount.toFixed(2),
      paymentDate: expenseDate,
      sectionCode: (value.section || undefined) as never,
      excludeExpenseId: expenseId ?? undefined,
    },
    { enabled },
  );

  const tds =
    value.mode === "manual"
      ? parseFloat(value.amount) || 0
      : value.mode === "auto" && preview?.result?.applicable
        ? parseFloat(preview.result.tds)
        : 0;

  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: "var(--surface-1)", border: "1px solid var(--border-light)" }} data-testid="tds-expense-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>TDS on this expense</p>
          <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            Withheld from the payee and owed to the government.
          </p>
        </div>
        <Select
          aria-label="TDS on this expense"
          value={value.mode}
          onChange={(e) => onChange({ ...value, mode: e.target.value as ExpenseTdsMode })}
          className="px-2 py-1.5 rounded-lg text-xs outline-none"
        >
          <option value="none">No TDS</option>
          <option value="auto">Work it out</option>
          <option value="manual">Enter it myself</option>
        </Select>
      </div>

      {value.mode !== "none" && (
        <div className="grid grid-cols-2 gap-2">
          <Select
            aria-label="Paid to"
            value={value.partyId}
            onChange={(e) => onChange({ ...value, partyId: e.target.value })}
            className="px-2 py-1.5 rounded-lg text-xs outline-none"
          >
            <option value="">Paid to…</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select
            aria-label="TDS section"
            value={value.section}
            onChange={(e) => onChange({ ...value, section: e.target.value })}
            className="px-2 py-1.5 rounded-lg text-xs outline-none"
          >
            <option value="">{value.mode === "auto" ? "Payee's section" : "Section…"}</option>
            {tdsSections.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </Select>
        </div>
      )}

      {value.mode === "auto" && (
        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {!value.partyId ? (
            "Choose who was paid to see the TDS."
          ) : amount <= 0 ? (
            "Enter the amount to see the TDS."
          ) : isLoading ? (
            "Working out TDS…"
          ) : !preview?.section ? (
            <span>{preview?.warnings[0] ?? "No TDS section is set on this payee."} Choose a section above or set one on the party.</span>
          ) : preview.result?.applicable ? (
            <span>
              <strong style={{ color: "var(--text-primary)" }}>{formatCurrency(preview.result.tds)}</strong> under {preview.section.label} —{" "}
              {preview.result.rate}% of {formatCurrency(preview.result.base)}
              {parseFloat(preview.result.base) > amount + 0.005 ? " (includes earlier payments this year that crossed the limit)" : ""}.
            </span>
          ) : (
            <span>
              No TDS yet: payments to this payee this year ({formatCurrency(parseFloat(preview.ytdPaid) + amount)}) are within the {preview.section.label} limit.
            </span>
          )}
          {preview?.warnings.filter((w) => w.startsWith("No PAN")).map((w) => (
            <p key={w} className="mt-1 text-amber-600">{w}</p>
          ))}
        </div>
      )}

      {value.mode === "manual" && (
        <input
          aria-label="TDS amount"
          inputMode="decimal"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value.replace(/[^0-9.]/g, "") })}
          placeholder="TDS amount"
          className="w-full px-2 py-1.5 rounded-lg text-xs outline-none text-right tabular-nums"
          style={{ background: "var(--surface-0)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
        />
      )}

      {tds > 0 && (
        <div className="flex justify-between text-xs pt-1 border-t" style={{ borderColor: "var(--border-light)" }}>
          <span style={{ color: "var(--text-secondary)" }}>Paid to the payee after TDS</span>
          <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{formatCurrency(Math.max(amount - tds, 0))}</span>
        </div>
      )}
    </div>
  );
}
