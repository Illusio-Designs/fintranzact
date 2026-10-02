/**
 * sandbox/tds.ts — PAN and TAN lookups through Sandbox.co.in.
 *
 * !! VERIFY AGAINST test-api.sandbox.co.in BEFORE GO-LIVE !!
 *   The endpoint paths, request bodies and response field names below were
 *   written from memory; the Sandbox docs site could not be reached. Paths live
 *   in TDS_API_PATHS and response handling is concentrated in
 *   `unwrapPan()` / `unwrapTan()`, so corrections stay in this one file.
 *   These are plain API-token calls (no taxpayer session); they count against
 *   the Sandbox plan through the client meter and are not billed to customers.
 *
 * TODO (deliberately NOT implemented; too uncertain to write blind):
 *   - e-filing of 24Q/26Q/27Q/27EQ returns (FVU generation, CSI/challan
 *     linkage, TRACES/e-filing login or e-verification)
 *   - Form 16/16A/27D certificate download from TRACES
 *   See docs/SANDBOX-INTEGRATION.md ("TDS filing and certificates") for what
 *   is needed before these can be built. Certificates in the app today are
 *   generated from the books, not issued by TRACES.
 */

import { SandboxClient, SandboxError } from "./client.js";

// ── Endpoint paths (VERIFY against test-api.sandbox.co.in before go-live) ──

export const TDS_API_PATHS = {
  /** POST { pan, name_as_per_pan?, date_of_birth?, consent, reason } -> PAN status. VERIFY. */
  verifyPan: () => "/kyc/pan/verify",
  /** POST { tan } -> TAN holder details. VERIFY. */
  verifyTan: () => "/tds/tan/verify",
} as const;

// ── Errors ───────────────────────────────────────────────────

export class TdsApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable = false,
    public readonly transactionId?: string,
  ) {
    super(message);
    this.name = "TdsApiError";
  }
}

function toError(err: unknown, what: string): Error {
  if (err instanceof TdsApiError) return err;
  if (err instanceof SandboxError) {
    return new TdsApiError(`${what} failed: ${err.message}`, err.code, err.isRetryable, err.transactionId);
  }
  return err instanceof Error ? err : new TdsApiError(`${what} failed`, "unknown");
}

// ── Results ──────────────────────────────────────────────────

export interface PanVerification {
  pan: string;
  /** True when the PAN exists and is operative. */
  valid: boolean;
  /** Raw status text from the gateway (e.g. "valid", "invalid"), lower-cased. */
  status: string;
  /** Null when no name was supplied or the gateway did not say. */
  nameMatch: boolean | null;
  /** Null when no DOB was supplied or the gateway did not say. */
  dobMatch: boolean | null;
  transactionId?: string;
}

export interface TanVerification {
  tan: string;
  valid: boolean;
  /** Registered deductor name, when returned. */
  name: string | null;
  status: string;
  transactionId?: string;
}

// ── Response mapping (VERIFY field names) ────────────────────

type Raw = Record<string, unknown>;

const asBool = (v: unknown): boolean | null =>
  typeof v === "boolean" ? v : typeof v === "string" ? (["true", "y", "yes", "match", "matched"].includes(v.toLowerCase()) ? true : ["false", "n", "no", "mismatch"].includes(v.toLowerCase()) ? false : null) : null;

/** Response -> PanVerification. All PAN field names are concentrated here. */
function unwrapPan(data: Raw | undefined, pan: string, tx?: string): PanVerification {
  if (!data || typeof data !== "object") throw new TdsApiError("PAN verification returned no data", "empty", false, tx);
  const status = String(data.status ?? "").toLowerCase();
  return {
    pan,
    valid: status === "valid",
    status: status || "unknown",
    nameMatch: asBool(data.name_as_per_pan_match ?? data.name_match),
    dobMatch: asBool(data.date_of_birth_match ?? data.dob_match),
    transactionId: tx,
  };
}

/** Response -> TanVerification. All TAN field names are concentrated here. */
function unwrapTan(data: Raw | undefined, tan: string, tx?: string): TanVerification {
  if (!data || typeof data !== "object") throw new TdsApiError("TAN verification returned no data", "empty", false, tx);
  const status = String(data.status ?? "").toLowerCase();
  const name = data.name ?? data.deductor_name ?? data.name_of_deductor;
  return {
    tan,
    valid: status ? status === "valid" || status === "active" : typeof name === "string" && name.length > 0,
    name: typeof name === "string" && name ? name : null,
    status: status || "unknown",
    transactionId: tx,
  };
}

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;

// ── Client ───────────────────────────────────────────────────

export class SandboxTdsClient {
  constructor(private readonly sandbox: SandboxClient) {}

  /** Check a PAN; pass `name` / `dob` (DD/MM/YYYY) to also check them. A malformed PAN is `valid:false` without a call. */
  async verifyPan(pan: string, name?: string, dob?: string): Promise<PanVerification> {
    const p = pan.trim().toUpperCase();
    if (!PAN_RE.test(p)) return { pan: p, valid: false, status: "invalid_format", nameMatch: null, dobMatch: null };
    try {
      const body: Record<string, unknown> = { pan: p, consent: "Y", reason: "TDS deductee verification" };
      if (name?.trim()) body.name_as_per_pan = name.trim();
      if (dob) body.date_of_birth = dob;
      const res = await this.sandbox.request<Raw>("POST", TDS_API_PATHS.verifyPan(), { body });
      return unwrapPan(res.data, p, res.transaction_id);
    } catch (err) {
      throw toError(err, "PAN verification");
    }
  }

  async verifyTan(tan: string): Promise<TanVerification> {
    const t = tan.trim().toUpperCase();
    if (!TAN_RE.test(t)) return { tan: t, valid: false, name: null, status: "invalid_format" };
    try {
      const res = await this.sandbox.request<Raw>("POST", TDS_API_PATHS.verifyTan(), { body: { tan: t } });
      return unwrapTan(res.data, t, res.transaction_id);
    } catch (err) {
      throw toError(err, "TAN verification");
    }
  }
}
