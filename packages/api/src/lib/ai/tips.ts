/**
 * Proactive tips for the dashboard (Phase 3). DETERMINISTIC: no model is
 * called and no question is used.
 *
 * Every figure is read through the same in-process caller the assistant's tools
 * use, i.e. the person's own permissions: a person who may not read invoices
 * gets no overdue tip, one who may not read reports gets no stock, expiry or GST
 * tip. Only cheap, bounded reads are made, and the result is cached per
 * organisation, business, person and role for AI_TIPS_CACHE_MS. Payroll data is
 * never read.
 *
 * Whether tips are shown at all (add-on, read-only, owner switches, the
 * person's own switch) is decided by `resolveAiTips`, before any data is read.
 */

import { and, eq } from "drizzle-orm";
import { businesses, type TenantDatabase } from "@fintranzact/db";
import {
  AI_TIPS_CACHE_MS,
  expiringBatchesTip,
  gstDueSoon,
  gstDueTip,
  istDateParts,
  lowStockTip,
  overdueTip,
  rankAiTips,
  type AiTip,
  type AiTipsUnavailable,
} from "@fintranzact/shared";
import { getEntitlements } from "../entitlements.js";
import { istDay, round2, toNum } from "./format.js";
import { loadAiAccount } from "./quota.js";
import { aiDisabledReason, getAiSettings } from "./settings.js";
import { getAiUserPrefs } from "./prefs.js";
import type { AiCaller } from "./tools.js";

/** Expiry window of the "expiring soon" tip, in days. */
export const AI_TIP_EXPIRY_DAYS = 30;
/** Most overdue invoices read to add up what is owed (the list's largest page). */
const OVERDUE_SUM_LIMIT = 100;

type Row = Record<string, unknown>;
const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

/** A source that fails or is refused (no permission, nothing set up) simply gives no tip. */
async function attempt<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function overdueSource(caller: AiCaller, now: Date): Promise<AiTip | null> {
  const r = await attempt(() => caller.invoice.list({ type: "sale", status: "overdue", documentType: "invoice", page: 1, limit: OVERDUE_SUM_LIMIT, sortBy: "due", sortDir: "asc" }));
  if (!r || r.total <= 0) return null;
  const rows = rowsOf(r.data);
  const balanceOf = (i: Row) => toNum(i.totalAmount) - toNum(i.amountPaid) - toNum(i.totalAdjusted);
  // Few enough to add up: only invoices that still have a balance count. Many: the count alone.
  const open = r.total <= OVERDUE_SUM_LIMIT ? rows.filter((i) => balanceOf(i) > 0.005) : rows;
  const count = r.total <= OVERDUE_SUM_LIMIT ? open.length : r.total;
  const balance = r.total <= OVERDUE_SUM_LIMIT ? round2(open.reduce((s, i) => s + balanceOf(i), 0)) : null;
  const oldestDue = istDay(open[0]?.dueDate);
  const oldestDays = oldestDue ? Math.floor((now.getTime() - new Date(String(open[0]!.dueDate)).getTime()) / 86_400_000) : null;
  return overdueTip({ count, balance, oldestDue, oldestDaysOverdue: oldestDays });
}

async function lowStockSource(caller: AiCaller): Promise<AiTip | null> {
  const r = await attempt(() => caller.inventoryReports.reorderStatus({ coverDays: 30 }));
  return r ? lowStockTip({ count: rowsOf(r.data).length }) : null;
}

async function batchSource(caller: AiCaller): Promise<AiTip | null> {
  const [expired, expiring] = await Promise.all([
    attempt(() => caller.inventoryReports.batchStock({ status: "expired", days: AI_TIP_EXPIRY_DAYS })),
    attempt(() => caller.inventoryReports.batchStock({ status: "expiring", days: AI_TIP_EXPIRY_DAYS })),
  ]);
  if (!expired && !expiring) return null;
  return expiringBatchesTip({ expired: rowsOf(expired?.data).length, expiring: rowsOf(expiring?.data).length, days: AI_TIP_EXPIRY_DAYS });
}

/** A GST return nearing its due date, only for a regular GST registration that had sales in the month being reported. */
async function gstSource(caller: AiCaller, db: TenantDatabase, businessId: string, now: Date): Promise<AiTip | null> {
  const due = gstDueSoon(now);
  if (!due) return null;
  const [biz] = await db.select({ type: businesses.gstRegistrationType, gstin: businesses.gstin }).from(businesses).where(and(eq(businesses.id, businessId))).limit(1);
  if (!biz || biz.type !== "regular" || !biz.gstin) return null;
  const g = await attempt(() => caller.gst.gstr3b({ year: due.period.year, month: due.period.month }));
  if (!g || toNum(g.outwardSupplies.taxable.taxableValue) <= 0) return null;
  return gstDueTip(due, round2(toNum(g.netTax.total)));
}

/** Compute the tips for the person behind `caller` (no gating, no cache). */
export async function computeAiTips(caller: AiCaller, db: TenantDatabase, businessId: string, now: Date = new Date()): Promise<AiTip[]> {
  // One after the other (not in parallel): each is a small query, the result is cached, and a fixed order keeps the
  // permission checks they make (and so the reviewed role matrix) deterministic.
  const found = [
    await attempt(() => overdueSource(caller, now)),
    await attempt(() => lowStockSource(caller)),
    await attempt(() => batchSource(caller)),
    await attempt(() => gstSource(caller, db, businessId, now)),
  ];
  return rankAiTips(found);
}

// ── Cache ────────────────────────────────────────────────────────────────────

const CACHE_MAX = 500;
const cache = new Map<string, { at: number; tips: AiTip[] }>();

export function clearAiTipsCache(): void {
  cache.clear();
}

async function cachedTips(key: string, now: Date, compute: () => Promise<AiTip[]>): Promise<AiTip[]> {
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < AI_TIPS_CACHE_MS && now.getTime() >= hit.at) return hit.tips;
  const tips = await compute();
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: now.getTime(), tips });
  return tips;
}

// ── The gate ─────────────────────────────────────────────────────────────────

export interface AiTipsResult {
  /** Whether tips are on for this person right now. */
  available: boolean;
  reason: "ok" | AiTipsUnavailable;
  tips: AiTip[];
  /** The IST date the tips were computed for (the card's "dismissed for today" is keyed on it). */
  day: string;
}

/**
 * Tips for the signed-in person, or why there are none. Tips cost no question
 * and are shown even when the monthly questions are used up, but need the
 * add-on (subscribed, admin-granted or a Full Access Trial), a writable
 * organisation, the owner's switches on for the organisation and the role, and
 * the person's own tips switch on. Nothing is read when any of those is off.
 */
export async function resolveAiTips(
  ctx: { tenantId: string; businessId: string; userId: string; role: string; db: TenantDatabase },
  caller: AiCaller,
  now: Date = new Date(),
): Promise<AiTipsResult> {
  const p = istDateParts(now);
  const day = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const off = (reason: AiTipsUnavailable): AiTipsResult => ({ available: false, reason, tips: [], day });

  const ent = await getEntitlements(ctx.tenantId);
  if (ent.reason === "tenant_suspended") return off("suspended");
  if (ent.readOnly) return off("read_only");
  if (!(await loadAiAccount(ctx.tenantId, ent, now))) return off("addon_required");
  const switchReason = aiDisabledReason(await getAiSettings(ctx.tenantId), ctx.role);
  if (switchReason) return off(switchReason);
  const prefs = await getAiUserPrefs(ctx.db, ctx.businessId, ctx.userId);
  if (!prefs.tipsEnabled) return off("tips_off");

  const tips = await cachedTips(`${ctx.tenantId}:${ctx.businessId}:${ctx.userId}:${ctx.role}`, now, () => computeAiTips(caller, ctx.db, ctx.businessId, now));
  return { available: true, reason: "ok", tips, day };
}
