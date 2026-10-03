/**
 * sandbox/hsn.ts — HSN / SAC code lookup through Sandbox.co.in.
 *
 * !! VERIFY AGAINST developer.sandbox.co.in BEFORE GO-LIVE !!
 *   The docs site could not be reached when this was written. The endpoint
 *   path and every response field name below are best-effort guesses, each
 *   marked `// VERIFY against Sandbox docs` and listed in
 *   docs/SANDBOX-INTEGRATION.md. Response handling is concentrated in
 *   `normaliseHsn()` so corrections stay in this file.
 *
 * Lookups use the deployment's API token only (no taxpayer session). Successful
 * calls are counted by the client meter against the Sandbox plan quota; they
 * are NOT billed to customers and write no gov_api_usage row.
 */

import { SandboxClient, SandboxError, SandboxFundingError } from "./client.js";
import { fundingFrom } from "./funding.js";

// ── Endpoint (VERIFY against Sandbox docs) ───────────────────

export const HSN_API_PATHS = {
  /** GET <path>/{code} -> HSN / SAC master entry. VERIFY against Sandbox docs */
  lookup: (code: string) => `/gst/hsn-sac/${encodeURIComponent(code)}`,
} as const;

// ── Result and errors ────────────────────────────────────────

export interface SandboxHsnResult {
  code: string;
  kind: "hsn" | "sac";
  description: string;
  /** GST rate in percent, when Sandbox returns one. */
  rate?: number | null;
  /** ISO date (YYYY-MM-DD). */
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  /** False for a withdrawn / inactive / expired code. */
  active: boolean;
  /** Why the code is inactive, when Sandbox says. */
  inactiveReason?: string | null;
  source: "sandbox";
  transactionId?: string;
}

export type HsnErrorKind = "auth" | "rate_limited" | "timeout" | "unavailable" | "malformed" | "rejected";

export class HsnLookupError extends Error {
  constructor(
    message: string,
    public readonly kind: HsnErrorKind,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "HsnLookupError";
  }
}

function toError(err: unknown): HsnLookupError {
  if (err instanceof HsnLookupError) return err;
  if (err instanceof SandboxFundingError) {
    // Our wallet is empty: callers fall back to the bundled list exactly as for an outage.
    return fundingFrom(new HsnLookupError("Sandbox is unavailable", "unavailable", err.httpStatus), err);
  }
  if (err instanceof SandboxError) {
    // Only the status and code are kept; the gateway message is not passed on.
    const s = err.httpStatus;
    if (err.code === "timeout") return new HsnLookupError("Sandbox HSN lookup timed out", "timeout");
    if (s === 401 || s === 403 || err.code === "auth") return new HsnLookupError("Sandbox rejected the credentials", "auth", s);
    if (s === 429) return new HsnLookupError("Sandbox rate limit reached", "rate_limited", s);
    if (s === undefined || s >= 500) return new HsnLookupError("Sandbox is unavailable", "unavailable", s);
    return new HsnLookupError(`Sandbox rejected the HSN lookup (HTTP ${s})`, "rejected", s);
  }
  return new HsnLookupError("Sandbox HSN lookup failed", "unavailable");
}

// ── Response mapping (VERIFY field names) ────────────────────

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const pick = (o: Raw, keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
};

/** "18", 18, "18%", "IGST 18.0%" -> 18; anything else -> null. */
function parseRate(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const m = v.match(/-?\d+(?:\.\d+)?/);
    if (m) return Number(m[0]);
  }
  return null;
}

/** ISO or DD/MM/YYYY (or DD-MM-YYYY) -> YYYY-MM-DD; otherwise null. */
function parseDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

const INACTIVE_WORDS = /withdrawn|inactive|expired|cancel|obsolete|deleted|omitted|discontinued/i;

/** One raw entry -> SandboxHsnResult. All HSN field names are concentrated here. */
function normaliseHsn(raw: Raw, code: string, nowMs: number, tx?: string): SandboxHsnResult | null {
  // VERIFY against Sandbox docs: code field name(s)
  const returned = str(pick(raw, ["hsn_code", "sac_code", "code", "hsn", "sac", "hsn_sac"]));
  if (returned && returned !== code) return null;
  // VERIFY against Sandbox docs: description field name(s)
  const description = str(pick(raw, ["description", "desc", "description_of_goods", "description_of_service", "name"])) ?? "";
  // VERIFY against Sandbox docs: type field (HSN/SAC or goods/services)
  const typeText = str(pick(raw, ["type", "kind", "category"]))?.toLowerCase();
  const kind: "hsn" | "sac" = typeText
    ? typeText.includes("sac") || typeText.includes("service") ? "sac" : "hsn"
    : code.startsWith("99") ? "sac" : "hsn";
  // VERIFY against Sandbox docs: GST rate field name(s)
  const rate = parseRate(pick(raw, ["gst_rate", "rate", "igst_rate", "igst", "tax_rate"]));
  // VERIFY against Sandbox docs: effective-date field names
  const effectiveFrom = parseDate(pick(raw, ["effective_from", "effective_date", "from_date", "start_date"]));
  const effectiveTo = parseDate(pick(raw, ["effective_to", "valid_till", "to_date", "end_date"]));

  // VERIFY against Sandbox docs: status / active flag and reason fields
  let active = true;
  let reason = str(pick(raw, ["reason", "remarks", "withdrawn_reason", "inactive_reason"]));
  const flag = pick(raw, ["active", "is_active"]);
  const status = str(pick(raw, ["status"]));
  if (typeof flag === "boolean") active = flag;
  else if (typeof flag === "string" && /^(false|n|no|0)$/i.test(flag.trim())) active = false;
  else if (status && INACTIVE_WORDS.test(status)) {
    active = false;
    reason = reason ?? status;
  }
  if (raw.withdrawn === true) active = false;
  if (active && effectiveTo && Date.parse(`${effectiveTo}T23:59:59+05:30`) < nowMs) {
    active = false;
    reason = reason ?? `Effective until ${effectiveTo}`;
  }

  return {
    code,
    kind,
    description,
    rate,
    effectiveFrom,
    effectiveTo,
    active,
    ...(active ? {} : { inactiveReason: reason }),
    source: "sandbox",
    transactionId: tx,
  };
}

/** The entry for `code` inside whatever `data` holds (object, or list of matches). */
function entryFor(data: unknown, code: string, nowMs: number, tx?: string): SandboxHsnResult | null {
  if (Array.isArray(data)) {
    for (const row of data) {
      if (row && typeof row === "object") {
        const hit = normaliseHsn(row as Raw, code, nowMs, tx);
        if (hit) return hit;
      }
    }
    return null;
  }
  if (data && typeof data === "object") {
    const o = data as Raw;
    // VERIFY against Sandbox docs: the entry may sit under data.hsn / data.result
    const inner = o.hsn ?? o.sac ?? o.result ?? o.details;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) return normaliseHsn(inner as Raw, code, nowMs, tx);
    if (Array.isArray(inner)) return entryFor(inner, code, nowMs, tx);
    if (Object.keys(o).length === 0) return null;
    return normaliseHsn(o, code, nowMs, tx);
  }
  return null;
}

export const HSN_CODE_RE = /^\d{2,8}$/;

// ── Client ───────────────────────────────────────────────────

export interface HsnLookupClient {
  lookupHsn(code: string, opts?: { timeoutMs?: number }): Promise<SandboxHsnResult | null>;
}

export class SandboxHsnClient implements HsnLookupClient {
  constructor(
    private readonly sandbox: SandboxClient,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Look up an HSN or SAC code (2 to 8 digits). Returns null when Sandbox does
   * not know the code (HTTP 404 or an empty answer); throws HsnLookupError for
   * outages, credential problems, rate limits and unreadable answers.
   */
  async lookupHsn(code: string, opts: { timeoutMs?: number } = {}): Promise<SandboxHsnResult | null> {
    const c = code.trim();
    if (!HSN_CODE_RE.test(c)) throw new HsnLookupError("HSN / SAC code must be 2 to 8 digits", "rejected");
    let res;
    try {
      res = await this.sandbox.request<unknown>("GET", HSN_API_PATHS.lookup(c), { timeoutMs: opts.timeoutMs });
    } catch (err) {
      if (err instanceof SandboxError && err.httpStatus === 404) return null;
      throw toError(err);
    }
    if (!res || typeof res !== "object") throw new HsnLookupError("Sandbox returned an unreadable HSN answer", "malformed");
    return entryFor(res.data, c, this.now(), res.transaction_id);
  }
}
