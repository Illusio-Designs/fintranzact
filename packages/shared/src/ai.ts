/**
 * AI business assistant (Phase 1): the pure rules shared by the API and web.
 *
 * - quota math (monthly included questions by tier, trial cap, extra packs),
 * - the price table and cost estimate,
 * - the answer "cards" the model may attach (validated, never raw HTML),
 * - the roles an owner can switch the assistant off for.
 *
 * Nothing here touches a database, the network or the clock: callers pass `now`.
 */

import { z } from "zod";
import { istDateParts } from "./dates.js";

// ── Tiers and quotas ─────────────────────────────────────────────────────────

/** Questions included per calendar month (IST) by add-on tier. */
export const AI_INCLUDED_QUESTIONS = { assistant: 150, plus: 500 } as const;

/** Questions in one extra pack (credits an admin can grant; the purchase flow is the AI add-on billing work). */
export const AI_PACK_QUESTIONS = 100;

/**
 * Which allowance an organisation is on: "trial" (Full Access Trial, a cap for
 * the whole trial), "assistant" (AI Assistant) or "plus" (AI Plus).
 */
export type AiTier = "trial" | "assistant" | "plus";

export interface AiTierInput {
  /** Entitlements.addons: AI Plus also sets ai_assistant. */
  addons: { ai_assistant: boolean; ai_plus: boolean };
  trialActive: boolean;
  /** Live add-on subscriptions (including one a platform admin granted); a trial is not one. */
  subscribed: { ai_assistant: boolean; ai_plus: boolean };
}

/** The tier in force, or null when the assistant is not available at all. */
export function deriveAiTier(input: AiTierInput): AiTier | null {
  if (!input.addons.ai_assistant && !input.addons.ai_plus) return null;
  if (input.subscribed.ai_plus || (input.addons.ai_plus && !input.trialActive)) return "plus";
  if (input.subscribed.ai_assistant) return "assistant";
  if (input.trialActive) return "trial";
  return "assistant";
}

/** Calendar month in IST, "YYYY-MM": the quota resets when it changes. */
export function aiQuotaPeriod(now: Date): string {
  const { year, month } = istDateParts(now);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * The counter key a question is counted under: the IST month for the paid
 * tiers, and one key for the whole trial (it carries the trial's start so a
 * second trial granted later starts a fresh count).
 */
export function aiCounterKey(tier: AiTier, now: Date, trialStartedAt: Date | null): string {
  if (tier === "trial") return `trial:${trialStartedAt ? trialStartedAt.getTime() : 0}`;
  return aiQuotaPeriod(now);
}

/** Questions the tier includes (the trial cap is an admin setting). */
export function aiIncludedLimit(tier: AiTier, trialCap: number): number {
  if (tier === "trial") return Math.max(0, Math.floor(trialCap));
  return AI_INCLUDED_QUESTIONS[tier];
}

export interface AiAllowance {
  tier: AiTier;
  /** "month" for the paid tiers, "trial" for the whole trial. */
  scope: "month" | "trial";
  limit: number;
  used: number;
  includedRemaining: number;
  creditsRemaining: number;
  /** Questions that can still be asked: included left plus extra-pack credits. */
  remaining: number;
  exhausted: boolean;
}

export function computeAiAllowance(input: { tier: AiTier; trialCap: number; used: number; creditsRemaining: number }): AiAllowance {
  const limit = aiIncludedLimit(input.tier, input.trialCap);
  const used = Math.max(0, Math.floor(input.used));
  const credits = Math.max(0, Math.floor(input.creditsRemaining));
  const includedRemaining = Math.max(0, limit - used);
  const remaining = includedRemaining + credits;
  return {
    tier: input.tier,
    scope: input.tier === "trial" ? "trial" : "month",
    limit,
    used,
    includedRemaining,
    creditsRemaining: credits,
    remaining,
    exhausted: remaining <= 0,
  };
}

/** What a person sees when the questions run out. */
export function aiQuotaExhaustedMessage(allowance: Pick<AiAllowance, "scope" | "tier">, isOwner: boolean): string {
  const base =
    allowance.scope === "trial"
      ? "You have used all the AI questions included in your Full Access Trial."
      : "Your organisation has used all its AI questions for this month. They reset on the 1st.";
  return isOwner
    ? `${base} You can add more from Billing when extra packs are available.`
    : `${base} Ask your owner to add more.`;
}

// ── Organisation controls ────────────────────────────────────────────────────

/**
 * Roles (as the permission system names them) an owner can switch the
 * assistant off for. The owner (superadmin) always keeps it; the accountant
 * access roles (auditor, CA filing) do not have it in Phase 1.
 */
export const AI_SWITCHABLE_ROLES = ["admin", "seller_manager", "seller", "accountant"] as const;
export type AiSwitchableRole = (typeof AI_SWITCHABLE_ROLES)[number];

export const AI_ROLE_LABELS: Record<AiSwitchableRole, string> = {
  admin: "Admin",
  seller_manager: "Sales manager",
  seller: "Salesperson",
  accountant: "Accountant",
};

export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  disabledRoles: z.array(z.enum(AI_SWITCHABLE_ROLES)).max(AI_SWITCHABLE_ROLES.length),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

// ── Prices and cost ──────────────────────────────────────────────────────────

/** Paise per million tokens, as the admin console edits them. */
export interface AiModelPrice {
  inputPaisePerMTok: number;
  outputPaisePerMTok: number;
}
export type AiPriceTable = Record<string, AiModelPrice>;

/** Cached input reads cost a tenth of input, cache writes 1.25 times (Anthropic's published multipliers). */
export const AI_CACHE_READ_FACTOR = 0.1;
export const AI_CACHE_WRITE_FACTOR = 1.25;

export const AI_DEFAULT_MODELS = {
  fast: "claude-haiku-4-5-20251001",
  strong: "claude-sonnet-5-5",
} as const;

/**
 * Estimates, converted at about 85 rupees to the dollar: Haiku 4.5 is $1 in
 * and $5 out per million tokens, Sonnet $3 and $15, Opus $5 and $25. The admin
 * console edits the live table (system_config `ai.prices`).
 */
export const AI_DEFAULT_PRICES: AiPriceTable = {
  "claude-haiku-4-5-20251001": { inputPaisePerMTok: 8_500, outputPaisePerMTok: 42_500 },
  "claude-sonnet-5-5": { inputPaisePerMTok: 25_500, outputPaisePerMTok: 127_500 },
  "claude-opus-5-5": { inputPaisePerMTok: 42_500, outputPaisePerMTok: 212_500 },
};

export const aiPriceTableSchema = z
  .record(
    z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9._:-]+$/, "Model ids use letters, digits and . _ : -"),
    z.object({
      inputPaisePerMTok: z.number().int().min(0).max(100_000_000),
      outputPaisePerMTok: z.number().int().min(0).max(100_000_000),
    }),
  )
  .refine((t) => Object.keys(t).length >= 1 && Object.keys(t).length <= 20, "Between 1 and 20 models");

/** Stored values that are not a valid table fall back to the defaults, so a bad edit never breaks costing. */
export function normaliseAiPrices(raw: unknown): AiPriceTable {
  const parsed = aiPriceTableSchema.safeParse(raw);
  return parsed.success ? parsed.data : AI_DEFAULT_PRICES;
}

export interface AiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Estimated cost in whole paise (rounded up), 0 for a model with no price. */
export function estimateAiCostPaise(prices: AiPriceTable, model: string, usage: AiTokenUsage): number {
  const price = prices[model];
  if (!price) return 0;
  const inputUnits =
    usage.inputTokens +
    (usage.cacheReadTokens ?? 0) * AI_CACHE_READ_FACTOR +
    (usage.cacheWriteTokens ?? 0) * AI_CACHE_WRITE_FACTOR;
  const paise = (inputUnits * price.inputPaisePerMTok + usage.outputTokens * price.outputPaisePerMTok) / 1_000_000;
  return Math.max(0, Math.ceil(paise - 1e-9));
}

// ── Answer cards ─────────────────────────────────────────────────────────────

/** Replace control characters (and, with `angle`, angle brackets) by spaces, without a control-character regex. */
export function stripControlChars(text: string, angle = false): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    out += code < 0x20 || code === 0x7f || (angle && (ch === "<" || ch === ">")) ? " " : ch;
  }
  return out;
}

/** Strip control characters and cap the length: card text comes from the model and is shown as plain text only. */
function clean(max: number) {
  return z
    .union([z.string(), z.number()])
    .transform((v) => stripControlChars(String(v), true).replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max));
}

/** Report ids a link card may open (the reports page ids). */
export const AI_LINK_REPORTS = [
  "outstanding", "ageing", "pnl", "balance-sheet", "cash-flow", "sales-register", "purchase-register", "item-wise-sales",
  "party-statement", "stock-summary", "batch-stock", "expiring-batches", "expired-stock", "reorder-status", "dead-stock",
  "tax-summary", "gstr1", "gstr3b", "daybook", "payment-summary", "collection-metrics",
] as const;

/** Pages a link card may open. */
export const AI_LINK_PAGES = ["dashboard", "invoices", "parties", "items", "reports", "cash-and-bank", "payments", "expenses", "gst"] as const;

export const AI_LINK_PAGE_PATHS: Record<(typeof AI_LINK_PAGES)[number], string> = {
  dashboard: "/",
  invoices: "/invoices",
  parties: "/parties",
  items: "/items",
  reports: "/reports",
  "cash-and-bank": "/cash-and-bank",
  payments: "/payments",
  expenses: "/expenses",
  gst: "/gst",
};

const linkTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("invoice"), id: z.string().uuid() }),
  z.object({ kind: z.literal("report"), report: z.enum(AI_LINK_REPORTS) }),
  z.object({ kind: z.literal("page"), page: z.enum(AI_LINK_PAGES) }),
]);

export const aiTableCardSchema = z
  .object({
    type: z.literal("table"),
    title: clean(80).optional(),
    columns: z.array(clean(40)).min(1).max(6),
    rows: z.array(z.array(clean(120)).max(6)).max(20),
  })
  .refine((c) => c.rows.every((r) => r.length <= c.columns.length), "A row has more cells than columns");

export const aiBarChartCardSchema = z.object({
  type: z.literal("bar_chart"),
  title: clean(80).optional(),
  unit: clean(12).optional(),
  bars: z.array(z.object({ label: clean(30), value: z.number().finite() })).min(1).max(12),
});

export const aiLinkCardSchema = z.object({
  type: z.literal("link"),
  label: clean(60),
  target: linkTargetSchema,
});

export const aiCardSchema = z.union([aiTableCardSchema, aiBarChartCardSchema, aiLinkCardSchema]);

export type AiTableCard = z.infer<typeof aiTableCardSchema>;
export type AiBarChartCard = z.infer<typeof aiBarChartCardSchema>;
export type AiLinkCard = z.infer<typeof aiLinkCardSchema>;
export type AiCard = AiTableCard | AiBarChartCard | AiLinkCard;

export const AI_MAX_CARDS = 4;
/** The raw JSON block the model writes may not be larger than this. */
export const AI_MAX_CARDS_JSON_CHARS = 12_000;

/** Tags that wrap the cards block in the model's final message. */
export const AI_CARDS_OPEN = "<fintranzact_cards>";
export const AI_CARDS_CLOSE = "</fintranzact_cards>";

/**
 * Validate the model's cards: an unknown card type, a link outside the
 * allowlist, an oversized or malformed card is dropped (never rendered); the
 * rest are kept, at most AI_MAX_CARDS.
 */
export function parseAiCards(raw: unknown): { cards: AiCard[]; dropped: number } {
  let value = raw;
  if (typeof value === "string") {
    if (value.length > AI_MAX_CARDS_JSON_CHARS) return { cards: [], dropped: 1 };
    try {
      value = JSON.parse(value);
    } catch {
      return { cards: [], dropped: 1 };
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as { cards?: unknown }).cards)) {
    value = (value as { cards: unknown[] }).cards;
  }
  if (!Array.isArray(value)) return { cards: [], dropped: 1 };
  const cards: AiCard[] = [];
  let dropped = 0;
  for (const item of value) {
    if (cards.length >= AI_MAX_CARDS) {
      dropped++;
      continue;
    }
    const type = item && typeof item === "object" ? (item as { type?: unknown }).type : undefined;
    const schema = type === "table" ? aiTableCardSchema : type === "bar_chart" ? aiBarChartCardSchema : type === "link" ? aiLinkCardSchema : null;
    const parsed = schema ? schema.safeParse(item) : null;
    if (parsed?.success) cards.push(parsed.data as AiCard);
    else dropped++;
  }
  return { cards, dropped };
}

/** The in-app route a validated link card opens (always an allowlisted path). */
export function aiLinkHref(card: AiLinkCard): { to: string; search?: Record<string, string> } {
  const t = card.target;
  if (t.kind === "invoice") return { to: "/invoices", search: { id: t.id } };
  if (t.kind === "report") return { to: "/reports", search: { report: t.report } };
  return { to: AI_LINK_PAGE_PATHS[t.page] };
}

// ── Messages ─────────────────────────────────────────────────────────────────

/** The longest question the assistant accepts. */
export const AI_MAX_QUESTION_CHARS = 1_000;

export const AI_FORBIDDEN_TOOL_MESSAGE = "You do not have access to this information.";
