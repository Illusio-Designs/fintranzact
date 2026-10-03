/**
 * sandbox/gstin.ts — public GSTIN search through Sandbox.co.in.
 *
 *   POST /gst/compliance/public/gstin/search      body { "gstin": "29AFSPB9500E1ZY" }
 *   headers: authorization (the platform API access token, NOT a taxpayer
 *   session), x-api-key, x-api-version (optional), x-accept-cache: true
 *   (optional: accept a cached answer; omit or false to hit the origin).
 *
 * Success: { code: 200, data: { data: { gstin, lgnm, tradeNam, sts, dty, ctb,
 *   rgdt, cxdt, lstupdt, einvoiceStatus, nba[], pradr{addr,ntr}, adadr[] ... },
 *   status_cd: "1" }, transaction_id }.
 * No record: HTTP 200, data: { error: { error_cd: "FO8000", message }, status_cd: "0" }.
 * Bad pattern: HTTP 422 { code: 422, message: "Invalid GSTIN pattern" }.
 *
 * The GSTIN is checked locally first (pattern and, against the live host,
 * the check digit) so garbage never spends a call. Successful calls are
 * counted by the client meter against the plan like HSN lookups; they are NOT
 * billed to customers and write no gov_api_usage row.
 *
 * Response handling is concentrated in `normaliseGstin()`; anything inferred
 * rather than read is listed in `GstinProfile.inferred` and in
 * docs/SANDBOX-INTEGRATION.md (VERIFY list).
 */

import {
  stateCodeFromStateName,
  stateNameFromCode,
  validateGstin,
  type GstinAddress,
  type GstinProfile,
  type GstinProfileStatus,
} from "@fintranzact/shared";
import { SandboxClient, SandboxError } from "./client.js";

export const GSTIN_API_PATHS = {
  search: "/gst/compliance/public/gstin/search",
} as const;

export type GstinErrorKind = "invalid" | "auth" | "rate_limited" | "timeout" | "unavailable" | "malformed";

export class GstinLookupError extends Error {
  constructor(
    message: string,
    public readonly kind: GstinErrorKind,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "GstinLookupError";
  }
}

function toError(err: unknown): GstinLookupError {
  if (err instanceof GstinLookupError) return err;
  if (err instanceof SandboxError) {
    // Only the status and code are kept; the gateway message is not passed on.
    const s = err.httpStatus;
    if (err.code === "timeout") return new GstinLookupError("Sandbox GSTIN search timed out", "timeout");
    if (s === 422) return new GstinLookupError("Sandbox rejected the GSTIN pattern", "invalid", s);
    if (s === 401 || s === 403 || err.code === "auth") return new GstinLookupError("Sandbox rejected the credentials", "auth", s);
    if (s === 429) return new GstinLookupError("Sandbox rate limit reached", "rate_limited", s);
    return new GstinLookupError(s === undefined ? "Sandbox is unreachable" : "Sandbox is unavailable", "unavailable", s);
  }
  return new GstinLookupError("Sandbox GSTIN search failed", "unavailable");
}

// ── Response mapping ─────────────────────────────────────────

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
};
/** The portal prints "NA" / "N/A" for fields that do not apply. */
const clean = (v: unknown): string => {
  const s = str(v);
  return /^(na|n\/a|null|-)$/i.test(s) ? "" : s;
};

/** DD/MM/YYYY (or ISO) -> YYYY-MM-DD; "" and anything else -> null. */
function parseDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

/** VERIFY: exact `sts` strings. */
function statusOf(sts: string): GstinProfileStatus {
  const t = sts.toLowerCase();
  if (t === "active") return "active";
  if (t.startsWith("cancel")) return "cancelled";
  if (t.startsWith("suspend")) return "suspended";
  if (t.startsWith("provisional")) return "provisional";
  return "other";
}

function normaliseAddress(raw: unknown, gstin: string, inferred: Set<string>, label: string): GstinAddress | null {
  const wrap = isObj(raw) ? raw : null;
  const a = wrap && isObj(wrap.addr) ? wrap.addr : wrap;
  if (!a) return null;
  const line1 = [a.flno, a.bno, a.bnm].map(clean).filter(Boolean).join(", ");
  const line2 = [a.st, a.landMark].map(clean).filter(Boolean).join(", ");
  const district = clean(a.dst);
  // VERIFY: which of loc / locality is the town. Prefer loc, then locality, then the district.
  const city = clean(a.loc) || clean(a.locality) || district;
  if (!clean(a.loc) && clean(a.locality)) inferred.add(`${label}.city`);
  else if (!clean(a.loc) && !clean(a.locality) && district) inferred.add(`${label}.city`);
  const portalState = clean(a.stcd);
  const nameCode = stateCodeFromStateName(portalState);
  let stateCode = "";
  let stateMismatch = false;
  if (label === "principalAddress") {
    // The GSTIN's own state digits win; a portal address in another state is flagged.
    const gstinCode = stateNameFromCode(gstin.slice(0, 2)) ? gstin.slice(0, 2) : "";
    stateCode = gstinCode || nameCode || "";
    if (!gstinCode && nameCode) inferred.add(`${label}.stateCode`);
    stateMismatch = !!gstinCode && !!nameCode && gstinCode !== nameCode;
  } else {
    // An additional place of business can sit in any state: take the portal's name.
    stateCode = nameCode ?? "";
    if (nameCode) inferred.add(`${label}.stateCode`);
  }
  const state = stateNameFromCode(stateCode) ?? portalState;
  const out: GstinAddress = {
    line1,
    line2,
    city,
    district,
    state,
    stateCode,
    pincode: clean(a.pncd),
    ...(stateMismatch ? { stateMismatch: true } : {}),
  };
  if (!out.line1 && !out.line2 && !out.city && !out.pincode && !out.state) return null;
  return out;
}

/**
 * The record inside `envelope.data` -> GstinProfile, or null for "no record".
 * Throws GstinLookupError("malformed") when the shape is unrecognisable.
 */
export function normaliseGstin(data: unknown, gstin: string, tx?: string): GstinProfile | null {
  if (!isObj(data)) throw new GstinLookupError("Sandbox returned an unreadable GSTIN answer", "malformed");
  const statusCd = str(data.status_cd);
  const err = isObj(data.error) ? data.error : null;
  if (err || statusCd === "0") {
    const code = str(err?.error_cd);
    const message = str(err?.message);
    if (code === "FO8000" || /no records? found|not found/i.test(message) || (!err && statusCd === "0")) return null;
    // Any other portal-level error is a failure of the lookup, not a verdict on the GSTIN.
    throw new GstinLookupError("Sandbox could not search the GST portal", "unavailable");
  }
  const rec = data.data;
  if (!isObj(rec)) throw new GstinLookupError("Sandbox returned an unreadable GSTIN answer", "malformed");

  const inferred = new Set<string>();
  const statusRaw = str(rec.sts);
  const principal = isObj(rec.pradr) ? normaliseAddress(rec.pradr, gstin, inferred, "principalAddress") : null;
  const additional = (Array.isArray(rec.adadr) ? rec.adadr : [])
    .map((x) => normaliseAddress(x, gstin, inferred, "additionalAddresses"))
    .filter((x): x is GstinAddress => x !== null);
  const einv = str(rec.einvoiceStatus).toLowerCase();
  const nba = (Array.isArray(rec.nba) ? rec.nba : [])
    .map(str)
    .filter(Boolean);
  const principalNature = isObj(rec.pradr) ? str(rec.pradr.ntr) : "";
  if (!nba.length && principalNature) {
    nba.push(...principalNature.split(",").map((s) => s.trim()).filter(Boolean));
    inferred.add("natureOfBusiness");
  }

  return {
    gstin: str(rec.gstin).toUpperCase() || gstin,
    legalName: clean(rec.lgnm),
    tradeName: clean(rec.tradeNam),
    status: statusOf(statusRaw),
    statusRaw,
    taxpayerType: clean(rec.dty),
    constitution: clean(rec.ctb),
    registeredOn: parseDate(rec.rgdt),
    cancelledOn: parseDate(rec.cxdt),
    lastUpdatedOn: parseDate(rec.lstupdt),
    eInvoiceEnabled: einv === "yes" ? true : einv === "no" ? false : null,
    natureOfBusiness: nba,
    principalAddress: principal,
    additionalAddresses: additional,
    source: "sandbox",
    transactionId: tx,
    inferred: [...inferred].sort(),
  };
}

// ── Client ───────────────────────────────────────────────────

export interface GstinLookupOptions {
  timeoutMs?: number;
  /** Send x-accept-cache: true so Sandbox may answer from its own cache. */
  acceptCache?: boolean;
}

export interface GstinLookupClient {
  /** Whether the check digit is enforced locally (live host). Absent = enforced. */
  readonly strictChecksum?: boolean;
  /**
   * Search one GSTIN. Null when Sandbox has no record. Throws GstinLookupError
   * ("invalid" for a bad pattern, no call made) for everything else that fails.
   */
  lookupGstin(gstin: string, opts?: GstinLookupOptions): Promise<GstinProfile | null>;
}

export class SandboxGstinClient implements GstinLookupClient {
  constructor(private readonly sandbox: SandboxClient) {}

  /** The documented reference GSTINs of the test host carry wrong check digits, so only the live host enforces it. */
  get strictChecksum(): boolean {
    return this.sandbox.isLive;
  }

  async lookupGstin(raw: string, opts: GstinLookupOptions = {}): Promise<GstinProfile | null> {
    const v = validateGstin(raw, { strictChecksum: this.strictChecksum });
    if (!v.valid) throw new GstinLookupError("Not a valid GSTIN", "invalid");
    let res;
    try {
      res = await this.sandbox.request<unknown>("POST", GSTIN_API_PATHS.search, {
        body: { gstin: v.gstin },
        headers: opts.acceptCache ? { "x-accept-cache": "true" } : undefined,
        timeoutMs: opts.timeoutMs,
      });
    } catch (err) {
      throw toError(err);
    }
    if (!res || typeof res !== "object") throw new GstinLookupError("Sandbox returned an unreadable GSTIN answer", "malformed");
    return normaliseGstin(res.data, v.gstin, res.transaction_id);
  }
}
