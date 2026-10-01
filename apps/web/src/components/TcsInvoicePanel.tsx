import { formatCurrency } from "@/lib/utils";
import { Select } from "@/components/ui/Select";

export type TcsMode = "auto" | "none";

export interface TcsPreviewData {
  hasPan: boolean;
  amount: string;
  sections: Array<{ sectionCode: string; label: string; base: string; rate: string; amount: string }>;
  warnings: string[];
}

interface Props {
  mode: TcsMode;
  onModeChange: (mode: TcsMode) => void;
  preview: TcsPreviewData | undefined;
}

/**
 * TCS (s.206C) collected from the customer on specified goods. Shown only when
 * the invoice has such items (or TCS was switched off for it). Worked out by the
 * server from the items' TCS sections; added to what the customer owes.
 */
export function TcsInvoicePanel({ mode, onModeChange, preview }: Props) {
  const has = (preview?.sections.length ?? 0) > 0;
  if (!has && mode === "auto") return null;

  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: "var(--surface-1)", border: "1px solid var(--border-light)" }} data-testid="tcs-invoice-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>TCS on this sale</p>
          <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            Tax collected at source on specified goods, added to what the customer pays.
          </p>
        </div>
        <Select
          aria-label="TCS on this invoice"
          value={mode}
          onChange={(e) => onModeChange(e.target.value as TcsMode)}
          className="px-2 py-1.5 rounded-lg text-xs outline-none"
        >
          <option value="auto">Collect TCS</option>
          <option value="none">No TCS on this invoice</option>
        </Select>
      </div>

      {mode === "auto" && preview && (
        <div className="text-xs space-y-1" style={{ color: "var(--text-secondary)" }}>
          {preview.sections.map((s) => (
            <div key={s.sectionCode} className="flex justify-between gap-3">
              <span>{s.label} — {parseFloat(s.rate)}% of {formatCurrency(s.base)}</span>
              <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{formatCurrency(s.amount)}</span>
            </div>
          ))}
          {preview.warnings.map((w) => <p key={w} className="text-amber-600">{w}</p>)}
        </div>
      )}
      {mode === "none" && (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>No TCS will be collected on this invoice.</p>
      )}
    </div>
  );
}
