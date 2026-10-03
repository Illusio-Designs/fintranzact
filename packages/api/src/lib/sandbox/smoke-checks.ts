/**
 * sandbox/smoke-checks.ts — the registry of read-only checks for `pnpm sandbox:smoke`.
 *
 * To cover a new adapter (e-invoice, e-way bill, GST returns, ...), add a
 * SmokeCheck with registerCheck(). Keep every check read-only: anything that
 * generates, files, saves or cancels belongs in MANUAL_CHECKLIST (smoke.ts).
 *
 * Checks for adapters that exist on main (auth, HSN, PAN, TAN) call the real
 * SandboxClient so auth, headers and timeouts match production. The GSTIN
 * search and Track GST Returns checks use ctx.raw() because their typed
 * adapter is being built on another branch.
 * TODO: switch gstin-search-* and gst-track-* to that adapter once it lands.
 */

import { SandboxClient, SandboxError, SandboxFundingError } from "./client.js";
import { HSN_API_PATHS } from "./hsn.js";
import { TDS_API_PATHS } from "./tds.js";
import { isWalletOrQuotaError } from "./funding.js";
import {
  diffShape,
  getPath,
  type CheckOutcome,
  type RawCallResult,
  type ShapeExpectation,
  type SmokeCheck,
  type SmokeContext,
} from "./smoke.js";

// ── Context ──────────────────────────────────────────────────

export function createSmokeContext(opts: {
  client: SandboxClient;
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}): SmokeContext {
  const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = opts.now ?? Date.now;
  const apiVersion = opts.apiVersion ?? "1.0.0";
  const timeoutMs = opts.timeoutMs ?? 20_000;

  async function call(method: string, path: string, headers: Record<string, string>, query?: Record<string, string>, body?: unknown): Promise<RawCallResult> {
    const url = new URL(opts.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const h: Record<string, string> = { accept: "application/json", "x-api-key": opts.apiKey, "x-api-version": apiVersion, ...headers };
    if (body !== undefined) h["content-type"] = "application/json";
    const t0 = now();
    try {
      const res = await fetchImpl(url, {
        method,
        headers: h,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let json: unknown = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = text;
        }
      }
      const message = isObj(json) && typeof json.message === "string" ? json.message : "";
      return { status: res.status, json, durationMs: now() - t0, funding: !res.ok && isWalletOrQuotaError(res.status, message) };
    } catch (err) {
      return { json: null, durationMs: now() - t0, error: err instanceof Error ? err.name === "TimeoutError" ? "timeout" : "network error" : "network error" };
    }
  }

  return {
    client: opts.client,
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    apiVersion,
    fetchImpl,
    timeoutMs,
    now,
    async raw(method, path, o = {}) {
      const token = await opts.client.getApiToken();
      return call(method, path, { authorization: token, ...o.headers }, o.query, o.body);
    },
    rawAuthenticate() {
      return call("POST", "/authenticate", { "x-api-secret": opts.apiSecret });
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keysOf = (v: unknown): string[] => (isObj(v) ? Object.keys(v).sort() : []);
const is2xx = (s?: number) => s !== undefined && s >= 200 && s < 300;
const ENVELOPE_KEYS = ["code", "timestamp", "transaction_id", "message"];

/** A call through the production client, returning status and body without throwing on 4xx/5xx. */
async function viaClient(
  ctx: SmokeContext,
  method: "GET" | "POST",
  path: string,
  o: { query?: Record<string, string>; body?: unknown } = {},
): Promise<RawCallResult> {
  let status: number | undefined;
  const t0 = ctx.now();
  try {
    const env = await ctx.client.request(method, path, { ...o, onResponse: (s) => (status = s) });
    return { status, json: env, durationMs: ctx.now() - t0 };
  } catch (err) {
    if (err instanceof SandboxError) {
      const hasStatus = err.httpStatus !== undefined;
      return {
        status: err.httpStatus ?? status,
        json: err.body ?? { message: hasStatus ? "(no body)" : err.message, code: err.code },
        durationMs: ctx.now() - t0,
        error: hasStatus ? undefined : err.code,
        funding: err instanceof SandboxFundingError,
      };
    }
    return { json: null, durationMs: ctx.now() - t0, error: "unexpected client error" };
  }
}

const bodyHas = (json: unknown, needle: string): boolean => {
  try {
    return JSON.stringify(json).includes(needle);
  } catch {
    return false;
  }
};

const messageOf = (json: unknown): string | undefined =>
  isObj(json) && typeof json.message === "string" ? json.message.slice(0, 200) : undefined;

/** Common reasons a call cannot count as "the endpoint exists and answers". */
function hardFailure(res: RawCallResult, path: string): CheckOutcome | null {
  const base = { ok: false, httpStatus: res.status, observedPath: path, missingFields: [] as string[], keysPresent: keysOf(res.json) };
  if (res.status === undefined) return { ...base, notes: [`No HTTP response (${res.error ?? "unknown error"}).`] };
  if (res.funding || res.status === 402) {
    return { ...base, notes: ["Sandbox says OUR wallet or quota is exhausted. Top up at console.sandbox.co.in, then re-run."], sample: { message: messageOf(res.json) } };
  }
  if (res.status === 401 || res.status === 403) {
    return { ...base, notes: ["Credentials or permissions rejected. Check the key / secret pair and that this API is enabled on the account."], sample: { message: messageOf(res.json) } };
  }
  if (res.status === 404) {
    return { ...base, notes: ["404: the path is probably wrong (or the record is unknown). Compare with the Sandbox docs."], sample: { message: messageOf(res.json) } };
  }
  if (res.status === 429 || res.status >= 500) {
    return { ...base, notes: [`HTTP ${res.status}: rate limited or Sandbox side error. Retry later.`], sample: { message: messageOf(res.json) } };
  }
  return null;
}

// ── 1. Auth ──────────────────────────────────────────────────

const AUTH_SHAPE: ShapeExpectation = {
  required: ["data.access_token"],
  extraTopLevel: ENVELOPE_KEYS,
};

function jwtExpiryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

const authCheck: SmokeCheck = {
  id: "auth-token",
  title: "API token fetch (POST /authenticate)",
  kind: "read-only",
  async run(ctx) {
    const notes: string[] = [];
    const path = "/authenticate";
    let prodOk = true;
    try {
      await ctx.client.getApiToken();
      notes.push("The production client's getApiToken() succeeded.");
    } catch (err) {
      prodOk = false;
      notes.push(`The production client's getApiToken() failed: ${err instanceof SandboxError ? `HTTP ${err.httpStatus ?? err.code}` : "error"}.`);
    }
    const res = await ctx.rawAuthenticate();
    const hard = hardFailure(res, path);
    if (hard) return { ...hard, notes: [...notes, ...hard.notes] };

    const diff = diffShape(res.json, AUTH_SHAPE);
    const token = getPath(res.json, "data.access_token");
    let sample: Record<string, unknown> = { dataKeys: keysOf(getPath(res.json, "data")) };
    if (typeof token === "string") {
      const expMs = jwtExpiryMs(token);
      sample = { ...sample, tokenType: expMs !== null ? "jwt" : "opaque", tokenLength: token.length };
      if (expMs !== null) {
        const hours = Math.round(((expMs - ctx.now()) / 3_600_000) * 10) / 10;
        sample.expiresInHours = hours;
        notes.push(`Token is a JWT expiring in about ${hours} h (we assume 24 h).`);
        if (Math.abs(hours - 24) > 1) notes.push("Expiry differs from the 24 h assumed in client.ts (API_TOKEN_TTL_MS).");
      } else {
        notes.push("Token is not a JWT, so its expiry cannot be read; we assume 24 h.");
      }
    }
    return {
      ok: is2xx(res.status) && typeof token === "string" && prodOk,
      httpStatus: res.status,
      observedPath: path,
      notes,
      missingFields: diff.missingFields,
      unexpectedKeys: diff.unexpectedKeys,
      keysPresent: diff.keysPresent,
      sample,
    };
  },
};

// ── 2. HSN / SAC ─────────────────────────────────────────────

const HSN_FIELDS: Record<string, string[]> = {
  code: ["hsn_code", "sac_code", "code", "hsn", "sac", "hsn_sac"],
  description: ["description", "desc", "description_of_goods", "description_of_service", "name"],
  rate: ["gst_rate", "rate", "igst_rate", "igst", "tax_rate"],
};

/** Mirror of hsn.ts entryFor(): where the entry sits inside `data`. */
function hsnEntry(data: unknown): { entry: Record<string, unknown> | null; where: string } {
  if (Array.isArray(data)) return { entry: isObj(data[0]) ? data[0] : null, where: "data[0]" };
  if (!isObj(data)) return { entry: null, where: "data" };
  for (const k of ["hsn", "sac", "result", "details"]) {
    const inner = data[k];
    if (isObj(inner)) return { entry: inner, where: `data.${k}` };
    if (Array.isArray(inner) && isObj(inner[0])) return { entry: inner[0], where: `data.${k}[0]` };
  }
  return { entry: data, where: "data" };
}

function hsnCheck(id: string, title: string, code: string): SmokeCheck {
  return {
    id,
    title,
    kind: "read-only",
    async run(ctx) {
      const path = HSN_API_PATHS.lookup(code);
      const res = await viaClient(ctx, "GET", path);
      const hard = hardFailure(res, path);
      if (hard) return hard;
      if (!is2xx(res.status)) {
        return {
          ok: false, httpStatus: res.status, observedPath: path, missingFields: [], keysPresent: keysOf(res.json),
          notes: [`Unexpected HTTP ${res.status}: ${messageOf(res.json) ?? "no message"}`],
        };
      }
      const diff = diffShape(res.json, { required: ["data"], extraTopLevel: ENVELOPE_KEYS });
      const data = isObj(res.json) ? res.json.data : undefined;
      const { entry, where } = hsnEntry(data);
      const notes = [`Entry found at ${where}; its keys: ${keysOf(entry).join(", ") || "(none)"}.`];
      const missing = [...diff.missingFields];
      if (!entry || Object.keys(entry).length === 0) {
        missing.push("entry for the code");
      } else {
        for (const [group, names] of Object.entries(HSN_FIELDS)) {
          if (!names.some((n) => entry[n] !== undefined && entry[n] !== null && entry[n] !== "")) missing.push(`${group} (${names.join("|")})`);
        }
      }
      return {
        ok: true,
        httpStatus: res.status,
        observedPath: path,
        notes,
        missingFields: missing,
        unexpectedKeys: diff.unexpectedKeys,
        keysPresent: diff.keysPresent,
        sample: entry ?? data,
      };
    },
  };
}

// ── 3. PAN / TAN ─────────────────────────────────────────────

/** A fake-value verification: success shapes are compared, expected 4xx rejections are fine. */
function verifyCheck(id: string, title: string, path: string, body: Record<string, unknown>, successShape: ShapeExpectation): SmokeCheck {
  return {
    id,
    title,
    kind: "read-only",
    async run(ctx) {
      const res = await viaClient(ctx, "POST", path, { body });
      const hard = hardFailure(res, path);
      if (hard) return hard;
      const notes: string[] = [];
      if (is2xx(res.status)) {
        const diff = diffShape(res.json, successShape);
        notes.push(`2xx for a fake value. data keys: ${keysOf(getPath(res.json, "data")).join(", ") || "(none)"}.`);
        return { ok: true, httpStatus: res.status, observedPath: path, notes, missingFields: diff.missingFields, unexpectedKeys: diff.unexpectedKeys, keysPresent: diff.keysPresent, sample: res.json };
      }
      const diff = diffShape(res.json, { required: ["message"], optional: ["code", "transaction_id", "timestamp"] });
      notes.push(`HTTP ${res.status}: the fake value was rejected (acceptable). Message: ${messageOf(res.json) ?? "(none)"}`);
      return { ok: true, httpStatus: res.status, observedPath: path, notes, missingFields: diff.missingFields, unexpectedKeys: diff.unexpectedKeys, keysPresent: diff.keysPresent, sample: res.json };
    },
  };
}

// ── 4/5. GSTIN search and Track GST Returns (raw helper) ─────

const GSTIN_SEARCH_PATH = "/gst/compliance/public/gstin/search";
const TRACK_PATH = "/gst/compliance/public/gstrs/track";
const SAMPLE_GSTINS = {
  active: "29AFSPB9500E1ZY",
  cancelled: "36AEOFS9999J1ZI",
  oidar: "9917SGP29002OSR",
  noRecords: "07CQZCD1111I4Z7",
  invalidPattern: "3418FIN00001UNY",
} as const;

function gstinSearchCheck(id: string, title: string, gstin: string, expect: { status: number; code?: string }): SmokeCheck {
  return {
    id,
    title,
    kind: "read-only",
    async run(ctx) {
      // x-accept-cache is left off so the answer is fresh. TODO: replace with the typed adapter.
      const res = await ctx.raw("POST", GSTIN_SEARCH_PATH, { body: { gstin } });
      const hard = hardFailure(res, GSTIN_SEARCH_PATH);
      if (hard) return hard;
      const notes: string[] = [];
      const shape: ShapeExpectation =
        expect.status === 200 && !expect.code
          ? { required: ["code", "data.data"], optional: ["data.status_cd"], extraTopLevel: ENVELOPE_KEYS }
          : { required: [], extraTopLevel: [...ENVELOPE_KEYS, "data", "error"] };
      const diff = diffShape(res.json, shape);
      let unexpectedShape: string | undefined;
      if (res.status !== expect.status) {
        unexpectedShape = `Expected HTTP ${expect.status} for this sample, got ${res.status}.`;
      }
      if (expect.code) {
        if (bodyHas(res.json, expect.code)) notes.push(`${expect.code} found in the body, as documented.`);
        else unexpectedShape = [unexpectedShape, `${expect.code} not found in the body.`].filter(Boolean).join(" ");
      }
      if (is2xx(res.status)) {
        notes.push(`data keys: ${keysOf(getPath(res.json, "data")).join(", ") || "(none)"}; data.data keys: ${keysOf(getPath(res.json, "data.data")).join(", ") || "(none)"}.`);
      } else {
        notes.push(`Message: ${messageOf(res.json) ?? "(none)"}`);
      }
      return {
        ok: true,
        httpStatus: res.status,
        observedPath: GSTIN_SEARCH_PATH,
        notes,
        missingFields: diff.missingFields,
        unexpectedKeys: diff.unexpectedKeys,
        keysPresent: diff.keysPresent,
        unexpectedShape,
        sample: res.json,
      };
    },
  };
}

const TRACK_ITEM_FIELDS = ["arn", "dof", "mof", "ret_prd", "rtntype", "status", "valid"];

function trackCheck(
  id: string,
  title: string,
  o: { gstin: string; financialYear: string; gstr?: string; expect: "success" | "invalid-fy" | "invalid-pattern" },
): SmokeCheck {
  return {
    id,
    title,
    kind: "read-only",
    async run(ctx) {
      const query: Record<string, string> = { financial_year: o.financialYear };
      if (o.gstr) query.gstr = o.gstr;
      const path = `${TRACK_PATH}?${new URLSearchParams(query).toString()}`;
      const res = await ctx.raw("POST", TRACK_PATH, { query, body: { gstin: o.gstin } });
      const hard = hardFailure(res, path);
      if (hard) return hard;
      const notes: string[] = [];
      let missing: string[] = [];
      let unexpectedShape: string | undefined;
      const base = diffShape(res.json, { required: [], optional: ["code", "data", "timestamp", "transaction_id", "message", "error"] });

      if (o.expect === "success") {
        if (res.status !== 200) unexpectedShape = `Expected HTTP 200, got ${res.status}.`;
        if (bodyHas(res.json, "RET13510")) {
          notes.push("RET13510 (no record found) returned, as documented for a GSTIN with no filings in that year.");
        } else {
          const list = getPath(res.json, "data.data.EFiledlist");
          if (!Array.isArray(list)) {
            missing.push("data.data.EFiledlist (and no RET13510 either)");
          } else {
            notes.push(`EFiledlist has ${list.length} item(s).`);
            const first = list[0];
            for (const f of TRACK_ITEM_FIELDS) if (isObj(first) && first[f] === undefined) missing.push(`data.data.EFiledlist[].${f}`);
            if (isObj(first)) notes.push(`First item keys: ${Object.keys(first).sort().join(", ")}.`);
          }
        }
      } else if (o.expect === "invalid-fy") {
        if (bodyHas(res.json, "RTN_22")) notes.push("RTN_22 (invalid financial year) found, as documented.");
        else unexpectedShape = `RTN_22 not found; got HTTP ${res.status}.`;
      } else {
        if (res.status !== 422) unexpectedShape = `Expected HTTP 422 for an invalid GSTIN pattern, got ${res.status}.`;
        else notes.push("HTTP 422, as documented.");
        notes.push(`Message: ${messageOf(res.json) ?? "(none)"}`);
      }
      return {
        ok: true,
        httpStatus: res.status,
        observedPath: path,
        notes,
        missingFields: missing,
        unexpectedKeys: base.unexpectedKeys,
        keysPresent: base.keysPresent,
        unexpectedShape,
        sample: res.json,
      };
    },
  };
}

// ── Registry ─────────────────────────────────────────────────

const registry: SmokeCheck[] = [];

/** Add a check (other branches call this when their adapter lands). Ids must be unique. */
export function registerCheck(check: SmokeCheck): void {
  if (registry.some((c) => c.id === check.id)) throw new Error(`Duplicate smoke check id: ${check.id}`);
  if (check.kind !== "read-only") throw new Error(`Smoke check ${check.id} must be read-only`);
  registry.push(check);
}

export function allChecks(): SmokeCheck[] {
  return [...registry];
}

const PAN_SHAPE: ShapeExpectation = { required: ["data.status"], optional: ["data.name_as_per_pan_match", "data.date_of_birth_match", "data.pan"], extraTopLevel: ENVELOPE_KEYS };
const TAN_SHAPE: ShapeExpectation = { required: ["data.status"], optional: ["data.name", "data.deductor_name", "data.tan"], extraTopLevel: ENVELOPE_KEYS };

for (const c of [
  authCheck,
  hsnCheck("hsn-goods", "HSN lookup, goods code 5208 (GET /gst/hsn-sac/{code})", "5208"),
  hsnCheck("hsn-service", "SAC lookup, service code 998313 (GET /gst/hsn-sac/{code})", "998313"),
  verifyCheck("pan-verify", "PAN verify with an obviously fake PAN", TDS_API_PATHS.verifyPan(), { pan: "ABCDE1234F", consent: "Y", reason: "TDS deductee verification" }, PAN_SHAPE),
  verifyCheck("tan-verify", "TAN verify with an obviously fake TAN", TDS_API_PATHS.verifyTan(), { tan: "ABCD12345E" }, TAN_SHAPE),
  gstinSearchCheck("gstin-search-active", "GSTIN search: active taxpayer", SAMPLE_GSTINS.active, { status: 200 }),
  gstinSearchCheck("gstin-search-cancelled", "GSTIN search: cancelled taxpayer", SAMPLE_GSTINS.cancelled, { status: 200 }),
  gstinSearchCheck("gstin-search-oidar", "GSTIN search: OIDAR (non-resident online services)", SAMPLE_GSTINS.oidar, { status: 200 }),
  gstinSearchCheck("gstin-search-no-records", "GSTIN search: no records (FO8000)", SAMPLE_GSTINS.noRecords, { status: 200, code: "FO8000" }),
  gstinSearchCheck("gstin-search-invalid-pattern", "GSTIN search: invalid pattern (expect 422)", SAMPLE_GSTINS.invalidPattern, { status: 422 }),
  trackCheck("gst-track-success", "Track GST Returns, FY 2025-26", { gstin: SAMPLE_GSTINS.active, financialYear: "FY 2025-26", expect: "success" }),
  trackCheck("gst-track-gstr1", "Track GST Returns, FY 2025-26, GSTR-1 only", { gstin: SAMPLE_GSTINS.active, financialYear: "FY 2025-26", gstr: "gstr-1", expect: "success" }),
  trackCheck("gst-track-invalid-fy", "Track GST Returns, invalid financial year (RTN_22)", { gstin: SAMPLE_GSTINS.active, financialYear: "FY 2025-27", expect: "invalid-fy" }),
  trackCheck("gst-track-invalid-pattern", "Track GST Returns, invalid GSTIN pattern (expect 422)", { gstin: SAMPLE_GSTINS.invalidPattern, financialYear: "FY 2025-26", expect: "invalid-pattern" }),
]) {
  registerCheck(c);
}
