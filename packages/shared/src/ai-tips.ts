/**
 * AI business assistant (Phase 3): proactive tips for the dashboard.
 *
 * Tips are DETERMINISTIC: the server counts things in the books through the
 * person's own permissions and these pure builders turn the counts into short
 * English sentences. No model is called and no question is used. Every link is
 * an allowlisted target (aiLinkTargetSchema), never a free URL.
 *
 * Nothing here touches a database, the network or the clock: callers pass `now`.
 */

import { z } from "zod";
import { aiCleanText, aiLinkTargetSchema } from "./ai.js";
import { istDateParts, istStartOfDay } from "./dates.js";

export const AI_TIP_KINDS = ["overdue_invoices", "low_stock", "expiring_batches", "gst_due"] as const;
export type AiTipKind = (typeof AI_TIP_KINDS)[number];

export const AI_TIP_SEVERITIES = ["info", "warning", "critical"] as const;
export type AiTipSeverity = (typeof AI_TIP_SEVERITIES)[number];

/** At most this many tips are shown. */
export const AI_MAX_TIPS = 4;

/** How long the server keeps computed tips for a person and business. */
export const AI_TIPS_CACHE_MS = 5 * 60_000;

export const aiTipSchema = z.object({
  /** Stable for the condition (so "dismissed for today" survives a refresh). */
  id: z.string().min(1).max(60),
  kind: z.enum(AI_TIP_KINDS),
  severity: z.enum(AI_TIP_SEVERITIES),
  text: aiCleanText(240),
  /** A question the person can send to the assistant about this tip (prefilled, never sent automatically). */
  ask: aiCleanText(200).optional(),
  link: z.object({ label: aiCleanText(60), target: aiLinkTargetSchema }),
});
export type AiTip = z.infer<typeof aiTipSchema>;

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COUNT = new Intl.NumberFormat("en-IN");

/** ₹ with lakh and crore grouping: 1234567.5 -> "₹12,34,567.50". */
export function aiTipInr(value: number): string {
  return INR.format(Number.isFinite(value) ? value : 0);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-08-02" -> "2 Aug 2026". */
export function aiTipDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}`;
}

const plural = (n: number, one: string, many: string) => `${COUNT.format(n)} ${n === 1 ? one : many}`;

// ── GST due dates ────────────────────────────────────────────────────────────

/** GSTR-1 for a month is due on the 11th of the next month, GSTR-3B on the 20th (the statutory dates for monthly filers; extensions are by notification). */
export const GSTR1_DUE_DAY = 11;
export const GSTR3B_DUE_DAY = 20;
/** The tip appears this many days before the due date and on the day itself. */
export const GST_TIP_LEAD_DAYS = 7;

export interface GstDueSoon {
  kind: "gstr1" | "gstr3b";
  /** The month being reported (the previous calendar month). */
  period: { year: number; month: number };
  /** YYYY-MM-DD */
  dueDate: string;
  /** 0 = due today. */
  daysLeft: number;
}

const ymdOf = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * The monthly return nearest to its due date, when one is due today or within
 * the next GST_TIP_LEAD_DAYS days (India time), else null. After the due date
 * nothing is said: whether it was filed is not known here.
 */
export function gstDueSoon(now: Date): GstDueSoon | null {
  const { year, month, day } = istDateParts(now);
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const candidates: GstDueSoon[] = [];
  for (const [kind, dueDay] of [["gstr1", GSTR1_DUE_DAY], ["gstr3b", GSTR3B_DUE_DAY]] as const) {
    const daysLeft = Math.round((istStartOfDay(year, month, dueDay).getTime() - istStartOfDay(year, month, day).getTime()) / 86_400_000);
    if (daysLeft >= 0 && daysLeft <= GST_TIP_LEAD_DAYS) candidates.push({ kind, period: prev, dueDate: ymdOf(year, month, dueDay), daysLeft });
  }
  return candidates.sort((a, b) => a.daysLeft - b.daysLeft)[0] ?? null;
}

const periodLabel = (p: { year: number; month: number }) => `${MONTHS_LONG[p.month - 1]} ${p.year}`;

// ── Tip builders ─────────────────────────────────────────────────────────────

export function overdueTip(input: { count: number; /** null when the total is not known (too many to add up) */ balance: number | null; oldestDue: string | null; oldestDaysOverdue: number | null }): AiTip | null {
  if (input.count <= 0) return null;
  const money = input.balance !== null && input.balance > 0 ? ` (${aiTipInr(input.balance)} to collect)` : "";
  const oldest = input.oldestDue ? ` The oldest was due on ${aiTipDate(input.oldestDue)}.` : "";
  return {
    id: "overdue_invoices",
    kind: "overdue_invoices",
    severity: (input.oldestDaysOverdue ?? 0) >= 60 ? "critical" : "warning",
    text: `${plural(input.count, "invoice is", "invoices are")} overdue${money}.${oldest}`,
    ask: "Which customers have overdue invoices, and how much does each owe?",
    link: { label: "Open the Outstanding report", target: { kind: "report", report: "outstanding" } },
  };
}

export function lowStockTip(input: { count: number }): AiTip | null {
  if (input.count <= 0) return null;
  return {
    id: "low_stock",
    kind: "low_stock",
    severity: "warning",
    text: input.count === 1 ? "Stock of 1 item is below its reorder level." : `Stock of ${COUNT.format(input.count)} items is below their reorder level.`,
    ask: "Which items are below their reorder level, and how much should I order?",
    link: { label: "Open the Reorder status report", target: { kind: "report", report: "reorder-status" } },
  };
}

export function expiringBatchesTip(input: { expired: number; expiring: number; days: number }): AiTip | null {
  const { expired, expiring, days } = input;
  if (expired <= 0 && expiring <= 0) return null;
  const parts: string[] = [];
  if (expired > 0) parts.push(`${plural(expired, "batch has", "batches have")} expired`);
  if (expiring > 0) parts.push(`${plural(expiring, "batch expires", "batches expire")} in the next ${days} days`);
  return {
    id: "expiring_batches",
    kind: "expiring_batches",
    severity: expired > 0 ? "critical" : "warning",
    text: `${parts.join(" and ")}.`,
    ask: `Which batches have expired or expire in the next ${days} days?`,
    link: expired > 0
      ? { label: "Open the Expired stock report", target: { kind: "report", report: "expired-stock" } }
      : { label: "Open the Expiring batches report", target: { kind: "report", report: "expiring-batches" } },
  };
}

export function gstDueTip(due: GstDueSoon, netPayable: number | null): AiTip {
  const name = due.kind === "gstr1" ? "GSTR-1" : "GSTR-3B";
  const when = due.daysLeft === 0 ? "today" : due.daysLeft === 1 ? "tomorrow" : `in ${due.daysLeft} days`;
  const payable = due.kind === "gstr3b" && netPayable !== null && netPayable > 0 ? ` Your books show ${aiTipInr(netPayable)} net GST payable.` : "";
  return {
    id: `gst_due:${due.kind}:${due.period.year}-${String(due.period.month).padStart(2, "0")}`,
    kind: "gst_due",
    severity: due.daysLeft <= 2 ? "warning" : "info",
    text: `${name} for ${periodLabel(due.period)} is due ${when} (${aiTipDate(due.dueDate)}).${payable}`,
    ask: due.kind === "gstr1" ? `Summarise my sales for GSTR-1 for ${periodLabel(due.period)}` : `What is my GST payable for ${periodLabel(due.period)}?`,
    link: { label: `Open ${name}`, target: { kind: "report", report: due.kind } },
  };
}

// ── Ranking ──────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<AiTipSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** Most urgent first (critical, warning, info), then in the fixed kind order; at most AI_MAX_TIPS, each re-validated. */
export function rankAiTips(tips: ReadonlyArray<AiTip | null | undefined>): AiTip[] {
  return tips
    .flatMap((t) => {
      if (!t) return [];
      const r = aiTipSchema.safeParse(t);
      return r.success ? [r.data] : [];
    })
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || AI_TIP_KINDS.indexOf(a.kind) - AI_TIP_KINDS.indexOf(b.kind))
    .slice(0, AI_MAX_TIPS);
}

/** Why tips are not available, for the dashboard card and tests. */
export type AiTipsUnavailable = "addon_required" | "org_disabled" | "role_disabled" | "read_only" | "suspended" | "tips_off";
