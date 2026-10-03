/**
 * gst-track.ts — return-filing status from "Track GST Returns": financial-year
 * labels, the prerequisite verdict for filing, and a never-throwing cached
 * resolver. The HTTP call is in sandbox/gst-track.ts.
 */

import { SandboxClient } from "./sandbox/client.js";
import { trackGstReturns, TrackError, type TrackedReturn } from "./sandbox/gst-track.js";

export type FilingFrequency = "monthly" | "quarterly";
export type ReturnKind = "gstr1" | "gstr3b";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "082026" -> "Aug 2026". */
export function periodLabel(period: string): string {
  return `${MONTHS[Number(period.slice(0, 2)) - 1]} ${period.slice(2)}`;
}

/** Indian financial year of a return period "MMYYYY" or calendar year+month: starts in April. */
export function fyStartYear(period: { year: number; month: number } | string): number {
  const { year, month } = typeof period === "string" ? { year: Number(period.slice(2)), month: Number(period.slice(0, 2)) } : period;
  return month >= 4 ? year : year - 1;
}

/** 2025 -> "FY 2025-26" (the literal "FY " prefix the API requires). */
export function financialYearLabel(startYear: number): string {
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** The 12 periods "MMYYYY" of a financial year, April first. */
export function fyPeriods(startYear: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const month = ((3 + i) % 12) + 1;
    const year = month >= 4 ? startYear : startYear + 1;
    out.push(`${String(month).padStart(2, "0")}${year}`);
  }
  return out;
}

const idx = (period: string) => Number(period.slice(2)) * 12 + Number(period.slice(0, 2));
const fromIdx = (i: number) => {
  const year = Math.floor((i - 1) / 12);
  return `${String(i - year * 12).padStart(2, "0")}${year}`;
};

/** The period a return is filed for under the frequency: quarter-end month for quarterly filers (VERIFY how QRMP shows in ret_prd). */
function periodFor(period: string, frequency: FilingFrequency): string {
  if (frequency === "monthly") return period;
  const m = Number(period.slice(0, 2));
  const qEnd = [3, 6, 9, 12].find((q) => q >= m)!;
  return `${String(qEnd).padStart(2, "0")}${period.slice(2)}`;
}

/** Find a filed record of `kind` for `period` (any valid-or-not Filed record; `valid` is reported, not used to block: VERIFY). */
export function findFiled(filings: TrackedReturn[], kind: string, period: string): TrackedReturn | null {
  return filings.find((f) => f.returnType === kind && f.period === period && f.filed) ?? null;
}

export interface MissingReturn {
  returnType: ReturnKind;
  period: string;
  label: string;
}

export type PrereqVerdict = "ok" | "missing" | "unknown" | "skipped";

export interface PrereqResult {
  verdict: PrereqVerdict;
  missing: MissingReturn[];
  /** The return itself, when the portal already shows it as filed. */
  alreadyFiled: { arn: string | null; filedOn: string | null; valid: boolean | null } | null;
  notes: string[];
}

/**
 * The prerequisite verdict for filing `kind` for `period`.
 *  - composition dealers file GSTR-4 / CMP-08: skipped.
 *  - every earlier period of the financial year (and March of the previous one
 *    for April) must be filed for the same return type; periods before the
 *    first filing we can see are not demanded (registration date unknown).
 *  - GSTR-3B also needs GSTR-1 of the SAME period.
 *  - quarterly filers are checked on quarter-end months; the frequency is not
 *    stored by the app, so callers pass "monthly" and the note says so.
 *  - `filings` holds the tracked returns of the period's FY (and the previous
 *    FY when the caller fetched it). `null` means the portal could not be reached.
 */
export function derivePrerequisite(opts: {
  kind: ReturnKind;
  /** Return period "MMYYYY". */
  period: string;
  filings: TrackedReturn[] | null;
  frequency?: FilingFrequency;
  composition?: boolean;
  frequencyAssumed?: boolean;
}): PrereqResult {
  const { kind, filings } = opts;
  const frequency = opts.frequency ?? "monthly";
  const notes: string[] = [];
  const none: PrereqResult = { verdict: "ok", missing: [], alreadyFiled: null, notes };

  if (opts.composition) {
    return { ...none, verdict: "skipped", notes: ["Composition dealers file GSTR-4 and CMP-08; the monthly return prerequisites do not apply."] };
  }
  if (filings === null) {
    return { ...none, verdict: "unknown", notes: ["Could not verify earlier returns with the GST portal."] };
  }
  if (opts.frequencyAssumed) notes.push("The filing frequency is not recorded, so monthly filing is assumed.");

  const target = periodFor(opts.period, frequency);
  const own = findFiled(filings, kind, target);
  const alreadyFiled = own ? { arn: own.arn, filedOn: own.filedOn, valid: own.valid } : null;

  const step = frequency === "monthly" ? 1 : 3;
  const ofKind = filings.filter((f) => f.returnType === kind && f.filed);
  const missing: MissingReturn[] = [];

  if (ofKind.length === 0 && !own) {
    // Nothing filed in the periods we looked at: first-ever return, or a long gap. Do not block on a guess.
    notes.push("No earlier " + (kind === "gstr1" ? "GSTR-1" : "GSTR-3B") + " found on the GST portal. If this is your first return you can continue.");
  } else {
    const first = Math.min(...ofKind.map((f) => idx(f.period)), own ? idx(own.period) : Infinity);
    const startIdx = Math.max(first, idx(fyPeriods(fyStartYear(target))[0]!) - 1); // include March of the previous FY
    for (let i = startIdx; i < idx(target); i += step) {
      const p = fromIdx(i);
      if (idx(p) < first) continue;
      if (!findFiled(filings, kind, p)) missing.push({ returnType: kind, period: p, label: `${kind === "gstr1" ? "GSTR-1" : "GSTR-3B"} ${periodLabel(p)}` });
    }
  }

  if (kind === "gstr3b" && !findFiled(filings, "gstr1", target)) {
    missing.push({ returnType: "gstr1", period: target, label: `GSTR-1 ${periodLabel(target)}` });
  }

  return { verdict: missing.length ? "missing" : "ok", missing, alreadyFiled, notes };
}

/** A user-facing sentence for a "missing" verdict. */
export function missingMessage(r: PrereqResult): string {
  return `File these returns first: ${r.missing.map((m) => m.label).join(", ")}.`;
}

// ── Resolver ─────────────────────────────────────────────────

export type TrackResult =
  | { status: "ok"; filings: TrackedReturn[]; fetchedAt: number; cached: boolean }
  | { status: "unavailable"; reason: string };

export interface ResolverDeps {
  sandbox: () => SandboxClient | null;
  now?: () => number;
  /** How long a display answer is reused. */
  ttlMs?: number;
  track?: typeof trackGstReturns;
}

export const TRACK_CACHE_TTL_MS = 5 * 60 * 1000;

export class GstTrackResolver {
  private readonly cache = new Map<string, { at: number; filings: TrackedReturn[] }>();
  private readonly now: () => number;
  private readonly ttl: number;
  private readonly trackFn: typeof trackGstReturns;

  constructor(private readonly deps: ResolverDeps) {
    this.now = deps.now ?? Date.now;
    this.ttl = deps.ttlMs ?? TRACK_CACHE_TTL_MS;
    this.trackFn = deps.track ?? trackGstReturns;
  }

  /**
   * Returns of one FY. `fresh: true` (pre-filing checks) bypasses the local
   * cache and does not send x-accept-cache; otherwise a 5-minute cache and
   * x-accept-cache apply. Never throws.
   */
  async track(gstin: string, startYear: number, opts: { fresh?: boolean } = {}): Promise<TrackResult> {
    const key = `${gstin}:${startYear}`;
    const hit = this.cache.get(key);
    if (!opts.fresh && hit && this.now() - hit.at < this.ttl) {
      return { status: "ok", filings: hit.filings, fetchedAt: hit.at, cached: true };
    }
    const sandbox = this.deps.sandbox();
    if (!sandbox) return { status: "unavailable", reason: "Sandbox is not configured on this server." };
    try {
      const filings = await this.trackFn(sandbox, gstin, financialYearLabel(startYear), { cache: !opts.fresh });
      const at = this.now();
      this.cache.set(key, { at, filings });
      return { status: "ok", filings, fetchedAt: at, cached: false };
    } catch (err) {
      const reason = err instanceof TrackError ? err.message : "The GST return tracker could not be reached.";
      return { status: "unavailable", reason };
    }
  }

  /** The prerequisite verdict, always from fresh data. Never throws. */
  async prerequisite(opts: {
    gstin: string;
    kind: ReturnKind;
    period: string;
    composition?: boolean;
    frequency?: FilingFrequency;
  }): Promise<PrereqResult> {
    const frequency = opts.frequency ?? "monthly";
    const frequencyAssumed = !opts.frequency;
    if (opts.composition) return derivePrerequisite({ ...opts, filings: [], frequency, frequencyAssumed });
    try {
      const fy = fyStartYear(opts.period);
      const month = Number(opts.period.slice(0, 2));
      const needsPrevious = frequency === "monthly" ? month === 4 : month >= 4 && month <= 6;
      const [cur, prev] = await Promise.all([
        this.track(opts.gstin, fy, { fresh: true }),
        needsPrevious ? this.track(opts.gstin, fy - 1, { fresh: true }) : Promise.resolve(null),
      ]);
      if (cur.status !== "ok" || (prev && prev.status !== "ok")) {
        const r = derivePrerequisite({ ...opts, filings: null, frequency, frequencyAssumed });
        return { ...r, notes: [cur.status === "unavailable" ? cur.reason : "Could not verify earlier returns with the GST portal."] };
      }
      return derivePrerequisite({
        ...opts,
        filings: [...cur.filings, ...(prev && prev.status === "ok" ? prev.filings : [])],
        frequency,
        frequencyAssumed,
      });
    } catch {
      return derivePrerequisite({ ...opts, filings: null, frequency, frequencyAssumed });
    }
  }
}

// ── Business-scoped limiter for uncached refreshes ───────────

/** At most `max` uncached tracker calls per business per minute. */
export class RefreshLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly max = 6, private readonly windowMs = 60_000, private readonly now: () => number = Date.now) {}
  take(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }
}
