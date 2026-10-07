/**
 * The AI assistant's bookkeeping: starting a question (gate, quota, history,
 * ledger row, audit), finishing or refunding it, and each person's own
 * conversation history.
 *
 * Placement (docs/architecture/ai-assistant.md): quota counters, credit packs,
 * the usage ledger and the owner's switches are organisation-level control-database
 * tables; conversations and messages are business data in the tenant database,
 * private to the person who had the chat (user_id).
 */

import { and, asc, desc, eq, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { aiConversations, aiMessages, aiUsage, controlDb, type TenantDatabase } from "@fintranzact/db";
import {
  AI_MAX_QUESTION_CHARS,
  aiActionKindsFor,
  aiQuotaExhaustedMessage,
  estimateAiCostPaise,
  parseTrustedAiCards,
  type AiActionKind,
  type AiAllowance,
  type AiAnyCard,
  type AiTier,
  type AiTokenUsage,
} from "@fintranzact/shared";
import { logAudit } from "../audit.js";
import type { AppAbility } from "../permissions.js";
import { limitError } from "../entitlement-error.js";
import { getEntitlements } from "../entitlements.js";
import { assertAi, assertAiSwitchedOn, AI_NOT_CONFIGURED_MESSAGE } from "./access.js";
import { isAiConfigured } from "./client.js";
import { clip } from "./format.js";
import { consumeQuestion, loadAiAccount, refundQuestion } from "./quota.js";
import { aiActionsDisabledReason, aiDisabledReason, getAiPrices, getAiSettings } from "./settings.js";
import { loadActionCards } from "./actions/service.js";
import type { AiMessage } from "./client.js";

export interface AiCtx {
  db: TenantDatabase;
  tenantId: string;
  businessId: string;
  user: { id: string };
  role: string;
  ability: AppAbility;
  ipAddress?: string | null;
}

/** A question that never finished (the server died, the client never streamed) is given back after this long. */
export const STALE_PENDING_MS = 6 * 60_000;
const HISTORY_MESSAGES = 12;
const HISTORY_CHARS = 3_000;
const MAX_ANSWER_CHARS = 8_000;

// ── Status ───────────────────────────────────────────────────────────────────

export type AiAccess = "ok" | "addon_required" | "org_disabled" | "role_disabled" | "read_only" | "suspended";

export interface AiStatus {
  configured: boolean;
  access: AiAccess;
  isOwner: boolean;
  tier: AiTier | null;
  allowance: Omit<AiAllowance, "tier"> | null;
  /** Phase 2: the action kinds the assistant may prepare for this person right now (empty when switched off or not permitted). */
  actionKinds: AiActionKind[];
}

/** What the panel needs to decide between the chat, the add-on notice and an "off" message. Never throws for a missing add-on. */
export async function aiStatus(ctx: Pick<AiCtx, "tenantId" | "role"> & { ability?: AppAbility }): Promise<AiStatus> {
  const ent = await getEntitlements(ctx.tenantId);
  const isOwner = ctx.role === "superadmin";
  const configured = isAiConfigured();
  const off = (access: AiAccess): AiStatus => ({ configured, access, isOwner, tier: null, allowance: null, actionKinds: [] });
  if (ent.reason === "tenant_suspended") return off("suspended");
  if (ent.readOnly) return off("read_only");
  const account = await loadAiAccount(ctx.tenantId, ent);
  if (!account) return off("addon_required");
  const a = account.allowance;
  const allowance = { scope: a.scope, limit: a.limit, used: a.used, includedRemaining: a.includedRemaining, creditsRemaining: a.creditsRemaining, remaining: a.remaining, exhausted: a.exhausted };
  const settings = await getAiSettings(ctx.tenantId);
  const reason = aiDisabledReason(settings, ctx.role);
  const actionKinds = reason || !ctx.ability || aiActionsDisabledReason(settings, ctx.role) ? [] : actionKindsOf(ctx.ability);
  return { configured, access: reason ?? "ok", isOwner, tier: account.tier, allowance, actionKinds };
}

/** The action kinds this person's abilities allow (the switches are checked by the caller). */
export function actionKindsOf(ability: AppAbility): AiActionKind[] {
  return aiActionKindsFor((action, subject) => ability.can(action, subject));
}

// ── Starting a question ──────────────────────────────────────────────────────

export interface BeginResult {
  conversationId: string;
  usageId: string;
  tier: AiTier;
  isNewConversation: boolean;
  /** Earlier turns, text only, oldest first (for the model). */
  history: AiMessage[];
  /** The action kinds the assistant may prepare for this person (permission and the owner's switches resolved). Empty = read-only chat. */
  actionKinds: AiActionKind[];
  /** The person's permission role, so the streaming route can build the same abilities for the propose tools. */
  role: string;
}

/**
 * Everything that must be true before the model is called: permission, add-on,
 * the owner's switches, a configured server, a valid own conversation and ONE
 * question taken from the quota (atomically). A failure after that gives the
 * question back.
 */
export async function beginQuestion(ctx: AiCtx, input: { conversationId?: string; message: string }): Promise<BeginResult> {
  const message = input.message.trim();
  if (!message || message.length > AI_MAX_QUESTION_CHARS) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Ask a question of 1 to ${AI_MAX_QUESTION_CHARS} characters.` });
  }
  const ent = await assertAi(ctx, "create");
  await assertAiSwitchedOn(ctx);
  if (!isAiConfigured()) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: AI_NOT_CONFIGURED_MESSAGE });

  await refundStalePending(ctx.tenantId);
  const account = await loadAiAccount(ctx.tenantId, ent);
  if (!account) throw new TRPCError({ code: "FORBIDDEN", message: "The AI assistant is not available for this organisation." });

  let history: AiMessage[] = [];
  let conversationId = input.conversationId;
  if (conversationId) {
    const [conv] = await ctx.db
      .select({ id: aiConversations.id })
      .from(aiConversations)
      .where(ownConversation(ctx, conversationId))
      .limit(1);
    if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
    history = await loadHistory(ctx, conversationId);
  }

  const limit = account.allowance.limit;
  const consumed = await consumeQuestion(ctx.tenantId, account.counterKey, limit);
  if (!consumed) throw limitError(aiQuotaExhaustedMessage(account.allowance, ctx.role === "superadmin"));

  let usageId: string | undefined;
  try {
    const isNew = !conversationId;
    if (!conversationId) {
      const [conv] = await ctx.db
        .insert(aiConversations)
        .values({ businessId: ctx.businessId, userId: ctx.user.id, title: titleOf(message) })
        .returning({ id: aiConversations.id });
      conversationId = conv!.id;
    }
    await ctx.db.insert(aiMessages).values({ conversationId, businessId: ctx.businessId, role: "user", content: message });
    await ctx.db.update(aiConversations).set({ updatedAt: new Date() }).where(eq(aiConversations.id, conversationId));
    const [usage] = await controlDb
      .insert(aiUsage)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.user.id,
        businessId: ctx.businessId,
        conversationId,
        period: monthOf(account.counterKey),
        counterKey: account.counterKey,
        source: consumed.source,
        creditGrantId: consumed.source === "credit" ? consumed.grantId : null,
        tier: account.tier,
      })
      .returning({ id: aiUsage.id });
    usageId = usage!.id;
    // The question itself is kept short in the audit trail: no business data, ids only.
    await logAudit(ctx.db, {
      businessId: ctx.businessId,
      userId: ctx.user.id,
      action: "ai.question",
      entityType: "ai_conversation",
      entityId: conversationId,
      metadata: { source: "via AI assistant", question: clip(message, 80), tier: account.tier },
      ipAddress: ctx.ipAddress ?? null,
      role: ctx.role,
    });
    const settings = await getAiSettings(ctx.tenantId);
    const actionKinds = aiActionsDisabledReason(settings, ctx.role) ? [] : actionKindsOf(ctx.ability);
    return { conversationId, usageId, tier: account.tier, isNewConversation: isNew, history, actionKinds, role: ctx.role };
  } catch (err) {
    if (usageId) await controlDb.update(aiUsage).set({ status: "refunded", completedAt: new Date() }).where(eq(aiUsage.id, usageId));
    await refundQuestion(ctx.tenantId, account.counterKey, consumed.source, consumed.source === "credit" ? consumed.grantId : null);
    throw err;
  }
}

/** The IST month of a counter key (a trial key has no month: use the current one). */
function monthOf(counterKey: string): string {
  return /^\d{4}-\d{2}$/.test(counterKey) ? counterKey : new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
}

function titleOf(message: string): string {
  return clip(message, 60) || "New chat";
}

// ── Finishing or refunding ───────────────────────────────────────────────────

export interface FinishInput {
  tenantId: string;
  businessId: string;
  userId: string;
  role?: string;
  ipAddress?: string | null;
  db: TenantDatabase;
  conversationId: string;
  usageId: string;
  model: string;
  text: string;
  cards: AiAnyCard[];
  toolCalls: Array<{ name: string; status: string }>;
  usage: Required<AiTokenUsage>;
  /** ok, or aborted when the person stopped it after text began (still counted). */
  status: "ok" | "aborted";
}

/** Save the answer and close the ledger row with tokens and the estimated cost. */
export async function finishQuestion(input: FinishInput): Promise<{ messageId: string; costPaise: number }> {
  const prices = await getAiPrices();
  const costPaise = estimateAiCostPaise(prices, input.model, input.usage);
  const [msg] = await input.db
    .insert(aiMessages)
    .values({
      conversationId: input.conversationId,
      businessId: input.businessId,
      role: "assistant",
      content: input.text.slice(0, MAX_ANSWER_CHARS),
      cards: input.cards.length ? (input.cards as unknown as Array<Record<string, unknown>>) : null,
      toolCalls: input.toolCalls.length ? input.toolCalls : null,
      model: input.model,
    })
    .returning({ id: aiMessages.id });
  await input.db.update(aiConversations).set({ updatedAt: new Date() }).where(eq(aiConversations.id, input.conversationId));
  await controlDb
    .update(aiUsage)
    .set({
      status: input.status,
      model: input.model,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      cacheReadTokens: input.usage.cacheReadTokens,
      cacheWriteTokens: input.usage.cacheWriteTokens,
      toolCalls: input.toolCalls.length,
      costPaise,
      completedAt: new Date(),
    })
    .where(and(eq(aiUsage.id, input.usageId), eq(aiUsage.status, "pending")));
  return { messageId: msg!.id, costPaise };
}

/**
 * Give the question back (provider failure, or nothing was produced). Claims
 * the ledger row first so a question is refunded at most once. Tokens already
 * spent are still recorded: the provider charged for them.
 */
export async function refundPending(tenantId: string, usageId: string, spent?: { model: string; usage: Required<AiTokenUsage> }): Promise<boolean> {
  const costPaise = spent ? estimateAiCostPaise(await getAiPrices(), spent.model, spent.usage) : 0;
  const claimed = await controlDb
    .update(aiUsage)
    .set({
      status: "refunded",
      completedAt: new Date(),
      ...(spent
        ? {
            model: spent.model,
            inputTokens: spent.usage.inputTokens,
            outputTokens: spent.usage.outputTokens,
            cacheReadTokens: spent.usage.cacheReadTokens,
            cacheWriteTokens: spent.usage.cacheWriteTokens,
            costPaise,
          }
        : {}),
    })
    .where(and(eq(aiUsage.id, usageId), eq(aiUsage.tenantId, tenantId), eq(aiUsage.status, "pending")))
    .returning({ counterKey: aiUsage.counterKey, source: aiUsage.source, grantId: aiUsage.creditGrantId });
  const row = claimed[0];
  if (!row) return false;
  await refundQuestion(tenantId, row.counterKey, row.source, row.grantId);
  return true;
}

/** Questions that never finished are given back, so a crash never costs a customer a question. */
export async function refundStalePending(tenantId: string, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_PENDING_MS);
  const stale = await controlDb
    .select({ id: aiUsage.id })
    .from(aiUsage)
    .where(and(eq(aiUsage.tenantId, tenantId), eq(aiUsage.status, "pending"), lt(aiUsage.createdAt, cutoff)))
    .limit(50);
  let n = 0;
  for (const row of stale) if (await refundPending(tenantId, row.id)) n++;
  return n;
}

/** One audit entry for one tool call: its name and outcome only, never what it returned. */
export async function auditToolCall(
  ctx: { db: TenantDatabase; businessId: string; userId: string; role?: string; ipAddress?: string | null },
  conversationId: string,
  tool: { name: string; status: string },
): Promise<void> {
  await logAudit(ctx.db, {
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "ai.toolCall",
    entityType: "ai_conversation",
    entityId: conversationId,
    metadata: { source: "via AI assistant", tool: tool.name, status: tool.status },
    ipAddress: ctx.ipAddress ?? null,
    role: ctx.role,
  });
}

// ── Conversation history (own conversations only) ────────────────────────────

function ownConversation(ctx: Pick<AiCtx, "businessId" | "user">, id: string) {
  return and(eq(aiConversations.id, id), eq(aiConversations.businessId, ctx.businessId), eq(aiConversations.userId, ctx.user.id));
}

async function loadHistory(ctx: AiCtx, conversationId: string): Promise<AiMessage[]> {
  const rows = await ctx.db
    .select({ role: aiMessages.role, content: aiMessages.content, cards: aiMessages.cards })
    .from(aiMessages)
    .where(and(eq(aiMessages.conversationId, conversationId), eq(aiMessages.businessId, ctx.businessId)))
    .orderBy(desc(aiMessages.createdAt))
    .limit(HISTORY_MESSAGES);
  // The model is not handed the result of a write. What it may know, in the NEXT question, is where each card
  // it prepared stands now (waiting, done as invoice INV-7 with this id, cancelled, failed): server-built text
  // from the person's own actions, so "now send that invoice to the customer" can find the invoice.
  const cardIds = [...new Set(rows.flatMap((r) => (r.role === "assistant" && r.cards ? parseTrustedAiCards(r.cards) : []).flatMap((c) => (c.type === "confirmation" ? [c.actionId] : []))))];
  const live = await loadActionCards(ctx, cardIds);
  const withCardNotes = (r: { role: string; content: string; cards: unknown }): string => {
    if (r.role !== "assistant" || !r.cards) return r.content.slice(0, HISTORY_CHARS);
    const notes = parseTrustedAiCards(r.cards).flatMap((c) => {
      if (c.type !== "confirmation") return [];
      const card = live.get(c.actionId);
      if (!card) return [];
      const outcome =
        card.status === "confirmed" && card.result ? `done: ${clip(card.result.label, 80)}${card.result.id ? ` (id ${card.result.id})` : ""}`
        : card.status === "failed" ? `failed${card.error ? `: ${clip(card.error, 120)}` : ""}`
        : card.status;
      return [`[Card shown to the person: "${clip(card.title, 60)}" - ${outcome}]`];
    });
    return `${r.content.slice(0, HISTORY_CHARS)}${notes.length ? `\n\n${notes.join("\n")}` : ""}`;
  };
  const turns = rows
    .reverse()
    .filter((r) => r.role === "user" || r.role === "assistant")
    .map((r) => ({ role: r.role as "user" | "assistant", content: withCardNotes(r) }));
  // The API wants the first turn to be the user's and turns to alternate: drop a leading assistant turn and merge repeats.
  const out: AiMessage[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (!last && t.role === "assistant") continue;
    if (last && last.role === t.role) last.content = `${last.content as string}\n\n${t.content}`;
    else out.push({ ...t });
  }
  if (out[out.length - 1]?.role === "user") out.pop(); // an unanswered earlier question: the new one replaces it
  return out;
}

export async function listConversations(ctx: AiCtx, limit = 30) {
  const rows = await ctx.db
    .select({ id: aiConversations.id, title: aiConversations.title, updatedAt: aiConversations.updatedAt, createdAt: aiConversations.createdAt })
    .from(aiConversations)
    .where(and(eq(aiConversations.businessId, ctx.businessId), eq(aiConversations.userId, ctx.user.id)))
    .orderBy(desc(aiConversations.updatedAt))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString(), createdAt: r.createdAt.toISOString() }));
}

export async function getConversation(ctx: AiCtx, id: string) {
  const [conv] = await ctx.db.select().from(aiConversations).where(ownConversation(ctx, id)).limit(1);
  if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
  const rows = await ctx.db
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.conversationId, id), eq(aiMessages.businessId, ctx.businessId)))
    .orderBy(asc(aiMessages.createdAt));
  // Validated again on the way out: only known card types ever reach a client. A confirmation
  // card is rebuilt from the stored action as it is NOW (its status, result and edits); one whose
  // action is gone or is not this person's is dropped.
  const parsed = rows.map((m) => (m.role === "assistant" && m.cards ? parseTrustedAiCards(m.cards) : []));
  const actionIds = [...new Set(parsed.flat().flatMap((c) => (c.type === "confirmation" ? [c.actionId] : [])))];
  const live = await loadActionCards(ctx, actionIds);
  return {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    messages: rows.map((m, i) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      cards: parsed[i]!.flatMap((c): AiAnyCard[] => (c.type === "confirmation" ? (live.get(c.actionId) ? [live.get(c.actionId)!] : []) : [c])),
      toolCalls: m.toolCalls ?? [],
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export async function deleteConversation(ctx: AiCtx, id: string): Promise<{ id: string }> {
  const deleted = await ctx.db.delete(aiConversations).where(ownConversation(ctx, id)).returning({ id: aiConversations.id });
  if (deleted.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
  return { id };
}
