import { useState } from "react";
import { BONUS_RUN_STATUS_LABELS, FNF_STATUS_LABELS, LOAN_STATUS_LABELS, type BonusRunStatus, type FnfStatus, type LoanStatus } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { todayISODate } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { InputField, SelectField } from "@/components/ui/FormField";

const TONES = {
  neutral: "bg-surface-2 text-text-secondary",
  info: "bg-blue-600/[0.08] text-blue-700 dark:text-blue-400",
  warn: "bg-amber-600/[0.1] text-amber-700 dark:text-amber-400",
  good: "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400",
  done: "bg-emerald-600/[0.14] text-emerald-800 dark:text-emerald-300",
  bad: "bg-red-600/[0.08] text-red-700 dark:text-red-400",
} as const;

const BONUS_TONE: Record<BonusRunStatus, keyof typeof TONES> = { draft: "neutral", calculated: "info", pending_approval: "warn", approved: "good", posted: "good", paid: "done" };
const FNF_TONE: Record<FnfStatus, keyof typeof TONES> = { draft: "neutral", pending_approval: "warn", approved: "good", posted: "good", paid: "done", reversed: "bad" };
const LOAN_TONE: Record<LoanStatus, keyof typeof TONES> = { pending_approval: "warn", approved: "good", active: "info", closed: "done", rejected: "bad", cancelled: "neutral" };

export function BonusStatusBadge({ status }: { status: string }) {
  const s = status as BonusRunStatus;
  return <Badge color={TONES[BONUS_TONE[s] ?? "neutral"]}>{BONUS_RUN_STATUS_LABELS[s] ?? status}</Badge>;
}
export function FnfStatusBadge({ status }: { status: string }) {
  const s = status as FnfStatus;
  return <Badge color={TONES[FNF_TONE[s] ?? "neutral"]}>{FNF_STATUS_LABELS[s] ?? status}</Badge>;
}
export function LoanStatusBadge({ status }: { status: string }) {
  const s = status as LoanStatus;
  return <Badge color={TONES[LOAN_TONE[s] ?? "neutral"]}>{LOAN_STATUS_LABELS[s] ?? status}</Badge>;
}

/** An amber note. */
export function Notice({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <p role="status" data-testid={testId} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {children}
    </p>
  );
}

export interface BankPayment {
  bankAccountId: string;
  date: string;
  reference: string;
}

/**
 * Asks for the bank or cash account, the date and a reference, then calls `onSubmit`. Used wherever Phase 4 moves money:
 * paying a bonus run or a settlement, disbursing a loan, receiving a prepayment. `children` adds fields (an amount).
 */
export function BankPaymentDialog({
  title, description, confirmLabel, accountLabel, dateLabel, pending, onClose, onSubmit, children, extraValid = true,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  accountLabel: string;
  dateLabel: string;
  pending?: boolean;
  onClose: () => void;
  onSubmit: (v: BankPayment) => void;
  children?: React.ReactNode;
  extraValid?: boolean;
}) {
  const accounts = trpc.bankAccount.list.useQuery();
  const [bankAccountId, setBank] = useState("");
  const [date, setDate] = useState(todayISODate());
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  function save() {
    if (!bankAccountId) return setError(`Choose the bank or cash account.`);
    if (!date) return setError("Enter the date.");
    if (!extraValid) return setError("Check the amount.");
    setError(null);
    onSubmit({ bankAccountId, date, reference });
  }
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-3">
        {description && <p className="text-sm text-text-secondary">{description}</p>}
        {children}
        <SelectField label={accountLabel} required value={bankAccountId} onChange={(e) => setBank(e.target.value)}>
          <option value="">Choose...</option>
          {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.accountName}</option>)}
        </SelectField>
        <InputField label={dateLabel} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        <InputField label="Reference (UTR or cheque number)" value={reference} onChange={(e) => setReference(e.target.value)} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={pending} onClick={save}>{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}

/** The step list shown above a run or settlement. */
export function Steps({ steps, labels, current }: { steps: readonly string[]; labels: Record<string, string>; current: string }) {
  const at = steps.indexOf(current);
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s} className={at >= i ? "font-semibold text-brand-700 dark:text-brand-300" : "text-text-tertiary"} aria-current={s === current ? "step" : undefined}>
          {i + 1}. {labels[s]}
        </li>
      ))}
    </ol>
  );
}
