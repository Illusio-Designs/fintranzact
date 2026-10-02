/**
 * sandbox/gst-returns.ts — GSTR-1 / GSTR-3B filing and GSTR-2B download through
 * Sandbox.co.in.
 *
 * SESSION MODEL
 *   GST return APIs need a taxpayer session, not just the deployment's API
 *   token. The taxpayer's GST-portal username + GSTIN request an OTP (sent by
 *   the GST portal to the registered mobile); the OTP is exchanged for a
 *   session token valid ~6 h. The token is cached in memory only (never
 *   persisted) and keyed by GSTIN. A restart simply means "ask for an OTP again".
 *
 *   Filing itself needs a second OTP: the EVC OTP, sent to the authorised
 *   signatory's registered mobile, plus the signatory's PAN.
 *
 * !! VERIFY AGAINST test-api.sandbox.co.in BEFORE GO-LIVE !!
 *   The endpoint paths and the request/response shapes below were written from
 *   memory of Sandbox.co.in's "GST Returns" API; the docs site could not be
 *   reached when this was written. All paths live in GST_RETURNS_PATHS, and
 *   response handling is concentrated in `unwrap()` / `sessionFrom()`, so
 *   corrections stay in this one file.
 *
 *   NOT MAPPED (left out rather than guessed, see mapper below):
 *     GSTR-1: doc_issue (document series summary), exp (exports), at/txpd
 *             (advances), b2cl is mapped but ecom/supeco are not.
 *     GSTR-3B: 3.2 inter-state to unregistered/composition/UIN, ITC split by
 *              import / RCM / ISD, ITC reversal and ineligible ITC, interest
 *              and late fee, tax payment (cash vs credit ledger).
 */

import { logger } from "../logger.js";
import {
  gstr1ToPortalJson,
  type GSTR1Report,
  type GSTR3BReport,
} from "../gst-reports.js";
import { SandboxClient, SandboxError } from "./client.js";

// ── Endpoint paths (VERIFY against test-api.sandbox.co.in before go-live) ──

const GSTR_BASE = "/gst/compliance/tax-payer";

/** "MMYYYY" -> { month: "MM", year: "YYYY" } path segments. */
function seg(period: string): { year: string; month: string } {
  return { year: period.slice(2), month: period.slice(0, 2) };
}

export const GST_RETURNS_PATHS = {
  /** POST body { username, gstin } -> OTP to registered mobile. VERIFY. */
  requestOtp: () => `${GSTR_BASE}/otp`,
  /** POST ?otp=… body { username, gstin } -> session token. VERIFY. */
  verifyOtp: () => `${GSTR_BASE}/otp/verify`,
  /** PUT one GSTR-1 section (b2b, b2cs, …). VERIFY. */
  gstr1Save: (period: string, section: string) => {
    const { year, month } = seg(period);
    return `${GSTR_BASE}/gstrs/gstr-1/${year}/${month}/${section}`;
  },
  /** GET GSTR-1 summary. VERIFY. */
  gstr1Summary: (period: string) => {
    const { year, month } = seg(period);
    return `${GSTR_BASE}/gstrs/gstr-1/${year}/${month}/summary`;
  },
  /** POST file with EVC. VERIFY. */
  gstr1File: (period: string) => {
    const { year, month } = seg(period);
    return `${GSTR_BASE}/gstrs/gstr-1/${year}/${month}/file`;
  },
  /** PUT GSTR-3B draft. VERIFY. */
  gstr3bSave: (period: string) => {
    const { year, month } = seg(period);
    return `${GSTR_BASE}/gstrs/gstr-3b/${year}/${month}`;
  },
  /** POST file with EVC. VERIFY. */
  gstr3bFile: (period: string) => {
    const { year, month } = seg(period);
    return `${GSTR_BASE}/gstrs/gstr-3b/${year}/${month}/file`;
  },
  /** GET auto-drafted GSTR-2B. VERIFY. */
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
}

export interface FilingResult {
  /** Acknowledgement / reference number from the portal, when returned. */
  referenceId: string | null;
  raw: unknown;
}

export class SandboxGstReturnsClient {
  private readonly now: () => number;
  private readonly sessions: Map<string, Session>;

  constructor(
    private readonly sandbox: SandboxClient,
    private readonly config: GstReturnsConfig,
    opts: GstReturnsOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.sessions = opts.sessions ?? sharedSessions;
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
      });
      unwrap(res.data, "OTP request", res.transaction_id);
    } catch (err) {
      throw toError(err, "OTP request");
    }
  }

  /** Exchange the OTP for a taxpayer session (kept in memory for ~6 h). */
  async verifyOtp(otp: string): Promise<void> {
    try {
      const res = await this.sandbox.request<GstnData>("POST", GST_RETURNS_PATHS.verifyOtp(), {
        query: { otp },
        body: { username: this.config.username, gstin: this.config.gstin },
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
  ): Promise<T> {
    try {
      const res = await this.sandbox.request<T>(method, path, { ...opts, authToken: this.token() });
      return unwrap(res.data as GstnData, what, res.transaction_id) as T;
    } catch (err) {
      const e = toError(err, what);
      if (isSessionError(e)) this.clearSession();
      throw e;
    }
  }

  // ── GSTR-1 ─────────────────────────────────────────────────

  /** Save one GSTR-1 section (e.g. "b2b") for a period "MMYYYY". */
  async saveGstr1Section(period: string, section: string, payload: unknown): Promise<void> {
    assertPeriod(period);
    await this.call(`GSTR-1 ${section} save`, "PUT", GST_RETURNS_PATHS.gstr1Save(period, section), {
      body: { gstin: this.config.gstin, fp: period, [section]: payload },
    });
  }

  async getGstr1Summary(period: string): Promise<unknown> {
    assertPeriod(period);
    const d = await this.call("GSTR-1 summary", "GET", GST_RETURNS_PATHS.gstr1Summary(period));
    return d.data ?? d;
  }

  async fileGstr1(period: string, evcOtp: string, pan: string): Promise<FilingResult> {
    assertPeriod(period);
    const d = await this.call("GSTR-1 filing", "POST", GST_RETURNS_PATHS.gstr1File(period), {
      query: { otp: evcOtp, pan },
      body: { gstin: this.config.gstin, fp: period },
    });
    return filingResult(d);
  }

  // ── GSTR-3B ────────────────────────────────────────────────

  async saveGstr3b(period: string, payload: unknown): Promise<void> {
    assertPeriod(period);
    await this.call("GSTR-3B save", "PUT", GST_RETURNS_PATHS.gstr3bSave(period), { body: payload });
  }

  async fileGstr3b(period: string, evcOtp: string, pan: string): Promise<FilingResult> {
    assertPeriod(period);
    const d = await this.call("GSTR-3B filing", "POST", GST_RETURNS_PATHS.gstr3bFile(period), {
      query: { otp: evcOtp, pan },
      body: { gstin: this.config.gstin, ret_period: period },
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

function assertPeriod(period: string): void {
  const m = /^(\d{2})(\d{4})$/.exec(period);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) {
    throw new GstReturnsError(`Invalid return period "${period}" (expected MMYYYY)`, "bad_period");
  }
}

function filingResult(d: GstnData): FilingResult {
  const inner = (d.data && typeof d.data === "object" ? d.data : d) as Record<string, unknown>;
  const ref = inner.reference_id ?? inner.ack_num ?? inner.arn ?? null;
  return { referenceId: ref == null ? null : String(ref), raw: d };
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
