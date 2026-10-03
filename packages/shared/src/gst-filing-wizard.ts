/**
 * gst-filing-wizard.ts: the pure logic behind the GST filing wizard on web and
 * mobile. Nothing here calls the network; the screens feed it what the
 * `gstReturns.*` procedures return and show what it decides.
 *
 *  - which wizard step a persisted attempt belongs to (resume after a reload)
 *  - the polling cadence (never faster than every 12 s) and its time-out
 *  - the 6-hour GST portal session clock
 *  - the pre-flight verdict from the portal's return status (a mirror of the
 *    server's rule in packages/api/src/lib/gst-track.ts; the server still
 *    decides when a step runs)
 *  - grouping of the portal's validation messages, the GSTR-1 section summary
 *  - the exact words of the confirmations the user must give
 *
 * The EVC OTP, the taxpayer token and the checksum never pass through here.
 */

export type FilingKind = "gstr1" | "gstr3b";

/** The persisted attempt state (`filingAttempt.state`); "draft" = nothing started. */
export type AttemptStateName =
  | "draft"
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

export type WizardStep = "check" | "signin" | "prepare" | "review" | "otp" | "done";

export type WizardPhase =
  | "check"
  | "signin"
  // prepare
  | "choose"
  | "polling_save"
  | "save_errors"
  | "save_ok"
  | "polling_proceed"
  | "proceed_errors"
  // review, GSTR-1
  | "load_summary"
  | "summary"
  // review, GSTR-3B
  | "load_ledger"
  | "setoff"
  | "polling_offset"
  | "offset_errors"
  | "load_details"
  | "final"
  // otp
  | "otp_request"
  | "otp_enter"
  | "otp_failed"
  // done
  | "filed";

export interface WizardPosition {
  step: WizardStep;
  phase: WizardPhase;
  /** When the portal session is missing, `step` is "signin" and this is where the sign-in leads. */
  resume?: { step: WizardStep; phase: WizardPhase };
}

const AT: Record<FilingKind, Partial<Record<AttemptStateName, { step: WizardStep; phase: WizardPhase }>>> = {
  gstr1: {
    saved: { step: "prepare", phase: "polling_save" },
    save_validated: { step: "prepare", phase: "save_ok" },
    save_errors: { step: "prepare", phase: "save_errors" },
    proceeding: { step: "prepare", phase: "polling_proceed" },
    proceed_errors: { step: "prepare", phase: "proceed_errors" },
    ready_to_file: { step: "review", phase: "load_summary" },
    summary_fetched: { step: "review", phase: "summary" },
    otp_requested: { step: "otp", phase: "otp_enter" },
    failed: { step: "otp", phase: "otp_failed" },
    filed: { step: "done", phase: "filed" },
  },
  gstr3b: {
    saved: { step: "prepare", phase: "polling_save" },
    save_validated: { step: "review", phase: "load_ledger" },
    save_errors: { step: "prepare", phase: "save_errors" },
    ledger_checked: { step: "review", phase: "setoff" },
    offset_confirmed: { step: "review", phase: "setoff" },
    offset_posted: { step: "review", phase: "polling_offset" },
    offset_validated: { step: "review", phase: "load_details" },
    offset_errors: { step: "review", phase: "offset_errors" },
    details_fetched: { step: "review", phase: "final" },
    otp_requested: { step: "otp", phase: "otp_enter" },
    failed: { step: "otp", phase: "otp_failed" },
    filed: { step: "done", phase: "filed" },
  },
};

const AT_NIL: Record<FilingKind, Partial<Record<AttemptStateName, { step: WizardStep; phase: WizardPhase }>>> = {
  gstr1: {
    proceeding: { step: "prepare", phase: "polling_proceed" },
    proceed_errors: { step: "prepare", phase: "proceed_errors" },
    ready_to_file: { step: "otp", phase: "otp_request" },
    otp_requested: { step: "otp", phase: "otp_enter" },
    failed: { step: "otp", phase: "otp_failed" },
    filed: { step: "done", phase: "filed" },
  },
  gstr3b: {
    otp_requested: { step: "otp", phase: "otp_enter" },
    failed: { step: "otp", phase: "otp_failed" },
    filed: { step: "done", phase: "filed" },
  },
};

/**
 * The wizard position for a persisted attempt. A fresh return starts at the
 * pre-flight check; anything already started resumes where it stopped. When the
 * 6-hour portal session is gone, sign-in comes first and then leads on to the
 * persisted step (`resume`).
 */
export function deriveWizardStep(input: {
  kind: FilingKind;
  state: AttemptStateName;
  nil: boolean;
  signedIn: boolean;
  /** The user has read the pre-flight (only matters for a fresh return). */
  checked: boolean;
}): WizardPosition {
  const { kind, state, nil, signedIn, checked } = input;
  if (state === "filed") return { step: "done", phase: "filed" };
  if (state === "draft") {
    if (!checked) return { step: "check", phase: "check" };
    if (!signedIn) return { step: "signin", phase: "signin", resume: { step: "prepare", phase: "choose" } };
    return { step: "prepare", phase: "choose" };
  }
  const table = nil ? AT_NIL[kind] : AT[kind];
  const at = table[state] ?? { step: "prepare" as const, phase: "choose" as const };
  if (!signedIn) return { step: "signin", phase: "signin", resume: at };
  return at;
}

/** The steps shown in the stepper (a nil return has no review step). */
export function wizardSteps(nil: boolean): Array<{ step: WizardStep; label: string }> {
  const all: Array<{ step: WizardStep; label: string }> = [
    { step: "check", label: "Check" },
    { step: "signin", label: "Sign in" },
    { step: "prepare", label: "Prepare" },
    { step: "review", label: "Review" },
    { step: "otp", label: "OTP and file" },
    { step: "done", label: "Done" },
  ];
  return nil ? all.filter((s) => s.step !== "review") : all;
}

// ── Polling ──────────────────────────────────────────────────

/** Never ask the portal's return status more often than this (the server enforces the same). */
export const POLL_INTERVAL_MS = 12_000;
/** The server gives up after 180 s; the client stops a little later so it sees the server's answer. */
export const POLL_TIMEOUT_MS = 190_000;

/** Delay before the next status check: the server's hint, but never under 12 s. */
export function nextPollDelay(retryAfterMs?: number | null): number {
  return Math.max(POLL_INTERVAL_MS, retryAfterMs ?? 0);
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
}

// ── Portal session (valid 6 hours) ───────────────────────────

export const PORTAL_SESSION_MS = 6 * 60 * 60 * 1000;
/** The server treats a session as over 10 minutes early; so does the clock. */
export const PORTAL_SESSION_MARGIN_MS = 10 * 60 * 1000;

/** Milliseconds left of the portal session that began at `verifiedAt` (0 = sign in again). */
export function sessionRemainingMs(verifiedAt: number | null | undefined, now: number): number {
  if (!verifiedAt || !Number.isFinite(verifiedAt)) return 0;
  return Math.max(0, verifiedAt + PORTAL_SESSION_MS - PORTAL_SESSION_MARGIN_MS - now);
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "less than a minute";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/**
 * A GST portal session that is gone or expired. The server reports it as UNAUTHORIZED
 * on a filing procedure; requestOtp and verifyOtp never do (their 401 is the app's own sign-in).
 */
export function isPortalSessionError(error: unknown): boolean {
  const data = (error as { data?: { code?: string; path?: string } } | null | undefined)?.data;
  if (data?.code !== "UNAUTHORIZED") return false;
  const path = data.path ?? "";
  return path.startsWith("gstReturns.") && path !== "gstReturns.requestOtp" && path !== "gstReturns.verifyOtp";
}

// ── Periods ──────────────────────────────────────────────────

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Aug 2026", the label the server uses in its messages. */
export function wizardPeriodLabel(year: number, month: number): string {
  return `${MONTH_SHORT[month - 1]} ${year}`;
}

/** GSTN period "082026" for year 2026, month 8. */
export function gstnPeriodOf(year: number, month: number): string {
  return `${String(month).padStart(2, "0")}${year}`;
}

export function periodFromGstn(period: string): { year: number; month: number } {
  return { year: Number(period.slice(2)), month: Number(period.slice(0, 2)) };
}

/** Start year of the Indian financial year containing the calendar month. */
export function fyStartOf(year: number, month: number): number {
  return month >= 4 ? year : year - 1;
}

export function returnName(kind: FilingKind): string {
  return kind === "gstr1" ? "GSTR-1" : "GSTR-3B";
}

// ── Pre-flight (mirror of the server's prerequisite rule) ────

export interface StatusMonth {
  period: string;
  label: string;
  gstr1: { arn: string | null; filedOn: string | null } | null;
  gstr3b: { arn: string | null; filedOn: string | null } | null;
}

export interface PreflightResult {
  verdict: "ok" | "missing" | "unknown" | "skipped";
  /** Earlier returns that must be filed first. */
  missing: Array<{ kind: FilingKind; period: string; label: string }>;
  alreadyFiled: { arn: string | null; filedOn: string | null } | null;
  notes: string[];
}

const pIdx = (p: string) => Number(p.slice(2)) * 12 + Number(p.slice(0, 2));
const pFromIdx = (i: number) => {
  const year = Math.floor((i - 1) / 12);
  return `${String(i - year * 12).padStart(2, "0")}${year}`;
};

/**
 * Whether earlier returns are filed, from the portal's return status of the
 * period's financial year (and the previous one when it is April).
 * Blocks only on "missing"; "unknown" (status unavailable) is a warning.
 * Monthly filing is assumed, as on the server.
 */
export function preflightFromStatus(opts: {
  kind: FilingKind;
  /** GSTN period "MMYYYY". */
  period: string;
  composition: boolean;
  /** null = the portal could not be checked. */
  months: StatusMonth[] | null;
}): PreflightResult {
  const { kind, period, months } = opts;
  if (opts.composition) {
    return { verdict: "skipped", missing: [], alreadyFiled: null, notes: ["Composition dealers file GSTR-4 and CMP-08; monthly returns do not apply."] };
  }
  if (months === null) {
    return { verdict: "unknown", missing: [], alreadyFiled: null, notes: ["Could not check earlier returns on the GST portal. Make sure they are filed before you continue."] };
  }
  const notes = ["Monthly filing is assumed: the app does not record whether you file monthly or quarterly."];
  const filed = (k: FilingKind, p: string) => months.find((m) => m.period === p)?.[k] ?? null;
  const ofKind = months.filter((m) => m[kind]).map((m) => m.period);
  const own = filed(kind, period);
  const alreadyFiled = own ? { arn: own.arn, filedOn: own.filedOn } : null;
  const missing: PreflightResult["missing"] = [];
  const name = returnName(kind);
  if (ofKind.length === 0 && !own) {
    notes.push(`No earlier ${name} found on the GST portal. If this is your first return you can continue.`);
  } else {
    const first = Math.min(...ofKind.map(pIdx), own ? pIdx(period) : Infinity);
    const { year, month } = periodFromGstn(period);
    const fyStartIdx = pIdx(gstnPeriodOf(fyStartOf(year, month), 4));
    // Like the server: from the first return seen, but no earlier than March of the previous financial year.
    for (let i = Math.max(first, fyStartIdx - 1); i < pIdx(period); i++) {
      const p = pFromIdx(i);
      if (!filed(kind, p) && months.some((m) => m.period === p)) {
        const pp = periodFromGstn(p);
        missing.push({ kind, period: p, label: `${name} ${wizardPeriodLabel(pp.year, pp.month)}` });
      }
    }
  }
  if (kind === "gstr3b" && !filed("gstr1", period)) {
    const pp = periodFromGstn(period);
    missing.push({ kind: "gstr1", period, label: `GSTR-1 ${wizardPeriodLabel(pp.year, pp.month)}` });
  }
  return { verdict: missing.length ? "missing" : "ok", missing, alreadyFiled, notes };
}

/** Non-blocking hint: GSTR-3B outward supplies vs the GSTR-1 totals of the same period. */
export function reconcile3bWithGstr1(opts: {
  gstr1: { totalTaxableValue: number; totalTax: number };
  gstr3b: { outwardTaxableValue: number; outwardTax: number };
}): string | null {
  const dv = Math.abs(opts.gstr3b.outwardTaxableValue - opts.gstr1.totalTaxableValue);
  const dt = Math.abs(opts.gstr3b.outwardTax - opts.gstr1.totalTax);
  if (dv > 1 || dt > 1) {
    return "GSTR-3B outward supplies differ from GSTR-1 for this period. Reconcile them before you file.";
  }
  return null;
}

// ── Portal validation messages ───────────────────────────────

export type FixTarget = "invoices" | "credit-notes" | "items";

export interface ErrorGroup {
  section: string;
  label: string;
  messages: string[];
  /** Where in the books the cause is usually fixed. */
  fix: FixTarget | null;
}

const SECTIONS: Array<{ section: string; label: string; test: RegExp; fix: FixTarget | null }> = [
  { section: "b2b", label: "B2B invoices", test: /\bb2b\b/i, fix: "invoices" },
  { section: "b2cl", label: "B2C large invoices", test: /\bb2cl\b|b2c\s*large/i, fix: "invoices" },
  { section: "b2cs", label: "B2C small supplies", test: /\bb2cs\b|b2c\s*small/i, fix: "invoices" },
  { section: "cdnur", label: "Credit and debit notes (unregistered)", test: /\bcdnur\b/i, fix: "credit-notes" },
  { section: "cdnr", label: "Credit and debit notes (registered)", test: /\bcdnr?\b|credit\s*\/?\s*debit\s*note/i, fix: "credit-notes" },
  { section: "hsn", label: "HSN summary", test: /\bhsn\b/i, fix: "items" },
  { section: "nil", label: "Nil, exempt and non-GST supplies", test: /\bnil\b|exempt/i, fix: "invoices" },
  { section: "doc_issue", label: "Documents issued", test: /doc_?issue|documents?\s*issued/i, fix: null },
];

/** Groups the portal's messages by the return section they mention (order of first appearance). */
export function groupPortalErrors(messages: string[]): ErrorGroup[] {
  const out = new Map<string, ErrorGroup>();
  for (const raw of messages) {
    const message = raw.trim();
    if (!message) continue;
    const hit = SECTIONS.find((s) => s.test.test(message));
    const key = hit?.section ?? "other";
    let g = out.get(key);
    if (!g) {
      g = { section: key, label: hit?.label ?? "Other messages from the GST portal", messages: [], fix: hit?.fix ?? null };
      out.set(key, g);
    }
    if (!g.messages.includes(message)) g.messages.push(message);
  }
  return [...out.values()];
}

// ── GSTR-1 summary (sec_sum) ─────────────────────────────────

export interface SummaryRow {
  section: string;
  records: number | null;
  taxable: number | null;
  igst: number | null;
  cgst: number | null;
  sgst: number | null;
  cess: number | null;
  value: number | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const firstNum = (o: Record<string, unknown>, keys: string[]): number | null => {
  for (const k of keys) {
    const n = num(o[k]);
    if (n !== null) return n;
  }
  return null;
};

const SECTION_NAMES: Record<string, string> = {
  b2b: "B2B invoices",
  b2ba: "B2B amendments",
  b2cl: "B2C large invoices",
  b2cla: "B2C large amendments",
  b2cs: "B2C small supplies",
  b2csa: "B2C small amendments",
  cdnr: "Credit and debit notes (registered)",
  cdnra: "Credit and debit note amendments (registered)",
  cdnur: "Credit and debit notes (unregistered)",
  cdnura: "Credit and debit note amendments (unregistered)",
  exp: "Exports",
  expa: "Export amendments",
  at: "Advances received",
  ata: "Advance amendments",
  txpd: "Advances adjusted",
  txpda: "Advance adjustment amendments",
  nil: "Nil, exempt and non-GST supplies",
  hsn: "HSN summary",
  doc_issue: "Documents issued",
};

/**
 * Section totals from the portal's `sec_sum`. The exact shape is not documented to us,
 * so this reads the usual GSTN names (`sec_nm`, `ttl_rec`, `ttl_val`, `ttl_tax`, `ttl_igst`...)
 * and shows what it can read. Rows with nothing readable come back with null numbers.
 */
export function summariseSecSum(secSum: unknown): SummaryRow[] {
  if (!Array.isArray(secSum)) return [];
  const rows: SummaryRow[] = [];
  for (const item of secSum) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const raw = String(o.sec_nm ?? o.section ?? o.name ?? "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    rows.push({
      section: SECTION_NAMES[key] ?? raw.toUpperCase(),
      records: firstNum(o, ["ttl_rec", "total_records", "records"]),
      taxable: firstNum(o, ["ttl_tax", "ttl_txval", "taxable_value", "txval"]),
      igst: firstNum(o, ["ttl_igst", "igst"]),
      cgst: firstNum(o, ["ttl_cgst", "cgst"]),
      sgst: firstNum(o, ["ttl_sgst", "sgst"]),
      cess: firstNum(o, ["ttl_cess", "cess"]),
      value: firstNum(o, ["ttl_val", "total_value", "val"]),
    });
  }
  return rows;
}

// ── Set-off proposal (shape of OffsetProposal) ───────────────

export interface ProposalLike {
  itc: object;
  cash: Record<"igst" | "cgst" | "sgst", { tx: number; intr: number; fee: number }>;
  cashNeeded: Record<"igst" | "cgst" | "sgst", number>;
  cashShortfall: Record<"igst" | "cgst" | "sgst", number>;
  sufficient: boolean;
  itcRemaining: Record<"igst" | "cgst" | "sgst", number>;
}

export const HEAD_LABEL = { igst: "IGST", cgst: "CGST", sgst: "SGST" } as const;

export function totalOf(h: Record<"igst" | "cgst" | "sgst", number>): number {
  return Math.round((h.igst + h.cgst + h.sgst) * 100) / 100;
}

/** Total credit the proposal uses. */
export function itcUsedTotal(p: ProposalLike): number {
  return Math.round(Object.values(p.itc as Record<string, number>).reduce((a, b) => a + b, 0) * 100) / 100;
}

/** Credit rows of the proposal: which credit pays which tax. Zero rows are left out. */
export function itcRows(p: ProposalLike): Array<{ credit: string; against: string; amount: number }> {
  const map: Array<[string, string, string]> = [
    ["igstOnIgst", "IGST credit", "IGST"],
    ["igstOnCgst", "IGST credit", "CGST"],
    ["igstOnSgst", "IGST credit", "SGST"],
    ["cgstOnCgst", "CGST credit", "CGST"],
    ["cgstOnIgst", "CGST credit", "IGST"],
    ["sgstOnSgst", "SGST credit", "SGST"],
    ["sgstOnIgst", "SGST credit", "IGST"],
  ];
  return map
    .map(([k, credit, against]) => ({ credit, against, amount: (p.itc as Record<string, number>)[k] ?? 0 }))
    .filter((r) => r.amount > 0);
}

// ── The words of the confirmations ───────────────────────────

export const NIL_CONFIRM_TEXT = {
  gstr1: (period: string) => `I confirm there were no outward supplies in ${period}`,
  gstr3b: (period: string) => `I confirm there were no transactions in ${period}`,
};
export const SETOFF_CONFIRM_TEXT = "I have reviewed this set-off";
export const FILE_CONFIRM_TEXT = "I understand this files the return with the government and cannot be undone";

export function finalConfirmationTitle(kind: FilingKind, period: string, gstin: string): string {
  return `File ${returnName(kind)} for ${period} for GSTIN ${gstin}`;
}

/** Digits only, at most 8 (what the API accepts is 4 to 8; the portal sends 6). */
export function cleanOtp(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 8);
}

/** Valid for the server's 4-8 digit rule; the wizard asks for the 6 digits the portal sends. */
export function isOtpComplete(otp: string): boolean {
  return /^\d{6}$/.test(otp);
}

export const OTP_RESEND_SECONDS = 30;

// ── Polling loop (no framework) ──────────────────────────────

export interface PollReply {
  status: "processing" | "wait" | "done" | "errors" | "timeout";
  retryAfterMs?: number;
  errors?: string[];
}

/**
 * Runs the status check loop and returns a function that stops it. The first check
 * is 12 s out (or immediate for a user-requested retry, which restarts the server's
 * clock); every later one waits at least 12 s after the previous, whatever the server
 * hints; it gives up after about 3 minutes (`onTimeout`). Web and mobile both use it.
 */
export function startPortalPolling(opts: {
  poll: (restart: boolean) => Promise<PollReply>;
  restart?: boolean;
  onSettled: (outcome: "done" | "errors", errors: string[]) => void;
  onTimeout: () => void;
  onSessionLost: () => void;
  onError: (message: string) => void;
}): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const startedAt = Date.now();

  const run = async (restart: boolean): Promise<void> => {
    if (cancelled) return;
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) return opts.onTimeout();
    try {
      const r = await opts.poll(restart);
      if (cancelled) return;
      if (r.status === "done" || r.status === "errors") return opts.onSettled(r.status, r.errors ?? []);
      if (r.status === "timeout") return opts.onTimeout();
      timer = setTimeout(() => void run(false), nextPollDelay(r.retryAfterMs));
    } catch (e) {
      if (cancelled) return;
      if (isPortalSessionError(e)) return opts.onSessionLost();
      opts.onError(e instanceof Error && e.message ? e.message : "The check failed.");
    }
  };

  if (opts.restart) void run(true);
  else timer = setTimeout(() => void run(false), POLL_INTERVAL_MS);
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

/** Roles that may prepare and file GST returns (the API enforces the same: GstReport create). */
export const GST_FILING_ROLES: readonly string[] = ["owner", "admin", "ca_filing", "superadmin"];

export function canFileGstReturns(role: string | null | undefined): boolean {
  return !!role && GST_FILING_ROLES.includes(role);
}
