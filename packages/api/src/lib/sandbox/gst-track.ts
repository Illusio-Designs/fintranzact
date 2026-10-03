/**
 * sandbox/gst-track.ts — "Track GST Returns": which returns a GSTIN has filed.
 *
 * PUBLIC endpoint: needs only the platform's Sandbox access token (the
 * deployment's API token), NOT the 6-hour taxpayer session.
 *
 *   POST /gst/compliance/public/gstrs/track?financial_year=FY 2025-26[&gstr=gstr-1]
 *   headers: authorization (JWT access token), x-api-key, x-api-version 1.0.0,
 *            optional x-accept-cache: true
 *   body: { "gstin": "..." }
 *   200: { code, data: { data: { EFiledlist: [ { arn, dof, mof, ret_prd, rtntype, status, valid } ] }, status_cd: "1" } }
 *   Errors come as HTTP 200 with data: { error: { error_code, message }, status_cd: "0" }:
 *     RTN_22     "Please select a valid financial year"
 *     RET13510   "No Record found for the provided Inputs" -> nothing filed yet, NOT a failure
 *   Invalid GSTIN pattern: HTTP 422 { code: 422, message: "Invalid GSTIN pattern" }.
 *   The list arrives unordered: callers sort by period.
 *
 * VERIFY with Sandbox: accepted `gstr` values, the exact `rtntype` strings
 * (GSTR1, GSTR3B, ...), how quarterly (QRMP) filings appear in `ret_prd`, and
 * the per-call charge.
 */

import { SandboxClient, SandboxError } from "./client.js";

export const TRACK_PATH = "/gst/compliance/public/gstrs/track";

export class TrackError extends Error {
  constructor(message: string, public readonly code: string, public readonly retryable = false) {
    super(message);
    this.name = "TrackError";
  }
}

export interface TrackedReturn {
  arn: string | null;
  /** Date of filing as ISO "YYYY-MM-DD" (the API sends DD-MM-YYYY), null when absent. */
  filedOn: string | null;
  /** Mode of filing, e.g. "GSP". */
  mode: string | null;
  /** Return period "MMYYYY". */
  period: string;
  /** Normalised return type: "gstr1", "gstr3b", "gstr9", ... (VERIFY the raw strings). */
  returnType: string;
  /** The raw `rtntype` as sent. */
  rawType: string;
  /** Raw status text, e.g. "Filed". */
  status: string;
  filed: boolean;
  /** `valid` flag: true "Y", false "N", null when absent. */
  valid: boolean | null;
}

/** "GSTR1" / "GSTR-1" / "gstr 3b" -> "gstr1" / "gstr1" / "gstr3b". */
export function normalizeReturnType(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** "DD-MM-YYYY" -> "YYYY-MM-DD" (null when it does not look like a date). */
function isoFromDof(dof: unknown): string | null {
  const m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(String(dof ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

interface TrackEnvelopeData {
  status_cd?: string | number;
  data?: { EFiledlist?: Array<Record<string, unknown>> };
  error?: { error_code?: string; message?: string };
}

/** Parse the documented success body; unknown rows without a period are skipped. */
export function parseTrackList(list: Array<Record<string, unknown>> | undefined): TrackedReturn[] {
  const out: TrackedReturn[] = [];
  for (const r of list ?? []) {
    const period = String(r.ret_prd ?? "").trim();
    if (!/^\d{6}$/.test(period)) continue;
    const rawType = String(r.rtntype ?? "");
    const status = String(r.status ?? "");
    const valid = r.valid === "Y" ? true : r.valid === "N" ? false : null;
    out.push({
      arn: r.arn == null ? null : String(r.arn),
      filedOn: isoFromDof(r.dof),
      mode: r.mof == null ? null : String(r.mof),
      period,
      returnType: normalizeReturnType(rawType),
      rawType,
      status,
      filed: status.trim().toLowerCase() === "filed",
      valid,
    });
  }
  // Unordered on arrival: sort by year then month, then type.
  return out.sort((a, b) => a.period.slice(2).localeCompare(b.period.slice(2)) || a.period.slice(0, 2).localeCompare(b.period.slice(0, 2)) || a.returnType.localeCompare(b.returnType));
}

/**
 * Track the filed returns of `gstin` for a financial year ("FY 2025-26").
 * `cache: true` sends x-accept-cache (fine for display; never for the
 * pre-filing prerequisite check). Throws TrackError; the resolver in
 * gst-track-resolver.ts turns every failure into an "unavailable" result.
 */
export async function trackGstReturns(
  sandbox: SandboxClient,
  gstin: string,
  financialYear: string,
  opts: { gstr?: string; cache?: boolean } = {},
): Promise<TrackedReturn[]> {
  let data: TrackEnvelopeData | undefined;
  try {
    const res = await sandbox.request<TrackEnvelopeData>("POST", TRACK_PATH, {
      query: { financial_year: financialYear, gstr: opts.gstr },
      body: { gstin },
      headers: { "x-api-version": "1.0.0", ...(opts.cache ? { "x-accept-cache": "true" } : {}) },
    });
    data = res.data;
  } catch (err) {
    if (err instanceof SandboxError) {
      if (err.httpStatus === 422) throw new TrackError("The GSTIN pattern is invalid.", "bad_gstin");
      throw new TrackError(`Could not reach the GST return tracker: ${err.message}`, err.code, err.isRetryable);
    }
    throw err;
  }
  const code = data?.error?.error_code;
  if (code === "RET13510") return []; // "No Record found": nothing filed yet
  if (code === "RTN_22") throw new TrackError("The financial year was not accepted by the GST portal.", "invalid_fy");
  if (data?.error || String(data?.status_cd) === "0") {
    throw new TrackError(data?.error?.message ?? "The GST return tracker reported an error.", code ?? "portal");
  }
  return parseTrackList(data?.data?.EFiledlist);
}
