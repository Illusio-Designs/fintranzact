/**
 * hsn-refresh.ts — daily re-verification of the HSN / SAC codes customers use.
 *
 * Sandbox is assumed to have no bulk list endpoint, so instead of mirroring
 * the master we re-check, through the same resolver and adapter the item form
 * uses, the codes items actually carry:
 *   1. collect the distinct codes in use across tenants,
 *   2. take up to HSN_REFRESH_BATCH (default 200, max 1000) of them, never
 *      checked first, then oldest check first,
 *   3. look each up on Sandbox (live only, paced inside the resolver's
 *      per-minute guard) and record the answer in hsn_sandbox_codes,
 *   4. when a code Sandbox now calls withdrawn or inactive is still on items,
 *      raise one platform notice (a billing_events row, only when the set of
 *      codes changes) and keep the counts in system_config "hsn_refresh".
 *
 * The resolver reads hsn_sandbox_codes as its middle layer (source "refreshed").
 * Never edits a customer's items. Never throws out of the job, is safe to run
 * twice (rows are upserted, a row checked in the last 20 h is skipped), logs
 * counts only. Skipped silently when Sandbox is not configured, when
 * HSN_SANDBOX_LOOKUP=off or HSN_REFRESH=off.
 */

import { createHash } from "node:crypto";
import { and, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { billingEvents, controlDb, getTenantDb, hsnSandboxCodes, items, systemConfig, tenants } from "@fintranzact/db";
import { logger } from "./logger.js";
import { useSandboxProvider } from "./gov-provider.js";
import { HSN_REFRESHED_MAX_AGE_MS, hsnSettingsFromEnv, resolveHsn, type HsnResolution } from "./hsn-lookup.js";
import { HSN_CODE_RE } from "./sandbox/hsn.js";

export const HSN_REFRESH_DEFAULT_BATCH = 200;
export const HSN_REFRESH_MAX_BATCH = 1000;
/** A code checked more recently than this is left alone (makes a second run a no-op). */
export const HSN_REFRESH_MIN_AGE_MS = 20 * 60 * 60 * 1000;
/** The scheduler runs the job when the last run is at least this old. */
export const HSN_REFRESH_INTERVAL_MS = 23 * 60 * 60 * 1000;
/** Pause between Sandbox calls, to stay inside the resolver's 60 a minute guard. */
export const HSN_REFRESH_PACING_MS = 1300;
/** Consecutive Sandbox failures after which the run stops early. */
export const HSN_REFRESH_MAX_FAILURES_IN_A_ROW = 3;
const STATE_KEY = "hsn_refresh";
const NOTICE_CODES_LISTED = 20;

export interface RefreshRow {
  code: string;
  kind: "hsn" | "sac";
  description: string;
  rate: number | null;
  active: boolean;
  inactiveReason: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: "ok" | "not_found";
}

export interface HsnRefreshSummary {
  /** Codes looked up on Sandbox this run. */
  attempted: number;
  /** Answers stored (found + not found). */
  recorded: number;
  found: number;
  notFound: number;
  /** Lookups Sandbox could not answer. */
  unavailable: number;
  /** Rows that could not be written. */
  failed: number;
  /** Distinct withdrawn / inactive codes still used by items (all stored rows under 30 days old). */
  withdrawnInUse: number;
  /** Items carrying one of those codes. */
  itemsAffected: number;
  withdrawnCodes: string[];
}

export type HsnRefreshResult =
  | { ran: false; reason: "disabled" | "not_configured" | "error" }
  | { ran: true; summary: HsnRefreshSummary; stoppedEarly: boolean };

export interface HsnRefreshDeps {
  /** HSN_REFRESH, HSN_SANDBOX_LOOKUP and Sandbox keys. */
  status: () => "ready" | "disabled" | "not_configured";
  batchSize: () => number;
  /** Distinct HSN / SAC codes on items across tenants, with how many items carry each. */
  usedCodes: () => Promise<Map<string, number>>;
  /** ms since epoch of each code's last check (only codes that have a row). */
  checkedAt: (codes: string[]) => Promise<Map<string, number>>;
  /** Sandbox's own answer; never the refreshed layer. */
  lookup: (code: string) => Promise<HsnResolution>;
  save: (row: RefreshRow, at: number) => Promise<void>;
  /** Codes whose latest stored answer (under 30 days old) is inactive. */
  inactiveCodes: (sinceMs: number) => Promise<string[]>;
  /** Called once per run that got as far as the end. */
  finish: (summary: HsnRefreshSummary, at: number) => Promise<void>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  pacingMs: number;
}

export function hsnRefreshBatchFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.HSN_REFRESH_BATCH);
  if (!Number.isFinite(n) || n < 1) return HSN_REFRESH_DEFAULT_BATCH;
  return Math.min(Math.floor(n), HSN_REFRESH_MAX_BATCH);
}

/** Never checked first, then oldest check first; busier codes and then code order break ties. */
export function selectForRefresh(
  used: Map<string, number>,
  checked: Map<string, number>,
  now: number,
  cap: number,
  minAgeMs: number = HSN_REFRESH_MIN_AGE_MS,
): string[] {
  const due: Array<{ code: string; at: number; n: number }> = [];
  for (const [code, n] of used) {
    if (!HSN_CODE_RE.test(code)) continue;
    const at = checked.get(code) ?? -Infinity;
    if (now - at < minAgeMs) continue;
    due.push({ code, at, n });
  }
  due.sort((a, b) => (a.at === b.at ? b.n - a.n || (a.code < b.code ? -1 : 1) : a.at < b.at ? -1 : 1));
  return due.slice(0, Math.max(0, cap)).map((d) => d.code);
}

function rowFrom(code: string, r: HsnResolution): RefreshRow | null {
  if (r.sandboxStatus === "ok" && r.source === "sandbox" && r.sandbox) {
    const s = r.sandbox;
    return {
      code,
      kind: s.kind,
      description: s.description,
      rate: s.rate ?? null,
      active: s.active,
      inactiveReason: s.active ? null : s.inactiveReason ?? null,
      effectiveFrom: s.effectiveFrom ?? null,
      effectiveTo: s.effectiveTo ?? null,
      status: "ok",
    };
  }
  if (r.sandboxStatus === "not_found") {
    return {
      code,
      kind: code.startsWith("99") ? "sac" : "hsn",
      description: "",
      rate: null,
      active: true,
      inactiveReason: null,
      effectiveFrom: null,
      effectiveTo: null,
      status: "not_found",
    };
  }
  return null;
}

/** Run one refresh. Never throws. */
export async function refreshHsnCodes(deps: HsnRefreshDeps = defaultDeps): Promise<HsnRefreshResult> {
  try {
    const status = deps.status();
    if (status !== "ready") return { ran: false, reason: status };

    const used = await deps.usedCodes();
    const startedAt = deps.now();
    const checked = await deps.checkedAt([...used.keys()]);
    const batch = selectForRefresh(used, checked, startedAt, deps.batchSize());

    const s: HsnRefreshSummary = {
      attempted: 0,
      recorded: 0,
      found: 0,
      notFound: 0,
      unavailable: 0,
      failed: 0,
      withdrawnInUse: 0,
      itemsAffected: 0,
      withdrawnCodes: [],
    };
    let inARow = 0;
    let stoppedEarly = false;

    for (const [i, code] of batch.entries()) {
      if (i > 0 && deps.pacingMs > 0) await deps.sleep(deps.pacingMs);
      s.attempted++;
      let r: HsnResolution;
      try {
        r = await deps.lookup(code);
      } catch {
        s.unavailable++;
        if (++inARow >= HSN_REFRESH_MAX_FAILURES_IN_A_ROW) {
          stoppedEarly = true;
          break;
        }
        continue;
      }
      if (r.sandboxStatus === "not_configured" || r.sandboxStatus === "skipped") {
        stoppedEarly = true;
        break;
      }
      const row = rowFrom(code, r);
      if (!row) {
        s.unavailable++;
        if (++inARow >= HSN_REFRESH_MAX_FAILURES_IN_A_ROW) {
          stoppedEarly = true;
          break;
        }
        continue;
      }
      inARow = 0;
      try {
        await deps.save(row, deps.now());
        s.recorded++;
        if (row.status === "ok") s.found++;
        else s.notFound++;
      } catch {
        s.failed++;
      }
    }

    // Withdrawn codes that items still use, across everything stored in the last 30 days.
    try {
      const inactive = await deps.inactiveCodes(deps.now() - HSN_REFRESHED_MAX_AGE_MS);
      const hit = inactive.filter((c) => used.has(c)).sort();
      s.withdrawnCodes = hit;
      s.withdrawnInUse = hit.length;
      s.itemsAffected = hit.reduce((n, c) => n + (used.get(c) ?? 0), 0);
    } catch {
      /* counts stay 0 */
    }

    try {
      await deps.finish(s, deps.now());
    } catch {
      /* notice and state are best effort */
    }
    // Counts only: no codes, keys or answers in the log.
    logger.info(
      { attempted: s.attempted, recorded: s.recorded, found: s.found, notFound: s.notFound, unavailable: s.unavailable, failed: s.failed, withdrawnInUse: s.withdrawnInUse, itemsAffected: s.itemsAffected, stoppedEarly },
      "HSN refresh finished",
    );
    return { ran: true, summary: s, stoppedEarly };
  } catch {
    logger.warn("HSN refresh failed; nothing was changed for customers");
    return { ran: false, reason: "error" };
  }
}

// ── Default dependencies (databases and the shared resolver) ───

const isMultiTenant = () => process.env.MULTI_TENANT === "true";

async function usedCodes(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const add = (rows: Array<{ hsn: string | null; n: number }>) => {
    for (const r of rows) {
      const code = r.hsn?.trim();
      if (code) out.set(code, (out.get(code) ?? 0) + Number(r.n));
    }
  };
  const one = async (tenantId: string) => {
    const db = await getTenantDb(tenantId);
    add(
      await db
        .select({ hsn: items.hsn, n: sql<number>`count(*)::int` })
        .from(items)
        .where(isNotNull(items.hsn))
        .groupBy(items.hsn),
    );
  };
  if (!isMultiTenant()) {
    await one("single");
  } else {
    const active = await controlDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, "active"));
    for (const t of active) {
      try {
        await one(t.id);
      } catch {
        /* one tenant being unreachable must not stop the rest */
      }
    }
  }
  return out;
}

async function checkedAt(codes: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < codes.length; i += 5000) {
    const rows = await controlDb
      .select({ code: hsnSandboxCodes.code, at: hsnSandboxCodes.checkedAt })
      .from(hsnSandboxCodes)
      .where(inArray(hsnSandboxCodes.code, codes.slice(i, i + 5000)));
    for (const r of rows) out.set(r.code, r.at.getTime());
  }
  return out;
}

async function save(row: RefreshRow, at: number): Promise<void> {
  const values = {
    kind: row.kind,
    description: row.description,
    rate: row.rate === null ? null : String(row.rate),
    active: row.active,
    inactiveReason: row.inactiveReason,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    status: row.status,
    source: "sandbox",
    checkedAt: new Date(at),
  };
  await controlDb
    .insert(hsnSandboxCodes)
    .values({ code: row.code, ...values })
    .onConflictDoUpdate({ target: hsnSandboxCodes.code, set: values });
}

async function inactiveCodes(sinceMs: number): Promise<string[]> {
  const rows = await controlDb
    .select({ code: hsnSandboxCodes.code })
    .from(hsnSandboxCodes)
    .where(and(eq(hsnSandboxCodes.status, "ok"), eq(hsnSandboxCodes.active, false), gt(hsnSandboxCodes.checkedAt, new Date(sinceMs))));
  return rows.map((r) => r.code);
}

export interface HsnRefreshState {
  lastRunAt: string;
  attempted: number;
  recorded: number;
  withdrawnInUse: number;
  itemsAffected: number;
  /** First few withdrawn codes still in use. */
  withdrawnCodes: string[];
  /** Fingerprint of the withdrawn set the last notice was raised for. */
  noticeKey: string | null;
}

export async function getHsnRefreshState(): Promise<HsnRefreshState | null> {
  try {
    const [row] = await controlDb.select({ value: systemConfig.value }).from(systemConfig).where(eq(systemConfig.key, STATE_KEY)).limit(1);
    const v = row?.value as Partial<HsnRefreshState> | undefined;
    return v && typeof v.lastRunAt === "string" ? (v as HsnRefreshState) : null;
  } catch {
    return null;
  }
}

async function finish(s: HsnRefreshSummary, at: number): Promise<void> {
  const previous = await getHsnRefreshState();
  const noticeKey = s.withdrawnInUse > 0 ? createHash("sha256").update(s.withdrawnCodes.join(",")).digest("hex").slice(0, 16) : null;
  // One platform notice per distinct set of withdrawn codes in use (the same
  // set on the next daily run raises nothing new).
  if (noticeKey && noticeKey !== previous?.noticeKey) {
    const message = `${s.withdrawnInUse} HSN / SAC code${s.withdrawnInUse === 1 ? "" : "s"} no longer active on Sandbox ${s.withdrawnInUse === 1 ? "is" : "are"} still used by ${s.itemsAffected} item${s.itemsAffected === 1 ? "" : "s"}. Customers see a warning when they save such an item; their items are not changed.`;
    await controlDb.insert(billingEvents).values({
      provider: "local",
      type: "sandbox.hsn_withdrawn_in_use",
      payload: { message, withdrawnInUse: s.withdrawnInUse, itemsAffected: s.itemsAffected, codes: s.withdrawnCodes.slice(0, NOTICE_CODES_LISTED) },
    });
  }
  const value: HsnRefreshState = {
    lastRunAt: new Date(at).toISOString(),
    attempted: s.attempted,
    recorded: s.recorded,
    withdrawnInUse: s.withdrawnInUse,
    itemsAffected: s.itemsAffected,
    withdrawnCodes: s.withdrawnCodes.slice(0, NOTICE_CODES_LISTED),
    noticeKey: noticeKey ?? null,
  };
  await controlDb
    .insert(systemConfig)
    .values({ key: STATE_KEY, value })
    .onConflictDoUpdate({ target: systemConfig.key, set: { value, updatedAt: new Date(at) } });
}

const defaultDeps: HsnRefreshDeps = {
  status: () => {
    if ((process.env.HSN_REFRESH ?? "on").trim().toLowerCase() === "off") return "disabled";
    if (!hsnSettingsFromEnv().enabled) return "disabled";
    return useSandboxProvider() ? "ready" : "not_configured";
  },
  batchSize: () => hsnRefreshBatchFromEnv(),
  usedCodes,
  checkedAt,
  lookup: (code) => resolveHsn(code, { liveOnly: true }),
  save,
  inactiveCodes,
  finish,
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  pacingMs: HSN_REFRESH_PACING_MS,
};

// ── Daily scheduler ────────────────────────────────────────────

const TICK_MS = 60 * 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (defaultDeps.status() !== "ready") return;
    const state = await getHsnRefreshState();
    if (state && Date.now() - Date.parse(state.lastRunAt) < HSN_REFRESH_INTERVAL_MS) return;
    await refreshHsnCodes();
  } catch {
    /* never throws out of the timer */
  } finally {
    running = false;
  }
}

export function startHsnRefreshScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  // First check shortly after boot rather than an hour later.
  const boot = setTimeout(() => void tick(), 60_000);
  boot.unref();
}

export function stopHsnRefreshScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
