/**
 * gstin-lookup.ts — verify a GSTIN and fetch its public details through
 * Sandbox.co.in, falling back to local validation only.
 *
 * Rules (mirrors hsn-lookup.ts):
 *  - Sandbox is tried only when the provider is Sandbox AND its keys are in
 *    the environment (GSTIN_SANDBOX_LOOKUP=off disables it). No keys: skipped
 *    silently, reported as `not_configured`, local checksum validation only.
 *  - The GSTIN is validated locally first; garbage never spends a call.
 *  - Never throws and never blocks on Sandbox: every failure, timeout or 5xx
 *    comes back as `unavailable`.
 *  - Found answers are cached 6 h, "no record", invalid and failed answers
 *    60 s, in a bounded in-memory LRU; concurrent lookups of one GSTIN share one
 *    call; a per-process guard caps calls per minute.
 *  - Lookups are not billed to customers (see sandbox/gstin.ts).
 */

import { validateGstin, type GstinProfile, type GstinFormat } from "@fintranzact/shared";
import { logger } from "./logger.js";
import { useSandboxProvider } from "./gov-provider.js";
import { getSandboxClient } from "./sandbox/client.js";
import { GstinLookupError, SandboxGstinClient, type GstinLookupClient } from "./sandbox/gstin.js";

export const GSTIN_SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
export const GSTIN_NEGATIVE_TTL_MS = 60 * 1000;
export const GSTIN_CACHE_MAX = 2000;
export const GSTIN_DEFAULT_TIMEOUT_MS = 2500;
/** Cap for the party-save path. */
export const GSTIN_SAVE_TIMEOUT_MS = 2500;
const RATE_GUARD_PER_MINUTE = 60;

export type GstinSandboxStatus = "ok" | "not_found" | "invalid" | "unavailable" | "not_configured";

export interface GstinResolution {
  gstin: string;
  /**
   * True unless we know the GSTIN is wrong or unusable: bad pattern or check
   * digit, Sandbox has no record, or the registration is cancelled.
   */
  valid: boolean;
  format: GstinFormat | null;
  /** Local check digit result; null when not applicable or the pattern failed. */
  checksumOk: boolean | null;
  source: "sandbox" | "local";
  sandboxStatus: GstinSandboxStatus;
  profile: GstinProfile | null;
  warnings: string[];
  /** ISO time the answer was produced (or first cached). */
  checkedAt: string | null;
}

type Outcome =
  | { kind: "ok"; profile: GstinProfile }
  | { kind: "not_found" }
  | { kind: "invalid" }
  | { kind: "unavailable" };

export interface GstinResolverDeps {
  /** The Sandbox client, or null when Sandbox is not the provider / has no keys. */
  getClient: () => GstinLookupClient | null;
  now: () => number;
  /** GSTIN_SANDBOX_LOOKUP and GSTIN_LOOKUP_TIMEOUT_MS. */
  settings: () => { enabled: boolean; timeoutMs: number };
  maxPerMinute?: number;
}

export function gstinSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; timeoutMs: number } {
  const enabled = (env.GSTIN_SANDBOX_LOOKUP ?? "on").trim().toLowerCase() !== "off";
  const n = Number(env.GSTIN_LOOKUP_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(n) && n >= 100 ? Math.min(Math.round(n), 10_000) : GSTIN_DEFAULT_TIMEOUT_MS;
  return { enabled, timeoutMs };
}

const defaultDeps: GstinResolverDeps = {
  getClient: () => {
    if (!useSandboxProvider()) return null;
    const c = getSandboxClient();
    return c ? new SandboxGstinClient(c) : null;
  },
  now: Date.now,
  settings: () => gstinSettingsFromEnv(),
};

export interface GstinResolveOptions {
  now?: () => number;
  /** Per-call cap; never above the configured timeout. */
  timeoutMs?: number;
  /** Let Sandbox answer from its own cache (x-accept-cache). Default true. */
  acceptCache?: boolean;
  /** Skip our cache and ask Sandbox again (the explicit "refresh" action). */
  fresh?: boolean;
}

const fmtDate = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : null);

/** The advisory messages a profile earns on its own (no party context). */
export function warningsForProfile(p: GstinProfile): string[] {
  const out: string[] = [];
  if (p.status === "cancelled") {
    out.push(`This GSTIN is cancelled${p.cancelledOn ? ` (since ${fmtDate(p.cancelledOn)})` : ""}. Input tax credit and e-invoicing are not available against it.`);
  } else if (p.status === "suspended") {
    out.push("This GSTIN is suspended. Check with the party before raising GST invoices.");
  } else if (p.status === "provisional") {
    out.push("This GSTIN has a provisional registration.");
  } else if (p.status === "other") {
    out.push(`The GST portal lists this GSTIN as "${p.statusRaw || "unknown"}".`);
  }
  if (p.principalAddress?.stateMismatch) {
    out.push("The portal lists the principal address in a different state than the GSTIN's state code. The GSTIN's state was used.");
  }
  return out;
}

export function createGstinResolver(deps: GstinResolverDeps) {
  const cache = new Map<string, { at: number; ttl: number; outcome: Outcome }>();
  const inflight = new Map<string, Promise<Outcome>>();
  let windowStart = 0;
  let windowCount = 0;

  function readCache(gstin: string, t: number): { outcome: Outcome; at: number } | null {
    const hit = cache.get(gstin);
    if (!hit) return null;
    if (t - hit.at >= hit.ttl) {
      cache.delete(gstin);
      return null;
    }
    cache.delete(gstin);
    cache.set(gstin, hit);
    return hit;
  }

  function writeCache(gstin: string, outcome: Outcome, t: number): void {
    cache.delete(gstin);
    cache.set(gstin, { at: t, ttl: outcome.kind === "ok" ? GSTIN_SUCCESS_TTL_MS : GSTIN_NEGATIVE_TTL_MS, outcome });
    while (cache.size > GSTIN_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  function allowCall(t: number): boolean {
    if (t - windowStart >= 60_000) {
      windowStart = t;
      windowCount = 0;
    }
    if (windowCount >= (deps.maxPerMinute ?? RATE_GUARD_PER_MINUTE)) return false;
    windowCount++;
    return true;
  }

  async function callSandbox(client: GstinLookupClient, gstin: string, timeoutMs: number, acceptCache: boolean, t: number): Promise<Outcome> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new GstinLookupError("Sandbox GSTIN search timed out", "timeout")), timeoutMs);
    });
    try {
      const profile = await Promise.race([client.lookupGstin(gstin, { timeoutMs, acceptCache }), deadline]);
      const outcome: Outcome = profile ? { kind: "ok", profile } : { kind: "not_found" };
      writeCache(gstin, outcome, t);
      return outcome;
    } catch (err) {
      const kind = err instanceof GstinLookupError ? err.kind : "unknown";
      // Only the failure class is logged: never keys, tokens or gateway bodies.
      logger.warn(
        { errorKind: kind, httpStatus: err instanceof GstinLookupError ? err.httpStatus : undefined },
        "Sandbox GSTIN search failed; continuing with local validation",
      );
      const outcome: Outcome = kind === "invalid" ? { kind: "invalid" } : { kind: "unavailable" };
      writeCache(gstin, outcome, t);
      return outcome;
    } finally {
      clearTimeout(timer);
    }
  }

  async function resolveGstin(rawGstin: string, opts: GstinResolveOptions = {}): Promise<GstinResolution> {
    const input = String(rawGstin ?? "");
    const t0 = (opts.now ?? deps.now)();
    let client: GstinLookupClient | null = null;
    let enabled = false;
    let timeoutMs = GSTIN_DEFAULT_TIMEOUT_MS;
    try {
      const settings = deps.settings();
      enabled = settings.enabled;
      timeoutMs = settings.timeoutMs;
      client = enabled ? deps.getClient() : null;
    } catch {
      client = null;
    }
    const v = validateGstin(input, { strictChecksum: client ? client.strictChecksum ?? true : false });
    const base = { gstin: v.gstin, format: v.format, checksumOk: v.checksumOk, profile: null as GstinProfile | null, checkedAt: null as string | null };

    if (!v.valid) {
      const why =
        v.reason === "empty"
          ? "Enter a GSTIN."
          : v.reason === "checksum"
            ? "The GSTIN's check character does not match. Check it for typos."
            : "This is not a valid 15-character GSTIN.";
      return { ...base, valid: false, source: "local", sandboxStatus: "invalid", warnings: [why] };
    }

    try {
      if (!client) {
        // Local validation only: a wrong check digit is a warning, since a test host may use odd GSTINs.
        const warnings = v.checksumOk === false ? ["The GSTIN's check character does not match. Check it for typos."] : [];
        return { ...base, valid: true, source: "local", sandboxStatus: "not_configured", warnings };
      }

      let outcome: Outcome | null = null;
      let at = t0;
      if (!opts.fresh) {
        const hit = readCache(v.gstin, t0);
        if (hit) {
          outcome = hit.outcome;
          at = hit.at;
        }
      }
      if (!outcome) {
        const running = inflight.get(v.gstin);
        if (running) {
          outcome = await running;
        } else if (!allowCall(t0)) {
          outcome = { kind: "unavailable" };
        } else {
          const cap = Math.min(opts.timeoutMs ?? timeoutMs, timeoutMs);
          const p = callSandbox(client, v.gstin, cap, opts.acceptCache ?? true, t0).finally(() => {
            inflight.delete(v.gstin);
          });
          inflight.set(v.gstin, p);
          outcome = await p;
        }
      }

      const checkedAt = new Date(at).toISOString();
      switch (outcome.kind) {
        case "ok": {
          const profile = outcome.profile;
          return {
            ...base,
            valid: profile.status !== "cancelled",
            source: "sandbox",
            sandboxStatus: "ok",
            profile,
            warnings: warningsForProfile(profile),
            checkedAt,
          };
        }
        case "not_found":
          return { ...base, valid: false, source: "sandbox", sandboxStatus: "not_found", warnings: ["No GST record was found for this GSTIN. Check it for typos."], checkedAt };
        case "invalid":
          return { ...base, valid: false, source: "sandbox", sandboxStatus: "invalid", warnings: ["The GST portal does not accept this GSTIN."], checkedAt };
        default:
          return { ...base, valid: true, source: "local", sandboxStatus: "unavailable", warnings: [] };
      }
    } catch (err) {
      // Defensive: the resolver must never throw into a party save.
      logger.warn({ errorKind: err instanceof Error ? err.name : "unknown" }, "GSTIN resolver error; continuing with local validation");
      return { ...base, valid: true, source: "local", sandboxStatus: "unavailable", warnings: [] };
    }
  }

  return {
    resolveGstin,
    /** Test hook. */
    clear(): void {
      cache.clear();
      inflight.clear();
      windowStart = 0;
      windowCount = 0;
    },
    cacheSize: () => cache.size,
  };
}

const shared = createGstinResolver(defaultDeps);

export const resolveGstin = shared.resolveGstin;
export const resetGstinLookupForTests = shared.clear;

// ── Party-save check ─────────────────────────────────────────

export type GstinCheckStatus =
  | "active"
  | "cancelled"
  | "suspended"
  | "provisional"
  | "other"
  | "not_found"
  | "invalid"
  | "unavailable"
  | "not_configured";

export interface GstinCheck {
  status: GstinCheckStatus;
  warning?: string;
}

const NAME_STOP = new Set(["pvt", "private", "ltd", "limited", "llp", "co", "company", "and", "the", "ms", "m", "s", "inc", "opc", "of"]);
const nameTokens = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w && !NAME_STOP.has(w)),
  );

/** True when the typed name shares too little with both registered names (advisory only). */
export function partyNameMismatch(partyNames: Array<string | null | undefined>, registered: Array<string | null | undefined>): boolean {
  const mine = partyNames.map((n) => nameTokens(n ?? "")).filter((s) => s.size > 0);
  const theirs = registered.map((n) => nameTokens(n ?? "")).filter((s) => s.size > 0);
  if (!mine.length || !theirs.length) return false;
  for (const a of mine) {
    for (const b of theirs) {
      let shared = 0;
      for (const w of a) if (b.has(w)) shared++;
      if (shared / Math.min(a.size, b.size) >= 0.5) return false;
    }
  }
  return true;
}

export interface PartyGstinCandidate {
  gstin: string | null | undefined;
  name?: string | null;
  legalName?: string | null;
  tradeName?: string | null;
  stateCode?: string | null;
}

/**
 * The advisory check run after a party is saved with a GSTIN. Null for a
 * blank GSTIN. Never throws; waits for Sandbox at most GSTIN_SAVE_TIMEOUT_MS.
 */
export async function checkPartyGstin(
  p: PartyGstinCandidate,
  opts: GstinResolveOptions & { resolve?: typeof resolveGstin } = {},
): Promise<GstinCheck | null> {
  const g = p.gstin?.trim();
  if (!g) return null;
  const { resolve = resolveGstin, ...resolveOpts } = opts;
  const r = await resolve(g, { ...resolveOpts, timeoutMs: Math.min(resolveOpts.timeoutMs ?? GSTIN_SAVE_TIMEOUT_MS, GSTIN_SAVE_TIMEOUT_MS) });
  if (r.sandboxStatus === "ok" && r.profile) {
    const warnings = [...r.warnings];
    if (partyNameMismatch([p.legalName, p.tradeName, p.name], [r.profile.legalName, r.profile.tradeName])) {
      warnings.push(`The name on this party does not match the GST record (${r.profile.legalName || r.profile.tradeName}). Check you have the right GSTIN.`);
    }
    const mine = p.stateCode?.trim();
    const theirs = r.profile.principalAddress?.stateCode;
    if (mine && theirs && mine !== theirs) {
      warnings.push("The party's state differs from the state on the GST record.");
    }
    return { status: r.profile.status, ...(warnings.length ? { warning: warnings.join(" ") } : {}) };
  }
  const warning = r.warnings.length ? r.warnings.join(" ") : undefined;
  const status: GstinCheckStatus =
    r.sandboxStatus === "ok" ? "other" : r.sandboxStatus;
  return { status, ...(warning ? { warning } : {}) };
}
