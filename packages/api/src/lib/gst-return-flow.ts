/**
 * gst-return-flow.ts — the persisted state machine behind filing GSTR-1 and
 * GSTR-3B through Sandbox.co.in, plus the pure helpers around it.
 *
 * GSTR-1   draft -> saved (reference_id) -> save_validated | save_errors
 *          -> proceeding (reference_id) -> ready_to_file | proceed_errors
 *          -> summary_fetched (sec_sum + chksum) -> otp_requested -> filed | failed
 *   nil:   draft -> proceeding (is_nil=Y) -> ready_to_file -> otp_requested -> filed | failed
 * GSTR-3B  draft -> saved -> save_validated | save_errors -> ledger_checked
 *          -> offset_confirmed -> offset_posted (reference_id) -> offset_validated
 *          | offset_errors -> details_fetched (tx_pmt) -> otp_requested -> filed | failed
 *   nil:   draft -> otp_requested -> filed | failed
 *
 * PERSISTENCE. Each transition appends one row to `audit_log`
 * (action `gstReturns.attempt.<type>.<MMYYYY>`, entity `gst_return_attempt`);
 * the newest row is the current attempt. This avoids a new table (and a
 * three-tree migration) while keeping the full history of an attempt. A row
 * holds reference ids, the portal's sec_sum / chksum, the 3B details with
 * tx_pmt and the proposed offset. It NEVER holds the taxpayer token or an OTP.
 *
 * Every transition is idempotent and resumable: after a crash between a Sandbox
 * call and the write of its row, the attempt is still in the previous state
 * and the same step can simply be run again.
 */

import { and, desc, eq } from "drizzle-orm";
import { auditLog } from "@fintranzact/db";
import type { TenantDatabase } from "../trpc.js";
import type { GSTR1Report, GSTR3BReport } from "./gst-reports.js";
import { PAN_RE } from "./sandbox/gst-returns.js";
import type { HeadAmounts, LedgerBalances, OffsetProposal } from "./gst-3b-offset.js";

export type ReturnKind = "gstr1" | "gstr3b";

export type AttemptState =
  | "saved"
  | "save_validated"
  | "save_errors"
  | "proceeding"
  | "ready_to_file"
  | "proceed_errors"
  | "summary_fetched"
  | "ledger_checked"
  | "offset_confirmed"
  | "offset_posted"
  | "offset_validated"
  | "offset_errors"
  | "details_fetched"
  | "otp_requested"
  | "filed"
  | "failed";

/** "draft" = no attempt row yet. */
export type StateOrDraft = AttemptState | "draft";

export interface Attempt {
  kind: ReturnKind;
  /** GSTN return period MMYYYY. */
  period: string;
  nil: boolean;
  state: AttemptState;
  saveRef?: string;
  proceedRef?: string;
  offsetRef?: string;
  /** GSTR-1 summary (step 4), required by the filing call. Never logged. */
  secSum?: unknown[];
  chksum?: string;
  /** GSTR-3B: ledger balances, proposed offset and its fingerprint. */
  ledger?: LedgerBalances;
  proposal?: OffsetProposal;
  proposalKey?: string;
  /** GSTR-3B: the complete 3B data (incl. tx_pmt) taken from the portal after offset. */
  details?: Record<string, unknown>;
  errors?: string[];
  /** Epoch ms: when polling of the current reference started / last hit the portal. */
  pollStartedAt?: number;
  lastPolledAt?: number;
  otpRequestedAt?: number;
  filedRef?: string | null;
  lastError?: string;
  updatedAt: number;
}

// ── Transition rules ─────────────────────────────────────────

export type FlowAction =
  | "save"
  | "proceed"
  | "poll"
  | "summary"
  | "ledger"
  | "offset"
  | "details"
  | "otp"
  | "file";

const NOT_FILED: StateOrDraft[] = [
  "draft", "saved", "save_validated", "save_errors", "proceeding", "ready_to_file", "proceed_errors",
  "summary_fetched", "ledger_checked", "offset_confirmed", "offset_posted", "offset_validated", "offset_errors",
  "details_fetched", "otp_requested", "failed",
];

/** Which states each action may start from. `nil` attempts use the NIL table. */
const NORMAL: Record<ReturnKind, Partial<Record<FlowAction, StateOrDraft[]>>> = {
  gstr1: {
    save: NOT_FILED,
    proceed: ["save_validated", "proceeding"],
    poll: ["saved", "proceeding"],
    summary: ["ready_to_file", "summary_fetched", "otp_requested", "failed"],
    otp: ["summary_fetched", "otp_requested", "failed"],
    file: ["otp_requested", "failed"],
  },
  gstr3b: {
    save: NOT_FILED,
    poll: ["saved", "offset_posted"],
    ledger: ["save_validated", "ledger_checked", "offset_confirmed", "offset_errors"],
    offset: ["ledger_checked", "offset_confirmed", "offset_posted"],
    details: ["offset_validated", "details_fetched", "otp_requested", "failed"],
    otp: ["details_fetched", "otp_requested", "failed"],
    file: ["otp_requested", "failed"],
  },
};

const NIL: Record<ReturnKind, Partial<Record<FlowAction, StateOrDraft[]>>> = {
  gstr1: {
    proceed: ["draft", "proceeding", "proceed_errors", "failed"],
    poll: ["proceeding"],
    otp: ["ready_to_file", "otp_requested", "failed"],
    file: ["otp_requested", "failed"],
  },
  gstr3b: {
    otp: ["draft", "otp_requested", "failed"],
    file: ["otp_requested", "failed"],
  },
};

const HINTS: Partial<Record<StateOrDraft, string>> = {
  save_errors: "The GST portal rejected the saved data. Fix the books and save again before going on.",
  proceed_errors: "The GST portal found errors while preparing the return. Fix the data and save again before going on.",
  offset_errors: "The GST portal rejected the tax payment. Check the ledger balances and start the tax payment step again.",
  filed: "This return is already filed.",
};

export class FlowError extends Error {
  constructor(message: string, public readonly code: "wrong_state" | "needs_resave" = "wrong_state") {
    super(message);
    this.name = "FlowError";
  }
}

export function canRun(kind: ReturnKind, action: FlowAction, attempt: Attempt | null, nil: boolean): boolean {
  const state: StateOrDraft = attempt?.state ?? "draft";
  const table = (nil ? NIL : NORMAL)[kind][action];
  return !!table && table.includes(state);
}

/** Throws a FlowError with a user-facing reason when `action` cannot run now. */
export function assertCanRun(kind: ReturnKind, action: FlowAction, attempt: Attempt | null, nil: boolean): void {
  if (canRun(kind, action, attempt, nil)) return;
  const state: StateOrDraft = attempt?.state ?? "draft";
  const hint = HINTS[state];
  const name = kind === "gstr1" ? "GSTR-1" : "GSTR-3B";
  const resave = state === "save_errors" || state === "proceed_errors";
  throw new FlowError(
    hint ?? `${name} cannot ${action === "file" ? "be filed" : `do "${action}"`} from the "${state}" step. Follow the filing steps in order.`,
    resave ? "needs_resave" : "wrong_state",
  );
}

// ── Polling schedule ─────────────────────────────────────────

/** Never poll the GST Return Status faster than this. */
export const POLL_FLOOR_MS = 10_000;
export const POLL_INTERVAL_MS = 12_000;
/** Processing usually finishes in 1-2 minutes. */
export const POLL_MAX_MS = 180_000;

export type PollDecision =
  | { action: "poll" }
  | { action: "wait"; retryAfterMs: number }
  | { action: "timeout" };

export function pollDecision(
  a: Pick<Attempt, "pollStartedAt" | "lastPolledAt">,
  now: number,
  opts: { intervalMs?: number; maxMs?: number } = {},
): PollDecision {
  const interval = Math.max(POLL_FLOOR_MS, opts.intervalMs ?? POLL_INTERVAL_MS);
  const max = opts.maxMs ?? POLL_MAX_MS;
  const started = a.pollStartedAt ?? now;
  if (now - started > max) return { action: "timeout" };
  const last = a.lastPolledAt ?? started;
  const due = last + interval;
  return now >= due ? { action: "poll" } : { action: "wait", retryAfterMs: due - now };
}

// ── Journal (audit_log) ──────────────────────────────────────

const ENTITY = "gst_return_attempt";
const actionName = (kind: ReturnKind, period: string) => `gstReturns.attempt.${kind}.${period}`;

export async function loadAttempt(
  db: TenantDatabase,
  businessId: string,
  kind: ReturnKind,
  period: string,
): Promise<Attempt | null> {
  const [row] = await db
    .select({ metadata: auditLog.metadata })
    .from(auditLog)
    .where(and(eq(auditLog.businessId, businessId), eq(auditLog.entityType, ENTITY), eq(auditLog.action, actionName(kind, period))))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  if (!row?.metadata) return null;
  try {
    return JSON.parse(row.metadata) as Attempt;
  } catch {
    return null;
  }
}

/** Append the new state of an attempt. Throws on DB failure (state must not be lost silently). */
export async function saveAttempt(
  db: TenantDatabase,
  businessId: string,
  userId: string,
  attempt: Attempt,
  now: number = Date.now(),
): Promise<Attempt> {
  const next: Attempt = { ...attempt, updatedAt: now };
  await db.insert(auditLog).values({
    businessId,
    userId,
    action: actionName(next.kind, next.period),
    entityType: ENTITY,
    metadata: JSON.stringify(next),
  });
  return next;
}

/** A fresh attempt in `state`, keeping nothing from a previous one. */
export function newAttempt(kind: ReturnKind, period: string, nil: boolean, state: AttemptState, now: number): Attempt {
  return { kind, period, nil, state, updatedAt: now };
}

/** What a client may see of an attempt: no checksum / summary payloads, no raw errors beyond messages. */
export function publicAttempt(a: Attempt | null, kind: ReturnKind, period: string) {
  return {
    kind,
    period,
    state: (a?.state ?? "draft") as StateOrDraft,
    nil: a?.nil ?? false,
    saveRef: a?.saveRef ?? null,
    proceedRef: a?.proceedRef ?? null,
    offsetRef: a?.offsetRef ?? null,
    errors: a?.errors ?? [],
    hasSummary: !!a?.chksum,
    hasDetails: !!a?.details,
    ledger: a?.ledger ?? null,
    proposal: a?.proposal ?? null,
    proposalKey: a?.proposalKey ?? null,
    filedRef: a?.filedRef ?? null,
    lastError: a?.lastError ?? null,
    updatedAt: a?.updatedAt ?? null,
  };
}

// ── PAN ──────────────────────────────────────────────────────

export type PanSource = "input" | "business" | "gstin";

/**
 * The PAN sent to the EVC OTP and filing calls. The recipe says "the PAN tied
 * to the GST registration", so, in order: an explicit PAN from the user,
 * the business's PAN from Settings, then characters 3-12 of the GSTIN (which
 * is the registered PAN for every GSTIN). For companies the EVC may need the
 * authorised signatory's PAN instead: the user can pass it explicitly (VERIFY).
 */
export function resolvePan(opts: { input?: string | null; business?: string | null; gstin: string }): { pan: string; source: PanSource } | null {
  const candidates: Array<[string | null | undefined, PanSource]> = [
    [opts.input, "input"],
    [opts.business, "business"],
    [opts.gstin.length === 15 ? opts.gstin.slice(2, 12) : null, "gstin"],
  ];
  for (const [v, source] of candidates) {
    const pan = v?.trim().toUpperCase();
    if (pan && PAN_RE.test(pan)) return { pan, source };
  }
  return null;
}

// ── Nil-return guards ────────────────────────────────────────

const z = (n: number | string | undefined | null) => Math.abs(Number(n ?? 0)) < 0.005;

/** Reasons a nil GSTR-1 must be refused (empty = our books show no outward supplies). */
export function gstr1NilBlockers(r: GSTR1Report): string[] {
  const out: string[] = [];
  if (r.invoiceCount > 0 || !z(r.totalInvoiceValue)) out.push("sales invoices");
  if (r.b2b.length) out.push("B2B supplies");
  if (r.b2cLarge.length) out.push("B2C large supplies");
  if (r.b2cSmall.length) out.push("B2C small supplies");
  if (r.creditNotes.length) out.push("credit notes");
  if (r.debitNotes.length) out.push("debit notes");
  if (r.hsn.length) out.push("HSN summary rows");
  if (!z(r.totalTaxableValue) || !z(r.totalTax)) out.push("taxable value or tax");
  return out;
}

/** Reasons a nil GSTR-3B must be refused. Interest and late fee are not tracked by the app. */
export function gstr3bNilBlockers(r: GSTR3BReport): string[] {
  const out: string[] = [];
  const o = r.outwardSupplies;
  const rows: Array<[string, { taxableValue: number; igst: number; cgst: number; sgst: number }]> = [
    ["taxable outward supplies", o.taxable],
    ["zero-rated supplies", o.zeroRated],
    ["exempt, nil-rated or non-GST supplies", o.exempt],
  ];
  for (const [label, v] of rows) {
    if (!z(v.taxableValue) || !z(v.igst) || !z(v.cgst) || !z(v.sgst)) out.push(label);
  }
  const rcm = r.rcmSupplies;
  if (!z(rcm.taxableValue) || !z(rcm.igst) || !z(rcm.cgst) || !z(rcm.sgst)) out.push("inward supplies liable to reverse charge");
  if (r.interStateUnregistered.length) out.push("inter-state supplies to unregistered persons");
  if (!z(r.itc.igst) || !z(r.itc.cgst) || !z(r.itc.sgst) || !z(r.itc.total)) out.push("input tax credit");
  if (!z(r.taxPayable.igst) || !z(r.taxPayable.cgst) || !z(r.taxPayable.sgst)) out.push("tax payable");
  if (!z(r.netTax.igst) || !z(r.netTax.cgst) || !z(r.netTax.sgst) || !z(r.netTax.total)) out.push("net tax liability");
  return out;
}

export function nilRefusal(name: string, period: string, blockers: string[]): string {
  return `A nil ${name} cannot be filed for ${period}: the books have ${blockers.join(", ")}. File the normal return instead.`;
}

// ── GSTR-3B helpers ──────────────────────────────────────────

/** Output tax liability of the month by head (settable against ITC). Zero-rated IGST counts as payable tax. */
export function gstr3bLiability(r: GSTR3BReport): HeadAmounts {
  const o = r.outwardSupplies;
  return {
    igst: o.taxable.igst + o.zeroRated.igst,
    cgst: o.taxable.cgst,
    sgst: o.taxable.sgst,
  };
}

/** Reverse-charge tax by head; payable in cash only. */
export function gstr3bRcmCash(r: GSTR3BReport): HeadAmounts {
  return { igst: Number(r.rcmSupplies.igst), cgst: Number(r.rcmSupplies.cgst), sgst: Number(r.rcmSupplies.sgst) };
}

/** Non-blocking reconciliation hint: 3B outward value vs GSTR-1 totals. */
export function reconcileHint(gstr1: GSTR1Report, gstr3b: GSTR3BReport): string | null {
  const o = gstr3b.outwardSupplies;
  const v3b = o.taxable.taxableValue + o.zeroRated.taxableValue + o.exempt.taxableValue;
  const v1 = gstr1.totalTaxableValue;
  const t3b = o.taxable.igst + o.taxable.cgst + o.taxable.sgst;
  if (Math.abs(v3b - v1) > 1 || Math.abs(t3b - gstr1.totalTax) > 1) {
    return `GSTR-3B outward supplies (value ${v3b.toFixed(2)}, tax ${t3b.toFixed(2)}) differ from GSTR-1 (value ${v1.toFixed(2)}, tax ${gstr1.totalTax.toFixed(2)}). Reconcile before filing.`;
  }
  return null;
}

const FILING_KEYS = ["inward_sup", "tx_pmt", "sup_details", "intr_ltfee", "inter_sup", "itc_elg"] as const;

/** The 3B data the filing call needs, taken from the portal's details (step 6). Null when tx_pmt is missing. */
export function pickFilingData(details: Record<string, unknown>): Record<string, unknown> | null {
  if (details.tx_pmt === undefined || details.tx_pmt === null) return null;
  const out: Record<string, unknown> = {};
  for (const k of FILING_KEYS) if (details[k] !== undefined) out[k] = details[k];
  return out;
}

export const GSTR1_PREREQUISITE =
  "All earlier period returns must already be filed, and the GST portal session (valid 6 hours) must stay active until filing finishes.";
export const GSTR3B_PREREQUISITE =
  "GSTR-1 for the same period must be filed first, GSTR-3B must agree with GSTR-1, and the cash and credit ledgers must cover the tax. The GST portal session (valid 6 hours) must stay active until filing finishes.";
