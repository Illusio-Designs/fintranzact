/**
 * sandbox/smoke.ts — pure parts of the Sandbox test-environment smoke run
 * (`pnpm sandbox:smoke`, entry point scripts/sandbox-smoke.ts).
 *
 * Everything here is import-safe and network-free unless a check is run with a
 * context whose fetch is real: no database, no logger transport, no env reads.
 * The checks themselves live in smoke-checks.ts.
 *
 * SAFETY MODEL
 *   - Only key_test_ keys run by default. key_live_ needs an explicit
 *     --allow-live flag, and even then only `kind: "read-only"` checks run.
 *   - Keys and secrets are never printed, logged or written to the report:
 *     only the key TYPE and a masked form are shown, and every report value
 *     passes through sanitise().
 */

import type { SandboxClient } from "./client.js";

// ── Key guard ────────────────────────────────────────────────

export type KeyKind = "test" | "live" | "unknown";

export function keyKind(apiKey: string | undefined | null): KeyKind {
  const k = (apiKey ?? "").trim();
  if (k.startsWith("key_test_")) return "test";
  if (k.startsWith("key_live_")) return "live";
  return "unknown";
}

/** "key_test_••••••••" — the type prefix only, never any of the secret part. */
export function maskKey(apiKey: string | undefined | null): string {
  const kind = keyKind(apiKey);
  if (kind === "test") return "key_test_••••••••";
  if (kind === "live") return "key_live_••••••••";
  return "(unrecognised key format) ••••••••";
}

export const SANDBOX_LIVE_HOST = "api.sandbox.co.in";

export type GuardResult =
  | { ok: true; kind: "test" | "live"; readOnlyOnly: boolean; warnings: string[] }
  | { ok: false; reason: string };

/**
 * Decide whether the run may proceed. A live key needs --allow-live; an
 * unrecognised key never runs; a test key pointed at the live host never runs.
 */
export function guardRun(opts: { apiKey?: string; apiSecret?: string; baseUrl?: string; allowLive: boolean }): GuardResult {
  if (!opts.apiKey || !opts.apiSecret) {
    return {
      ok: false,
      reason: "SANDBOX_API_KEY and SANDBOX_API_SECRET must be set in the environment or in .env (never passed as arguments).",
    };
  }
  const kind = keyKind(opts.apiKey);
  if (kind === "unknown") {
    return { ok: false, reason: "SANDBOX_API_KEY is neither a key_test_ nor a key_live_ key. Refusing to run." };
  }
  let host = "";
  try {
    host = opts.baseUrl ? new URL(opts.baseUrl).host : "";
  } catch {
    return { ok: false, reason: "SANDBOX_BASE_URL is not a valid URL." };
  }
  if (kind === "test" && host === SANDBOX_LIVE_HOST) {
    return { ok: false, reason: "A key_test_ key is pointed at the LIVE host. Refusing to run." };
  }
  if (kind === "live" && !opts.allowLive) {
    return {
      ok: false,
      reason:
        "This is a key_live_ key. The smoke run is meant for the TEST environment (key_test_). " +
        "Re-run with --allow-live only if you really mean it; even then only read-only checks run.",
    };
  }
  const warnings =
    kind === "live"
      ? ["LIVE key with --allow-live: only read-only checks run; live calls may count against the plan or wallet."]
      : [];
  return { ok: true, kind, readOnlyOnly: kind === "live", warnings };
}

// ── .env parsing (SANDBOX_* only) ────────────────────────────

const ENV_NAMES = new Set(["SANDBOX_API_KEY", "SANDBOX_API_SECRET", "SANDBOX_BASE_URL", "SANDBOX_API_VERSION"]);

/** Minimal dotenv parser that returns ONLY the SANDBOX_* names this script needs. */
export function parseSandboxEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || !ENV_NAMES.has(m[1])) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    if (v) out[m[1]] = v;
  }
  return out;
}

/** process.env wins over .env values. */
export function resolveSandboxEnv(processEnv: NodeJS.ProcessEnv, dotenvText: string | null): Record<string, string | undefined> {
  const fromFile = dotenvText ? parseSandboxEnv(dotenvText) : {};
  const out: Record<string, string | undefined> = {};
  for (const name of ENV_NAMES) out[name] = processEnv[name]?.trim() || fromFile[name];
  return out;
}

// ── Arguments (flags only, never credentials) ────────────────

export interface SmokeArgs {
  allowLive: boolean;
  list: boolean;
  only: string[] | null;
  noFile: boolean;
}

export function parseArgs(argv: string[]): { ok: true; args: SmokeArgs } | { ok: false; error: string } {
  const args: SmokeArgs = { allowLive: false, list: false, only: null, noFile: false };
  for (const a of argv) {
    if (a === "--allow-live") args.allowLive = true;
    else if (a === "--list") args.list = true;
    else if (a === "--no-file") args.noFile = true;
    else if (a.startsWith("--only=")) args.only = a.slice(7).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--") continue;
    // Never echo an unknown argument: it could be a pasted key.
    else return { ok: false, error: "Unknown argument. Supported: --allow-live, --only=id1,id2, --list, --no-file. Keys are read from the environment only." };
  }
  return { ok: true, args };
}

// ── Sanitising ───────────────────────────────────────────────

const SECRET_KEY_RE = /token|authorization|secret|api[-_]?key|password|passwd|otp|cookie|credential/i;
const JWT_RE = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const SANDBOX_KEY_RE = /key_(?:test|live)_[A-Za-z0-9]+/g;
const MAX_ARRAY = 3;
const MAX_STRING = 300;
const MAX_DEPTH = 7;

export const REDACTED = "[REDACTED]";

export interface SanitiseOptions {
  /** Literal secrets (key, secret, tokens) to scrub wherever they appear. */
  secrets?: string[];
}

function scrubString(s: string, secrets: string[]): string {
  let out = s;
  for (const secret of secrets) if (secret.length >= 6) out = out.split(secret).join(REDACTED);
  out = out.replace(JWT_RE, REDACTED).replace(SANDBOX_KEY_RE, (m) => m.slice(0, m.lastIndexOf("_") + 1) + "••••");
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…(truncated)` : out;
}

/**
 * Deep-copy `value` for the report: secret-looking keys and JWTs are redacted,
 * known literal secrets scrubbed, arrays cut to 3 items, long strings and deep
 * trees truncated.
 */
export function sanitise(value: unknown, opts: SanitiseOptions = {}, depth = 0): unknown {
  const secrets = opts.secrets ?? [];
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value, secrets);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (depth >= MAX_DEPTH) return "[max depth]";
  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((v) => sanitise(v, opts, depth + 1));
    if (value.length > MAX_ARRAY) head.push(`…(+${value.length - MAX_ARRAY} more)`);
    return head;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) && v !== null && v !== undefined && v !== "" ? REDACTED : sanitise(v, opts, depth + 1);
    }
    return out;
  }
  return String(value);
}

// ── Shape diffing ────────────────────────────────────────────

export interface ShapeExpectation {
  /** Dotted paths that should exist, e.g. "data.access_token". "a[].b" looks in the first element of array `a`. */
  required: string[];
  /** Dotted paths that may exist; they only widen the set of expected top-level keys. */
  optional?: string[];
  /** Top-level keys that are expected without a path (e.g. "message"). */
  extraTopLevel?: string[];
}

export interface ShapeDiff {
  /** Top-level keys actually present. */
  keysPresent: string[];
  missingFields: string[];
  /** Top-level keys that none of our assumed paths mention. */
  unexpectedKeys: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Value at a dotted path, or undefined. A "[]" suffix steps into the first array element. */
export function getPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const rawSeg of path.split(".")) {
    const isArr = rawSeg.endsWith("[]");
    const seg = isArr ? rawSeg.slice(0, -2) : rawSeg;
    if (!isObj(cur)) return undefined;
    cur = cur[seg];
    if (isArr) {
      if (!Array.isArray(cur) || cur.length === 0) return undefined;
      cur = cur[0];
    }
  }
  return cur;
}

export function diffShape(actual: unknown, expected: ShapeExpectation): ShapeDiff {
  const keysPresent = isObj(actual) ? Object.keys(actual).sort() : [];
  const missingFields = expected.required.filter((p) => {
    const v = getPath(actual, p);
    return v === undefined || v === null;
  });
  const known = new Set<string>(expected.extraTopLevel ?? []);
  for (const p of [...expected.required, ...(expected.optional ?? [])]) known.add(p.split(".")[0].replace(/\[\]$/, ""));
  const unexpectedKeys = keysPresent.filter((k) => !known.has(k));
  return { keysPresent, missingFields, unexpectedKeys };
}

// ── Checks and results ───────────────────────────────────────

export interface RawCallResult {
  status?: number;
  json: unknown;
  durationMs: number;
  /** Set when no HTTP response was received (network / timeout). */
  error?: string;
  /** True when the gateway said our wallet / quota is exhausted. */
  funding?: boolean;
}

export interface SmokeContext {
  /** The production client: same auth, headers and timeouts as the app. */
  client: SandboxClient;
  baseUrl: string;
  apiKey: string;
  apiVersion: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  now: () => number;
  /** Read-only call that returns the HTTP status and body instead of throwing on 4xx/5xx. */
  raw(method: "GET" | "POST", path: string, opts?: { query?: Record<string, string>; body?: unknown; headers?: Record<string, string> }): Promise<RawCallResult>;
  /** POST /authenticate exactly as the client does it, returning the raw status and body (the secret stays inside). */
  rawAuthenticate(): Promise<RawCallResult>;
}

export interface CheckOutcome {
  ok: boolean;
  httpStatus?: number;
  /** Path (with query) the check actually called. */
  observedPath: string;
  notes: string[];
  missingFields: string[];
  /** Unexpected top-level keys in the response. */
  unexpectedKeys?: string[];
  /** Top-level keys present in the response. */
  keysPresent?: string[];
  /** Set when the body is not even the kind of thing we assumed (e.g. a string instead of an object). */
  unexpectedShape?: string;
  /** Anything worth a developer's eye; sanitised by the report builder. */
  sample?: unknown;
}

export interface SmokeCheck {
  id: string;
  title: string;
  /** Only read-only checks exist in the smoke run. State-changing flows are manual checks. */
  kind: "read-only";
  run(ctx: SmokeContext): Promise<CheckOutcome>;
}

export type Verdict = "PASS" | "PASS-WITH-DIFFERENCES" | "FAIL" | "SKIPPED";

export interface CheckResult extends CheckOutcome {
  id: string;
  title: string;
  kind: "read-only";
  verdict: Verdict;
  durationMs: number;
}

export function verdictOf(o: CheckOutcome): Verdict {
  if (!o.ok) return "FAIL";
  const differs = o.missingFields.length > 0 || (o.unexpectedKeys?.length ?? 0) > 0 || !!o.unexpectedShape;
  return differs ? "PASS-WITH-DIFFERENCES" : "PASS";
}

/** Run one check with timing and error capture. A throwing check is a FAIL, never a crash. */
export async function runCheck(check: SmokeCheck, ctx: SmokeContext): Promise<CheckResult> {
  const started = ctx.now();
  let outcome: CheckOutcome;
  if ((check.kind as string) !== "read-only") {
    outcome = { ok: false, observedPath: "-", notes: ["Refused: only read-only checks may run in the smoke script."], missingFields: [] };
  } else {
    try {
      outcome = await check.run(ctx);
    } catch (err) {
      outcome = {
        ok: false,
        observedPath: "-",
        notes: [`Check threw: ${err instanceof Error ? err.message : String(err)}`],
        missingFields: [],
      };
    }
  }
  return {
    ...outcome,
    id: check.id,
    title: check.title,
    kind: "read-only",
    verdict: verdictOf(outcome),
    durationMs: Math.max(0, ctx.now() - started),
  };
}

/** Run checks in order. When the auth check fails with a credential problem, the rest are skipped. */
export async function runChecks(checks: SmokeCheck[], ctx: SmokeContext): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  let authBlocked: string | null = null;
  for (const check of checks) {
    if (authBlocked && check.id !== "auth-token") {
      results.push({
        id: check.id,
        title: check.title,
        kind: "read-only",
        verdict: "SKIPPED",
        ok: false,
        observedPath: "-",
        notes: [authBlocked],
        missingFields: [],
        durationMs: 0,
      });
      continue;
    }
    const r = await runCheck(check, ctx);
    results.push(r);
    if (check.id === "auth-token" && !r.ok) authBlocked = "Skipped because the authentication check failed (fix the key / secret first).";
  }
  return results;
}

// ── Report ───────────────────────────────────────────────────

export interface ReportEnv {
  keyKind: "test" | "live";
  maskedKey: string;
  host: string;
  apiVersion: string;
  readOnlyOnly: boolean;
  warnings: string[];
}

export interface SmokeReport {
  generatedAt: string;
  environment: ReportEnv;
  summary: { total: number; pass: number; passWithDifferences: number; fail: number; skipped: number };
  results: Array<Omit<CheckResult, "sample"> & { sample?: unknown }>;
  manualChecklist: ManualCheck[];
}

export interface ManualCheck {
  title: string;
  prepare: string[];
  steps: string[];
}

export function buildReport(opts: {
  env: ReportEnv;
  results: CheckResult[];
  generatedAt: string;
  secrets?: string[];
  manualChecklist?: ManualCheck[];
}): { json: SmokeReport; markdown: string } {
  const sanitiseOpts = { secrets: opts.secrets ?? [] };
  const results = opts.results.map((r) => ({
    ...r,
    notes: r.notes.map((n) => String(sanitise(n, sanitiseOpts))),
    sample: sanitise(r.sample, sanitiseOpts),
  }));
  const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
  const json: SmokeReport = {
    generatedAt: opts.generatedAt,
    environment: {
      ...opts.env,
      warnings: opts.env.warnings.map((w) => String(sanitise(w, sanitiseOpts))),
    },
    summary: {
      total: results.length,
      pass: count("PASS"),
      passWithDifferences: count("PASS-WITH-DIFFERENCES"),
      fail: count("FAIL"),
      skipped: count("SKIPPED"),
    },
    results,
    manualChecklist: opts.manualChecklist ?? MANUAL_CHECKLIST,
  };
  return { json, markdown: renderMarkdown(json) };
}

const cell = (s: string | number | undefined) => String(s ?? "-").replace(/\|/g, "\\|");

export function renderMarkdown(r: SmokeReport): string {
  const e = r.environment;
  const lines: string[] = [];
  lines.push("# Sandbox smoke run");
  lines.push("");
  lines.push(`- Generated: ${r.generatedAt}`);
  lines.push(`- Environment: ${e.keyKind === "test" ? "TEST" : "LIVE (read-only checks only)"}`);
  lines.push(`- Key: ${e.maskedKey}`);
  lines.push(`- Host: ${e.host}`);
  lines.push(`- API version header: ${e.apiVersion}`);
  for (const w of e.warnings) lines.push(`- WARNING: ${w}`);
  lines.push("");
  const s = r.summary;
  lines.push(`**${s.total} checks: ${s.pass} PASS, ${s.passWithDifferences} PASS-WITH-DIFFERENCES, ${s.fail} FAIL, ${s.skipped} SKIPPED**`);
  lines.push("");
  lines.push("| Check | Verdict | HTTP | ms | Path |");
  lines.push("|---|---|---|---|---|");
  for (const c of r.results) {
    lines.push(`| ${cell(c.id)} | ${c.verdict} | ${cell(c.httpStatus)} | ${c.durationMs} | \`${cell(c.observedPath)}\` |`);
  }
  lines.push("");
  lines.push("## Details");
  for (const c of r.results) {
    lines.push("");
    lines.push(`### ${c.id}: ${c.title}`);
    lines.push(`- Verdict: ${c.verdict}`);
    lines.push(`- HTTP status: ${c.httpStatus ?? "none"}`);
    lines.push(`- Path: \`${c.observedPath}\``);
    lines.push(`- Response keys present: ${c.keysPresent?.length ? c.keysPresent.join(", ") : "(none)"}`);
    lines.push(`- Assumed fields missing: ${c.missingFields.length ? c.missingFields.join(", ") : "none"}`);
    lines.push(`- Unexpected top-level keys: ${c.unexpectedKeys?.length ? c.unexpectedKeys.join(", ") : "none"}`);
    if (c.unexpectedShape) lines.push(`- Unexpected shape: ${c.unexpectedShape}`);
    for (const n of c.notes) lines.push(`- Note: ${n}`);
    if (c.sample !== undefined) {
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(c.sample, null, 2));
      lines.push("```");
    }
  }
  lines.push("");
  lines.push("## Manual test-environment checklist");
  lines.push("");
  lines.push("These change state (generate, cancel, save, file), so the smoke script never runs them. Do them by hand against the TEST environment only.");
  for (const m of r.manualChecklist) {
    lines.push("");
    lines.push(`### ${m.title}`);
    lines.push("Prepare:");
    for (const p of m.prepare) lines.push(`- ${p}`);
    lines.push("Steps:");
    m.steps.forEach((st, i) => lines.push(`${i + 1}. ${st}`));
  }
  lines.push("");
  lines.push("---");
  lines.push("Paste this report back to the developer. Never paste your keys, your .env or anything else from the environment.");
  return lines.join("\n") + "\n";
}

// ── Manual checklist ─────────────────────────────────────────

const DOCS = "https://developer.sandbox.co.in";
const SETUP = "apps/web/src/content/help/gst/setup-e-invoicing-and-eway-bills.mdx (customer setup guide)";

export const MANUAL_CHECKLIST: ManualCheck[] = [
  {
    title: "Common preparation",
    prepare: [
      `Open ${DOCS} and find the GST compliance "test data" page. Note the test GSTIN and the portal API username / password it lists for the e-invoice, e-way bill and GST return APIs, plus the fixed test OTP / EVC OTP it documents.`,
      "Run the API locally with the test key in the environment, GOV_API_PROVIDER=sandbox, and a scratch database. Never point this at production data.",
      `In the app, create a business with that test GSTIN and open the GST setup screen (see ${SETUP}); enter the test portal username and password.`,
      "Run the manual steps below on a test business only. Keep notes of every error message and code you see.",
    ],
    steps: ["Complete the preparation, then do each flow below."],
  },
  {
    title: "E-invoice: generate, then cancel",
    prepare: ["A sale invoice for a registered (B2B) test customer with a valid test GSTIN, HSN codes and GST lines, dated today."],
    steps: [
      "E-invoicing settings > Test connection (eInvoice.testConnection) should say connected.",
      "Open the invoice > Generate e-invoice (eInvoice.generate). Confirm an IRN, ack number, ack date and QR code are saved.",
      "Download or view the e-invoice PDF and check the QR code is present.",
      "Cancel the IRN within 24 hours (eInvoice.cancel) with reason code 1 (duplicate) and a remark. Confirm status becomes cancelled.",
      "Try generating a second IRN for another invoice with a deliberately bad GSTIN. Confirm the error message is readable and the invoice is marked failed, not pending.",
    ],
  },
  {
    title: "E-way bill: generate, update vehicle, extend, cancel",
    prepare: ["A goods invoice above the e-way bill threshold with a transporter or vehicle number in the test data format (for example KA01AB1234)."],
    steps: [
      "Generate the e-way bill (ewayBill.generate). Confirm the EWB number and validity date are saved.",
      "Update the vehicle number (ewayBill.updateVehicle) with a reason. Confirm the new vehicle shows.",
      "Extend validity (ewayBill.extend) if the test data allows it; note the message if the portal refuses.",
      "Cancel the e-way bill (ewayBill.cancel) with reason 3 (data entry mistake). Confirm status cancelled.",
    ],
  },
  {
    title: "GSTR-1 and GSTR-3B, including nil returns",
    prepare: [
      "A month of test invoices (B2B, B2C, a credit note) and purchases, or a month with no activity for the nil flows.",
      "The GST portal username for the test GSTIN and the documented test OTP and EVC OTP.",
    ],
    steps: [
      "GST filing > Connect: request an OTP (gstReturns.requestOtp), enter the test OTP (gstReturns.verifyOtp). Confirm a session is established. Also try a wrong OTP and note the message.",
      "GSTR-1: save to the portal (gstReturns.saveGstr1), then review the summary. Compare totals with the books.",
      "GSTR-1: file with the EVC OTP (gstReturns.fileGstr1). Confirm an ARN is returned and the month is marked filed.",
      "GSTR-3B: save (gstReturns.saveGstr3b), then file with EVC OTP (gstReturns.fileGstr3b). Confirm ARN.",
      "Nil flows: on a month with no activity, repeat GSTR-1 and GSTR-3B and confirm nil returns save and file.",
      "Pull GSTR-2B for a period (gstReturns.pull2b) and confirm purchases import.",
      "Let the session expire (or restart the API) and confirm the app asks for a new OTP rather than showing a raw error.",
    ],
  },
  {
    title: "Wallet empty / quota message (optional)",
    prepare: ["Only possible if Sandbox lets you drain a TEST wallet or lower the quota. Skip if not."],
    steps: [
      "With the wallet empty, generate an e-invoice. The app should show: The government filing service is temporarily unavailable. Please try again in a little while. Our team has been notified.",
      "Confirm a platform alert (sandbox.wallet_or_quota_blocked) was recorded once, mentioning the Sandbox console top-up.",
    ],
  },
];
