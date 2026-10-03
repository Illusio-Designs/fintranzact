/**
 * hsn-lookup.ts — resolve an HSN / SAC code, preferring Sandbox.co.in and
 * falling back to the bundled CBIC list.
 *
 * Rules:
 *  - Sandbox is tried only when the provider is Sandbox AND its keys are in
 *    the environment (HSN_SANDBOX_LOOKUP=off disables it). No keys: skipped
 *    silently, reported as `not_configured`.
 *  - Never throws and never blocks on Sandbox: every failure, timeout or 5xx
 *    falls back to the bundled list.
 *  - A Sandbox "not found" for a code the bundled list has is not a failure:
 *    the bundled answer is returned with a warning.
 *  - Successful lookups are cached 24 h, misses and failures 60 s, in a bounded
 *    in-memory LRU; concurrent lookups of one code share one call; a
 *    per-process guard caps calls per minute.
 *  - Lookups are not billed to customers (see sandbox/hsn.ts).
 */

import { logger } from "./logger.js";
import { describeHsn, type HsnDetails } from "./hsn-data.js";
import { useSandboxProvider } from "./gov-provider.js";
import { getSandboxClient } from "./sandbox/client.js";
import { HSN_CODE_RE, HsnLookupError, SandboxHsnClient, type HsnLookupClient, type SandboxHsnResult } from "./sandbox/hsn.js";

export const HSN_SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
export const HSN_NEGATIVE_TTL_MS = 60 * 1000;
export const HSN_CACHE_MAX = 2000;
export const HSN_DEFAULT_TIMEOUT_MS = 2500;
/** Cap for the item-save path. */
export const HSN_SAVE_TIMEOUT_MS = 2500;
const RATE_GUARD_PER_MINUTE = 60;

export type SandboxStatus = "ok" | "unavailable" | "not_configured" | "not_found" | "skipped";

export interface HsnResolution {
  code: string;
  /** Where the description and validity come from. */
  source: "sandbox" | "bundled";
  sandboxStatus: SandboxStatus;
  /** Real and usable: Sandbox says active, or (on fallback) the bundled list has it. */
  valid: boolean;
  kind: "hsn" | "sac" | null;
  description: string | null;
  /** The bundled CBIC description, kept alongside Sandbox's. */
  bundledDescription: string | null;
  bundled: HsnDetails | null;
  /** Sandbox's own answer, when it gave one. */
  sandbox: SandboxHsnResult | null;
  rate: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  active: boolean | null;
  warning?: string;
}

type Outcome =
  | { kind: "ok"; result: SandboxHsnResult }
  | { kind: "not_found" }
  | { kind: "unavailable" };

export interface HsnResolverDeps {
  /** The Sandbox lookup client, or null when Sandbox is not the provider / has no keys. */
  getClient: () => HsnLookupClient | null;
  bundled: (code: string) => HsnDetails | null;
  now: () => number;
  /** HSN_SANDBOX_LOOKUP and HSN_LOOKUP_TIMEOUT_MS. */
  settings: () => { enabled: boolean; timeoutMs: number };
  maxPerMinute?: number;
}

export function hsnSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; timeoutMs: number } {
  const enabled = (env.HSN_SANDBOX_LOOKUP ?? "on").trim().toLowerCase() !== "off";
  const n = Number(env.HSN_LOOKUP_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(n) && n >= 100 ? Math.min(Math.round(n), 10_000) : HSN_DEFAULT_TIMEOUT_MS;
  return { enabled, timeoutMs };
}

const defaultDeps: HsnResolverDeps = {
  getClient: () => {
    if (!useSandboxProvider()) return null;
    const c = getSandboxClient();
    return c ? new SandboxHsnClient(c) : null;
  },
  bundled: describeHsn,
  now: Date.now,
  settings: () => hsnSettingsFromEnv(),
};

export interface ResolveOptions {
  /** Override the clock (ms since epoch). */
  now?: () => number;
  /** Per-call cap; never above the configured timeout. */
  timeoutMs?: number;
}

export function createHsnResolver(deps: HsnResolverDeps) {
  const cache = new Map<string, { at: number; ttl: number; outcome: Outcome }>();
  const inflight = new Map<string, Promise<Outcome>>();
  let windowStart = 0;
  let windowCount = 0;

  function readCache(code: string, t: number): Outcome | null {
    const hit = cache.get(code);
    if (!hit) return null;
    if (t - hit.at >= hit.ttl) {
      cache.delete(code);
      return null;
    }
    // Refresh recency (Map keeps insertion order).
    cache.delete(code);
    cache.set(code, hit);
    return hit.outcome;
  }

  function writeCache(code: string, outcome: Outcome, t: number): void {
    cache.delete(code);
    cache.set(code, { at: t, ttl: outcome.kind === "ok" ? HSN_SUCCESS_TTL_MS : HSN_NEGATIVE_TTL_MS, outcome });
    while (cache.size > HSN_CACHE_MAX) {
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

  async function callSandbox(client: HsnLookupClient, code: string, timeoutMs: number, t: number): Promise<Outcome> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HsnLookupError("Sandbox HSN lookup timed out", "timeout")), timeoutMs);
    });
    try {
      const result = await Promise.race([client.lookupHsn(code, { timeoutMs }), deadline]);
      const outcome: Outcome = result ? { kind: "ok", result } : { kind: "not_found" };
      writeCache(code, outcome, t);
      return outcome;
    } catch (err) {
      // Only the failure class is logged: never keys, tokens or gateway bodies.
      logger.warn(
        { code, errorKind: err instanceof HsnLookupError ? err.kind : "unknown", httpStatus: err instanceof HsnLookupError ? err.httpStatus : undefined },
        "Sandbox HSN lookup failed; using the bundled list",
      );
      const outcome: Outcome = { kind: "unavailable" };
      writeCache(code, outcome, t);
      return outcome;
    } finally {
      clearTimeout(timer);
    }
  }

  async function sandboxOutcome(code: string, opts: ResolveOptions): Promise<Outcome | "not_configured"> {
    const settings = deps.settings();
    if (!settings.enabled) return "not_configured";
    const client = deps.getClient();
    if (!client) return "not_configured";
    const t = (opts.now ?? deps.now)();
    const cached = readCache(code, t);
    if (cached) return cached;
    const running = inflight.get(code);
    if (running) return running;
    if (!allowCall(t)) return { kind: "unavailable" };
    const timeoutMs = Math.min(opts.timeoutMs ?? settings.timeoutMs, settings.timeoutMs);
    const p = callSandbox(client, code, timeoutMs, t).finally(() => {
      inflight.delete(code);
    });
    inflight.set(code, p);
    return p;
  }

  async function resolveHsn(rawCode: string, opts: ResolveOptions = {}): Promise<HsnResolution> {
    const code = String(rawCode ?? "").trim();
    let bundled: HsnDetails | null = null;
    try {
      bundled = deps.bundled(code);
    } catch {
      bundled = null;
    }
    const base = {
      code,
      bundled,
      bundledDescription: bundled?.description ?? null,
      sandbox: null as SandboxHsnResult | null,
      rate: null as number | null,
      effectiveFrom: null as string | null,
      effectiveTo: null as string | null,
      active: null as boolean | null,
    };
    const fallback = (sandboxStatus: SandboxStatus, warning?: string): HsnResolution => ({
      ...base,
      source: "bundled",
      sandboxStatus,
      valid: bundled !== null,
      kind: bundled ? (bundled.type === "services" ? "sac" : "hsn") : null,
      description: bundled?.description ?? null,
      ...(warning ? { warning } : {}),
    });

    if (!HSN_CODE_RE.test(code)) {
      return fallback("skipped", "HSN / SAC code must be 2 to 8 digits.");
    }

    try {
      const out = await sandboxOutcome(code, opts);
      if (out === "not_configured") {
        return fallback("not_configured", bundled ? undefined : `${code} is not in the bundled HSN / SAC list.`);
      }
      if (out.kind === "unavailable") {
        return fallback(
          "unavailable",
          bundled ? undefined : `${code} is not in the bundled list and Sandbox could not be reached to check it.`,
        );
      }
      if (out.kind === "not_found") {
        return fallback(
          "not_found",
          bundled
            ? `Sandbox does not list ${code}; showing the bundled CBIC description.`
            : `${code} was not found on Sandbox or in the bundled HSN / SAC list.`,
        );
      }
      const r = out.result;
      const description = r.description || bundled?.description || null;
      return {
        ...base,
        source: "sandbox",
        sandboxStatus: "ok",
        valid: r.active,
        kind: r.kind,
        description,
        sandbox: r,
        rate: r.rate ?? null,
        effectiveFrom: r.effectiveFrom ?? null,
        effectiveTo: r.effectiveTo ?? null,
        active: r.active,
        ...(r.active ? {} : { warning: `${code} is no longer active on Sandbox${r.inactiveReason ? `: ${r.inactiveReason}` : ""}.` }),
      };
    } catch (err) {
      // Defensive: the resolver must never throw into an item save.
      logger.warn({ code, errorKind: err instanceof Error ? err.name : "unknown" }, "HSN resolver error; using the bundled list");
      return fallback("unavailable");
    }
  }

  return {
    resolveHsn,
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

const shared = createHsnResolver(defaultDeps);

export const resolveHsn = shared.resolveHsn;
export const resetHsnLookupForTests = shared.clear;

export interface HsnCheck {
  code: string;
  source: "sandbox" | "bundled";
  sandboxStatus: SandboxStatus;
  valid: boolean;
  description: string | null;
  warning?: string;
}

/**
 * The advisory check run when an item's HSN / SAC is saved. Null for a blank
 * code. Never throws; waits for Sandbox at most HSN_SAVE_TIMEOUT_MS.
 */
export async function checkItemHsn(code: string | null | undefined, opts: ResolveOptions = {}): Promise<HsnCheck | null> {
  const c = code?.trim();
  if (!c) return null;
  const r = await resolveHsn(c, { ...opts, timeoutMs: Math.min(opts.timeoutMs ?? HSN_SAVE_TIMEOUT_MS, HSN_SAVE_TIMEOUT_MS) });
  return {
    code: r.code,
    source: r.source,
    sandboxStatus: r.sandboxStatus,
    valid: r.valid,
    description: r.description,
    ...(r.warning ? { warning: r.warning } : {}),
  };
}
