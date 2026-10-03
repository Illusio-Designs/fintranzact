/**
 * sandbox/gst-returns.ts — GSTR-1 / GSTR-3B filing and GSTR-2B download through
 * Sandbox.co.in.
 *
 * OFFICIAL RECIPES (owner-supplied Sandbox documentation) now define:
 *   GSTR-1        session -> save -> proceed (new-proceed?is_nil=N) -> summary
 *                 (sec_sum + chksum) -> EVC OTP -> file (newSumFlag)
 *   Nil GSTR-1    session -> proceed (is_nil=Y) -> EVC OTP -> file (isnil "Y")
 *   GSTR-3B       session -> get -> save -> ledger balances -> offset-liability
 *                 -> get (tx_pmt) -> EVC OTP -> file
 *   Nil GSTR-3B   session -> EVC OTP -> file (isNil "Y")
 *   Every taxpayer call sends authorization: <taxpayer token>, x-api-key,
 *   x-api-version 1.0.0 and Content-Type: application/json. The taxpayer token
 *   is valid 6 hours.
 *   After save / proceed / offset the GST Return Status endpoint is polled
 *   (see gst-return-flow.ts for the schedule).
 *
 * SESSION MODEL
 *   The recipe's "Generate Taxpayer Session" is not documented to us. Until it
 *   is, the taxpayer's GST-portal username + GSTIN request an OTP (sent by the
 *   GST portal to the registered mobile); the OTP is exchanged for a session
 *   token. The token is cached in memory only (never persisted, never logged),
 *   keyed by GSTIN, with a 10-minute safety margin inside the 6 h lifetime.
 *
 * STILL UNVERIFIED (marked VERIFY below)
 *   - GST Return Status URL, query and response shape (RETURN_STATUS_PATH).
 *   - Generate Taxpayer Session endpoint details (requestOtp / verifyOtp paths).
 *   - Whether `fp` is MMYYYY (the save example mixes URL 2023/12 with fp 112023).
 *   - Error body shapes; whether `reference_id` is the exact response key.
 *   - Inner shapes of the 3B sections, pdcash, pditc and the ledger response.
 *   - GSTR-2B path (no recipe yet).
 *
 *   NOT MAPPED (left out rather than guessed, see mapper below):
 *     GSTR-1: exp, expa, at/ata, txpd/txpda, doc_issue, b2ba/b2cla/cdnra/cdnura/b2csa
 *             are sent as empty (the app holds no data for them).
 *     GSTR-3B: inward_sup, 3.2 inter_sup, ITC split by import / RCM / ISD, ITC
 *              reversal and ineligible ITC, interest and late fee.
 */

import { logger } from "../logger.js";
import {
  gstr1ToPortalJson,
  type GSTR1Report,
  type GSTR3BReport,
} from "../gst-reports.js";
import { SandboxClient, SandboxError } from "./client.js";

// ── Endpoint paths ──

const GSTR_BASE = "/gst/compliance/tax-payer";

/** Sent on every taxpayer call (official recipe). */
export const GST_API_VERSION = "1.0.0";

/** Nil-return body flags, copied literally from their recipes. NOTE THE CASING. */
export const GSTR1_NIL_FLAG = { key: "isnil", value: "Y" } as const;
export const GSTR3B_NIL_FLAG = { key: "isNil", value: "Y" } as const;

/** "MMYYYY" -> { month: "MM", year: "YYYY" } path segments. */
function seg(period: string): { year: string; month: string } {
  return { year: period.slice(2), month: period.slice(0, 2) };
}

export const GST_RETURNS_PATHS = {
  /** POST body { username, gstin } -> OTP to registered mobile. VERIFY (Generate Taxpayer Session recipe not seen). */
  requestOtp: () => `${GSTR_BASE}/otp`,
  /** POST ?otp=… body { username, gstin } -> session token. VERIFY (same). */
  verifyOtp: () => `${GSTR_BASE}/otp/verify`,
  /** POST save GSTR-1 (all sections in one body). */
  gstr1Save: (period: string) => {
    const { year, month } = seg(period);
    return `${GSTR_BASE}/gstrs/gstr-1/${year}/${month}`;
  },
  /** POST ?is_nil=N|Y body { gstin, ret_period } -> reference_id. */
  gstr1Proceed: (period: string) => {
    const { year, month } = seg(period);
    return `${GSTR_BASE}/gstrs/gstr-1/${year}/${month}/new-proceed`;
  },
  /** GET ?summary_type=long -> data incl. sec_sum + chksum. */
  gstr1Summary: (period: string) => {
    const { year, month } = seg(period);
    return `${GSTR_BASE}/gstrs/gstr-1/${year}/${month}`;
  },
  /** POST ?pan=&otp= body { ret_period, newSumFlag, sec_sum, gstin, chksum } (nil: { ret_period, gstin, isnil }). */
  gstr1File: (period: string) => {
    const { year, month } = seg(period);
    return `${GSTR_BASE}/gstrs/gstr-1/${year}/${month}/file`;
  },
  /** POST ?gstr=gstr-1|gstr-3b body { pan } -> OTP to the registered mobile / email. */
  evcOtp: () => `${GSTR_BASE}/evc/otp`,
  /**
   * GST Return Status (docs: api-reference/gst/compliance/endpoints/taxpayer/
   * common/gst_return_status). The exact URL was NOT given to us. VERIFY.
   * Assumed: GET with ?reference_id=. Everything about it lives here and in
   * interpretReturnStatus().
   */
  returnStatus: (period: string) => {
    const { year, month } = seg(period);
    return `${GSTR_BASE}/gstrs/${year}/${month}/status`; // VERIFY
  },
  /** GET existing details / POST save GSTR-3B. */
  gstr3b: (period: string) => {
    const { year, month } = seg(period);
    return `${GSTR_BASE}/gstrs/gstr-3b/${year}/${month}`;
  },
  /** GET cash / ITC / liability ledger balances. */
  ledgerBalance: (period: string) => {
    const { year, month } = seg(period);
    return `${GSTR_BASE}/ledgers/bal/${year}/${month}`;
  },
  /** POST body { pdcash, pditc } -> reference_id. */
  gstr3bOffset: (period: string) => {
    const { year, month } = seg(period);
    return `${GSTR_BASE}/gstrs/gstr-3b/${year}/${month}/offset-liability`;
  },
  /** POST ?pan=&otp=. */
  gstr3bFile: (period: string) => {
    const { year, month } = seg(period);
    return `${GSTR_BASE}/gstrs/gstr-3b/${year}/${month}/file`;
  },
  /** GET auto-drafted GSTR-2B. VERIFY (no recipe yet). */
  gstr2b: (period: string) => {
    const { year, month } = seg(period);
    return `${GSTR_BASE}/gstrs/gstr-2b/${year}/${month}`;
  },
} as const;

/** Taxpayer-session lifetime when the gateway gives no expiry. */
export const GST_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const SESSION_SKEW_MS = 10 * 60 * 1000;

// ── Errors ───────────────────────────────────────────────────

export class GstReturnsError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable = false,
    public readonly transactionId?: string,
  ) {
    super(message);
    this.name = "GstReturnsError";
  }
}

/** True when the caller must (re-)authenticate with a fresh OTP. */
export function isSessionError(err: unknown): boolean {
  return err instanceof GstReturnsError && err.code === "no_session";
}

// ── Session store (memory only) ──────────────────────────────

interface Session {
  token: string;
  expiresAt: number;
}

const sharedSessions = new Map<string, Session>();

/** Test hook. */
export function clearGstSessionsForTests(): void {
  sharedSessions.clear();
}

/** True if a live taxpayer session exists for this GSTIN. */
export function hasGstSession(gstin: string, now: () => number = Date.now): boolean {
  const s = sharedSessions.get(gstin);
  return !!s && s.expiresAt > now();
}

// ── Response handling ────────────────────────────────────────

interface GstnData {
  status_cd?: string | number;
  status?: string | number;
  access_token?: string;
  expiry?: number;
  error?: { message?: string; error_cd?: string; errorCodes?: string };
  message?: string;
  [k: string]: unknown;
}

/**
 * Portal-level failures come back as HTTP 200 with status_cd "0" (or an
 * `error` object); transport-level ones are SandboxErrors. Both become
 * GstReturnsError.
 */
function unwrap<T extends GstnData>(data: T | undefined, what: string, tx?: string): T {
  const status = data?.status_cd ?? data?.status;
  const failed = !data || status === "0" || status === 0 || !!data.error;
  if (failed) {
    const code = data?.error?.error_cd ?? data?.error?.errorCodes ?? "portal";
    const detail = data?.error?.message ?? data?.message ?? "";
    throw new GstReturnsError(`GST ${what} failed${detail ? `: ${detail}` : ""} [${code}]`, code, false, tx);
  }
  return data;
}

function toError(err: unknown, what: string): Error {
  if (err instanceof GstReturnsError) return err;
  if (err instanceof SandboxError) {
    const expired = err.httpStatus === 401 || err.httpStatus === 403;
    return new GstReturnsError(
      expired ? `GST ${what} failed: the GST portal session has expired. Request a new OTP.` : `GST ${what} failed: ${err.message}`,
      expired ? "no_session" : err.code,
      err.isRetryable,
      err.transactionId,
    );
  }
  return err instanceof Error ? err : new GstReturnsError(`GST ${what} failed`, "unknown");
}

// ── Client ───────────────────────────────────────────────────

export interface GstReturnsConfig {
  gstin: string;
  /** The taxpayer's GST-portal username. */
  username: string;
}

export interface GstReturnsOptions {
  now?: () => number;
  sessions?: Map<string, Session>;
  /**
   * Called at most once per request when the taxpayer token was rejected
   * (401/403) mid-flow, to create a fresh session. Without it the session is
   * dropped and the caller must sign in again; flow state is persisted, so the
   * flow resumes from the same step afterwards.
   */
  reauth?: () => Promise<void>;
}

export interface FilingResult {
  /** Acknowledgement / reference number from the portal, when returned. */
  referenceId: string | null;
}

export type ReturnPhase = "processing" | "processed" | "errors";
export interface ReturnStatus {
  phase: ReturnPhase;
  /** Portal validation messages when phase is "errors". */
  errors: string[];
}

export interface Gstr1Summary {
  secSum: unknown[];
  chksum: string;
}

const TAXPAYER_HEADERS = { "x-api-version": GST_API_VERSION } as const;

export class SandboxGstReturnsClient {
  private readonly now: () => number;
  private readonly sessions: Map<string, Session>;
  private readonly reauth?: () => Promise<void>;

  constructor(
    private readonly sandbox: SandboxClient,
    private readonly config: GstReturnsConfig,
    opts: GstReturnsOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.sessions = opts.sessions ?? sharedSessions;
    this.reauth = opts.reauth;
  }

  get hasSession(): boolean {
    const s = this.sessions.get(this.config.gstin);
    return !!s && s.expiresAt > this.now();
  }

  /** Ask the GST portal to send an OTP to the registered mobile. */
  async requestOtp(): Promise<void> {
    try {
      const res = await this.sandbox.request<GstnData>("POST", GST_RETURNS_PATHS.requestOtp(), {
        body: { username: this.config.username, gstin: this.config.gstin },
        headers: TAXPAYER_HEADERS,
      });
      unwrap(res.data, "OTP request", res.transaction_id);
    } catch (err) {
      throw toError(err, "OTP request");
    }
  }

  /** Exchange the OTP for a taxpayer session (kept in memory, valid 6 h). */
  async verifyOtp(otp: string): Promise<void> {
    try {
      const res = await this.sandbox.request<GstnData>("POST", GST_RETURNS_PATHS.verifyOtp(), {
        query: { otp },
        body: { username: this.config.username, gstin: this.config.gstin },
        headers: TAXPAYER_HEADERS,
      });
      const d = unwrap(res.data, "OTP verification", res.transaction_id);
      if (!d.access_token) {
        throw new GstReturnsError("GST OTP verification returned no session token", "auth", false, res.transaction_id);
      }
      const ttl = GST_SESSION_TTL_MS - SESSION_SKEW_MS;
      const expiresAt = typeof d.expiry === "number" && d.expiry > this.now() ? d.expiry - SESSION_SKEW_MS : this.now() + ttl;
      this.sessions.set(this.config.gstin, { token: d.access_token, expiresAt });
    } catch (err) {
      throw toError(err, "OTP verification");
    }
  }

  clearSession(): void {
    this.sessions.delete(this.config.gstin);
  }

  private token(): string {
    const s = this.sessions.get(this.config.gstin);
    if (!s || s.expiresAt <= this.now()) {
      this.sessions.delete(this.config.gstin);
      throw new GstReturnsError("No active GST portal session. Request an OTP and verify it first.", "no_session");
    }
    return s.token;
  }

  private async call<T extends GstnData = GstnData>(
    what: string,
    method: "GET" | "POST" | "PUT",
    path: string,
    opts: { body?: unknown; query?: Record<string, string> } = {},
    reauthed = false,
  ): Promise<T> {
    try {
      const res = await this.sandbox.request<T>(method, path, { ...opts, headers: TAXPAYER_HEADERS, authToken: this.token() });
      return unwrap(res.data as GstnData, what, res.transaction_id) as T;
    } catch (err) {
      const e = toError(err, what);
      if (isSessionError(e)) {
        this.clearSession();
        if (this.reauth && !reauthed) {
          await this.reauth();
          return this.call<T>(what, method, path, opts, true);
        }
      }
      throw e;
    }
  }

  // ── Shared: status polling and EVC OTP ──────────────────────

  /** One GST Return Status check for a save / proceed / offset `reference_id`. VERIFY the endpoint. */
  async getReturnStatus(period: string, referenceId: string): Promise<ReturnStatus> {
    assertPeriod(period);
    const d = await this.call("return status", "GET", GST_RETURNS_PATHS.returnStatus(period), {
      query: { reference_id: referenceId },
    });
    return interpretReturnStatus(d);
  }

  /** Send the EVC OTP to the registered mobile/email of the PAN tied to the registration. */
  async requestEvcOtp(gstr: "gstr-1" | "gstr-3b", pan: string): Promise<void> {
    assertPan(pan);
    await this.call("EVC OTP request", "POST", GST_RETURNS_PATHS.evcOtp(), {
      query: { gstr },
      body: { pan },
    });
  }

  // ── GSTR-1 ─────────────────────────────────────────────────

  /** Step 2: save all sections; returns the reference_id to poll. */
  async saveGstr1(period: string, body: Gstr1SaveBody): Promise<string> {
    assertPeriod(period);
    const d = await this.call("GSTR-1 save", "POST", GST_RETURNS_PATHS.gstr1Save(period), { body });
    return requireReference(d, "GSTR-1 save");
  }

  /** Step 3 (and nil step 2): initialise / validate; returns the reference_id to poll. */
  async proceedGstr1(period: string, nil: boolean): Promise<string> {
    assertPeriod(period);
    const d = await this.call("GSTR-1 proceed", "POST", GST_RETURNS_PATHS.gstr1Proceed(period), {
      query: { is_nil: nil ? "Y" : "N" },
      body: { gstin: this.config.gstin, ret_period: period },
    });
    return requireReference(d, "GSTR-1 proceed");
  }

  /** Step 4: the detailed summary; extracts sec_sum and chksum (never logged). */
  async getGstr1Summary(period: string): Promise<Gstr1Summary> {
    assertPeriod(period);
    const d = await this.call("GSTR-1 summary", "GET", GST_RETURNS_PATHS.gstr1Summary(period), {
      query: { summary_type: "long" },
    });
    const secSum = findKey(d, "sec_sum");
    const chksum = findKey(d, "chksum");
    if (!Array.isArray(secSum) || typeof chksum !== "string" || !chksum) {
      throw new GstReturnsError("GST portal summary did not include sec_sum and chksum", "no_summary", false);
    }
    return { secSum, chksum };
  }

  /** Step 6. */
  async fileGstr1(period: string, evcOtp: string, pan: string, summary: Gstr1Summary): Promise<FilingResult> {
    assertPeriod(period);
    assertPan(pan);
    const d = await this.call("GSTR-1 filing", "POST", GST_RETURNS_PATHS.gstr1File(period), {
      query: { pan, otp: evcOtp },
      body: {
        ret_period: period,
        newSumFlag: true,
        sec_sum: summary.secSum,
        gstin: this.config.gstin,
        chksum: summary.chksum,
      },
    });
    return filingResult(d);
  }

  /** Nil GSTR-1: no sec_sum, chksum or newSumFlag. */
  async fileNilGstr1(period: string, evcOtp: string, pan: string): Promise<FilingResult> {
    assertPeriod(period);
    assertPan(pan);
    const d = await this.call("nil GSTR-1 filing", "POST", GST_RETURNS_PATHS.gstr1File(period), {
      query: { pan, otp: evcOtp },
      body: { ret_period: period, gstin: this.config.gstin, [GSTR1_NIL_FLAG.key]: GSTR1_NIL_FLAG.value },
    });
    return filingResult(d);
  }

  // ── GSTR-3B ────────────────────────────────────────────────

  /** Steps 2 and 6: the 3B data the portal currently holds (after offset it includes tx_pmt). */
  async getGstr3b(period: string): Promise<Record<string, unknown>> {
    assertPeriod(period);
    const d = await this.call("GSTR-3B details", "GET", GST_RETURNS_PATHS.gstr3b(period));
    return (d.data && typeof d.data === "object" ? d.data : d) as Record<string, unknown>;
  }

  /** Step 3: save; returns the reference_id to poll. */
  async saveGstr3b(period: string, payload: unknown): Promise<string> {
    assertPeriod(period);
    const d = await this.call("GSTR-3B save", "POST", GST_RETURNS_PATHS.gstr3b(period), { body: payload });
    return requireReference(d, "GSTR-3B save");
  }

  /** Step 4. */
  async getLedgerBalances(period: string): Promise<unknown> {
    assertPeriod(period);
    const d = await this.call("ledger balance", "GET", GST_RETURNS_PATHS.ledgerBalance(period));
    return d.data ?? d;
  }

  /** Step 5: post the confirmed cash / ITC split; returns the reference_id to poll. */
  async offsetGstr3bLiability(period: string, body: { pdcash: unknown[]; pditc: unknown }): Promise<string> {
    assertPeriod(period);
    const d = await this.call("GSTR-3B offset liability", "POST", GST_RETURNS_PATHS.gstr3bOffset(period), { body });
    return requireReference(d, "GSTR-3B offset liability");
  }

  /** Step 8: `data` is the complete 3B data including tx_pmt (from step 6). */
  async fileGstr3b(period: string, evcOtp: string, pan: string, data: Record<string, unknown>): Promise<FilingResult> {
    assertPeriod(period);
    assertPan(pan);
    const d = await this.call("GSTR-3B filing", "POST", GST_RETURNS_PATHS.gstr3bFile(period), {
      query: { pan, otp: evcOtp },
      body: { ret_period: period, gstin: this.config.gstin, ...data },
    });
    return filingResult(d);
  }

  /** Nil GSTR-3B: body is only ret_period, gstin and isNil (capital N). */
  async fileNilGstr3b(period: string, evcOtp: string, pan: string): Promise<FilingResult> {
    assertPeriod(period);
    assertPan(pan);
    const d = await this.call("nil GSTR-3B filing", "POST", GST_RETURNS_PATHS.gstr3bFile(period), {
      query: { pan, otp: evcOtp },
      body: { ret_period: period, gstin: this.config.gstin, [GSTR3B_NIL_FLAG.key]: GSTR3B_NIL_FLAG.value },
    });
    return filingResult(d);
  }

  // ── GSTR-2B ────────────────────────────────────────────────

  /** The raw GSTN GSTR-2B JSON (feed it to parseGSTR2BJSON). */
  async fetchGstr2b(period: string): Promise<unknown> {
    assertPeriod(period);
    const d = await this.call("GSTR-2B download", "GET", GST_RETURNS_PATHS.gstr2b(period));
    logger.info({ gstin: this.config.gstin, period }, "GSTR-2B downloaded");
    return d.data ?? d;
  }
}

export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

export function assertPan(pan: string): void {
  if (!PAN_RE.test(pan)) throw new GstReturnsError("Enter a valid PAN (5 letters, 4 digits, 1 letter)", "bad_pan");
}

function assertPeriod(period: string): void {
  const m = /^(\d{2})(\d{4})$/.exec(period);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) {
    throw new GstReturnsError(`Invalid return period "${period}" (expected MMYYYY)`, "bad_period");
  }
}

/** Depth-first search for `key` in the response envelope (data / data.data / …). */
function findKey(v: unknown, key: string, depth = 0): unknown {
  if (!v || typeof v !== "object" || depth > 5) return undefined;
  const o = v as Record<string, unknown>;
  if (key in o) return o[key];
  for (const child of Object.values(o)) {
    const found = findKey(child, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findAllKeys(v: unknown, key: string, depth = 0, out: unknown[] = []): unknown[] {
  if (!v || typeof v !== "object" || depth > 5) return out;
  for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
    if (k === key) out.push(child);
    else findAllKeys(child, key, depth + 1, out);
  }
  return out;
}

/** `reference_id` (VERIFY the exact key) from the response envelope. */
function requireReference(d: GstnData, what: string): string {
  const ref = findKey(d, "reference_id");
  if (ref == null || ref === "") {
    throw new GstReturnsError(`GST ${what} returned no reference_id`, "no_reference");
  }
  return String(ref);
}

function filingResult(d: GstnData): FilingResult {
  const ref = findKey(d, "reference_id") ?? findKey(d, "ack_num") ?? findKey(d, "arn") ?? null;
  return { referenceId: ref == null ? null : String(ref) };
}

/**
 * Interpret a GST Return Status response. VERIFY: the response shape is not
 * documented to us. Assumes the GSTN codes P (processed), PE / ER (errors),
 * IP (in progress); anything unrecognised counts as still processing, which
 * the bounded poll turns into a time-out rather than a wrong "ready".
 */
export function interpretReturnStatus(d: unknown): ReturnStatus {
  // status_cd "1" / "0" is the gateway's call-level success flag, not the return's processing status.
  const codes = findAllKeys(d, "status_cd").map((v) => String(v)).filter((v) => v !== "1" && v !== "0");
  const raw = findKey(d, "processing_status") ?? findKey(d, "return_status") ?? codes[0];
  const text = String(raw ?? "").trim().toUpperCase();
  const errors = collectErrorMessages(d);
  if (text === "PE" || text === "ER" || text === "ERROR" || text === "FAILED") {
    return { phase: "errors", errors: errors.length ? errors : ["The GST portal reported errors; check the portal for details."] };
  }
  if (text === "P" || text === "PROCESSED" || text === "COMPLETED" || text === "SUCCESS") {
    return errors.length ? { phase: "errors", errors } : { phase: "processed", errors: [] };
  }
  return { phase: "processing", errors: [] };
}

/** Portal validation messages found under `error*` keys of a response (error_msg / error_message / message). */
export function collectErrorMessages(v: unknown, out: string[] = [], inError = false, depth = 0): string[] {
  if (!v || typeof v !== "object" || depth > 8 || out.length >= 20) return out;
  for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
    const errCtx = inError || /^error/i.test(k);
    if (typeof child === "string" && errCtx && /^(error_msg|error_message|message|msg)$/i.test(k)) {
      out.push(child.slice(0, 300));
    } else if (child && typeof child === "object") {
      collectErrorMessages(child, out, errCtx, depth + 1);
    }
    if (out.length >= 20) break;
  }
  return out;
}

// ── GSTR-1 save body ─────────────────────────────────────────

export interface Gstr1SaveBody {
  fp: string;
  gstin: string;
  gt: number;
  cur_gt: number;
  [section: string]: unknown;
}

const GSTR1_ARRAY_SECTIONS = ["b2b", "b2ba", "b2cl", "b2cla", "cdnr", "cdnra", "b2cs", "b2csa", "exp", "expa", "txpd", "txpda", "at", "ata", "cdnur", "cdnura"] as const;

/**
 * Full save body per the recipe: fp, gstin, gt, cur_gt and every section key.
 * Sections the app has no data for are sent empty (arrays; hsn / nil /
 * doc_issue as objects with empty lists, shapes VERIFY). `fp` is the return
 * period MMYYYY; the recipe's example mixes URL 2023/12 with fp 112023 (VERIFY).
 */
export function gstr1SaveBody(
  report: GSTR1Report,
  gstin: string,
  period: string,
  turnover: { gt: number; curGt: number },
): Gstr1SaveBody {
  const mapped = gstr1ToSections(report, gstin, period) as Record<string, unknown>;
  const body: Gstr1SaveBody = { fp: period, gstin, gt: turnover.gt, cur_gt: turnover.curGt };
  for (const s of GSTR1_ARRAY_SECTIONS) body[s] = mapped[s] ?? [];
  body.hsn = mapped.hsn ?? { data: [] };
  body.nil = mapped.nil ?? { inv: [] };
  body.doc_issue = { doc_det: [] };
  return body;
}

// ── Mappers: app report -> GSTN JSON ─────────────────────────

/** "2026-08" (app period) -> "082026" (GSTN). */
export function toGstnPeriod(ym: string): string {
  const [y, m] = ym.split("-");
  return `${m}${y}`;
}

export const GSTR1_SAVE_SECTIONS = ["b2b", "b2cl", "b2cs", "nil", "cdnr", "cdnur", "hsn"] as const;
export type Gstr1Section = (typeof GSTR1_SAVE_SECTIONS)[number];

/**
 * Split the app's GSTR-1 report into per-section GSTN payloads, reusing the
 * portal-JSON builder (same output as the offline-tool export). Empty sections
 * are dropped. doc_issue / exp / at / txpd are not produced: the app does not
 * hold faithful data for them.
 */
export function gstr1ToSections(
  report: GSTR1Report,
  gstin: string,
  period: string,
): Partial<Record<Gstr1Section, unknown>> {
  const json = gstr1ToPortalJson(report, gstin, "", period) as Record<string, unknown>;
  const out: Partial<Record<Gstr1Section, unknown>> = {};
  for (const s of GSTR1_SAVE_SECTIONS) {
    const v = json[s];
    if (v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (s === "hsn" && Array.isArray((v as { data?: unknown[] }).data) && (v as { data: unknown[] }).data.length === 0) continue;
    out[s] = v;
  }
  return out;
}

const r2 = (n: number | string) => Math.round(Number(n) * 100) / 100;

/**
 * GSTR-3B: 3.1(a) outward taxable, 3.1(b) zero-rated, 3.1(c) nil/exempt,
 * 3.1(d) inward RCM, and 4(A)(5) "all other ITC" with the matching net ITC.
 * Everything else is left out (see the file header) so the user completes it
 * on the portal rather than us guessing.
 */
export function gstr3bToGstn(report: GSTR3BReport, gstin: string, period: string): Record<string, unknown> {
  const o = report.outwardSupplies;
  return {
    gstin,
    ret_period: period,
    sup_details: {
      osup_det: { txval: r2(o.taxable.taxableValue), iamt: r2(o.taxable.igst), camt: r2(o.taxable.cgst), samt: r2(o.taxable.sgst), csamt: 0 },
      osup_zero: { txval: r2(o.zeroRated.taxableValue), iamt: r2(o.zeroRated.igst), csamt: 0 },
      osup_nil_exmp: { txval: r2(o.exempt.taxableValue) },
      isup_rev: {
        txval: r2(report.rcmSupplies.taxableValue),
        iamt: r2(report.rcmSupplies.igst),
        camt: r2(report.rcmSupplies.cgst),
        samt: r2(report.rcmSupplies.sgst),
        csamt: 0,
      },
    },
    itc_elg: {
      itc_avl: [{ ty: "OTH", iamt: r2(report.itc.igst), camt: r2(report.itc.cgst), samt: r2(report.itc.sgst), csamt: 0 }],
      itc_net: { iamt: r2(report.itc.igst), camt: r2(report.itc.cgst), samt: r2(report.itc.sgst), csamt: 0 },
    },
  };
}
