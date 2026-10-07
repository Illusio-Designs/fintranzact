/**
 * The pending-action framework of the AI assistant (Phase 2).
 *
 *   propose  (the model's tool)  validated payload + computed preview -> a row in ai_pending_actions
 *   edit     (the person)         applyEdits + rebuild, only while pending
 *   confirm  (the person)         lock the row, pending -> confirmed exactly once, then run the real
 *                                 tRPC procedure through the person's own caller
 *   cancel   (the person)         pending -> cancelled
 *
 * The model can only call `proposeAiAction`. Edit, confirm and cancel are
 * plain tRPC procedures the card's buttons call (routers/ai.ts); nothing in the
 * chat stream, a tool result or the books' text can reach them.
 *
 * Rows are private to (business, user): only the person the assistant prepared
 * the action for can see, edit, confirm or cancel it. Another admin cannot.
 */

import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { aiPendingActions, type TenantDatabase } from "@fintranzact/db";
import {
  AI_ACTION_FORBIDDEN_MESSAGE,
  AI_ACTION_PERMISSIONS,
  AI_ACTION_TTL_MS,
  aiActionExpiresAt,
  aiActionPurgeCutoff,
  buildAiConfirmationCard,
  isAiActionExpired,
  isAiActionKind,
  type AiActionKind,
  type AiActionResult,
  type AiActionStatus,
  type AiConfirmationCard,
} from "@fintranzact/shared";
import { logAudit } from "../../audit.js";
import { AUDIT_SOURCE_AI, runWithAuditSource } from "../../audit-source.js";
import { logger } from "../../logger.js";
import { AiActionEditError, AiToolInputError } from "../errors.js";
import { clip } from "../format.js";
import { actionDef } from "./registry.js";
import type { AiActionCtx, AiActionDef } from "./types.js";

type Row = typeof aiPendingActions.$inferSelect;

/** At most this many proposals waiting for one person at a time. */
export const MAX_PENDING_PER_USER = 20;
/** A confirmation that never recorded a result is shown as failed after this long. */
const STUCK_CONFIRM_MS = 10 * 60_000;

const nowOf = (ctx: { now?: Date }) => ctx.now ?? new Date();

// ── Permission ───────────────────────────────────────────────────────────────

export function canDoAction(ctx: Pick<AiActionCtx, "ability">, kind: AiActionKind): boolean {
  const need = AI_ACTION_PERMISSIONS[kind];
  return ctx.ability.can(need.action, need.subject);
}

function assertCanDoAction(ctx: Pick<AiActionCtx, "ability">, kind: AiActionKind): void {
  if (!canDoAction(ctx, kind)) throw new TRPCError({ code: "FORBIDDEN", message: AI_ACTION_FORBIDDEN_MESSAGE });
}

// ── Cards ────────────────────────────────────────────────────────────────────

/** The card for a stored action, as it is now (a pending one past its time shows as expired; a stuck confirmation as failed). */
export function cardOf(row: Row, now: Date): AiConfirmationCard | null {
  if (!isAiActionKind(row.kind)) return null;
  let status = row.status as AiActionStatus;
  let error = row.error;
  if (status === "confirmed" && !row.result && now.getTime() - row.updatedAt.getTime() > STUCK_CONFIRM_MS) {
    status = "failed";
    error = "We could not confirm whether this was saved. Check the relevant page before trying again.";
  }
  return buildAiConfirmationCard({ id: row.id, kind: row.kind, status, expiresAt: row.expiresAt, preview: row.preview, result: row.result, error }, now);
}

function cardOrThrow(row: Row, now: Date): AiConfirmationCard {
  const card = cardOf(row, now);
  if (!card) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "This action could not be shown. Please ask for it again." });
  return card;
}

// ── Propose (the model's side) ───────────────────────────────────────────────

export interface Proposal {
  actionId: string;
  card: AiConfirmationCard;
  summary: string;
}

/**
 * Validate and store a proposal and return the card to show. Never writes
 * business data. Throws AiToolInputError (a message for the model: ambiguity,
 * a missing value) or TRPCError FORBIDDEN (the person may not do this).
 */
export async function proposeAiAction(ctx: AiActionCtx, def: AiActionDef, rawInput: unknown, conversationId: string | null): Promise<Proposal> {
  assertCanDoAction(ctx, def.kind);
  const now = nowOf(ctx);
  await sweepAiActions(ctx.db, ctx.businessId, now);

  const parsed = def.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AiToolInputError(`Invalid input${issue ? `: ${issue.path.join(".") || "input"} ${issue.message}` : ""}`);
  }
  const [{ n } = { n: 0 }] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiPendingActions)
    .where(and(eq(aiPendingActions.businessId, ctx.businessId), eq(aiPendingActions.userId, ctx.user.id), eq(aiPendingActions.status, "pending")));
  if (n >= MAX_PENDING_PER_USER) {
    throw new AiToolInputError("Too many actions are waiting for the person's confirmation. Ask them to confirm or cancel some first.");
  }

  const built = await def.propose(ctx, parsed.data as never);
  const [row] = await ctx.db
    .insert(aiPendingActions)
    .values({
      businessId: ctx.businessId,
      userId: ctx.user.id,
      conversationId,
      kind: def.kind,
      payload: built.payload,
      preview: built.preview as unknown as Record<string, unknown>,
      summary: built.summary,
      status: "pending",
      expiresAt: aiActionExpiresAt(now),
    })
    .returning();
  await auditAction(ctx, "ai.action.propose", row!, { conversationId, summary: clip(built.summary, 160) });
  return { actionId: row!.id, card: cardOrThrow(row!, now), summary: built.summary };
}

// ── Loading (own rows only) ──────────────────────────────────────────────────

async function loadOwn(ctx: Pick<AiActionCtx, "db" | "businessId" | "user">, id: string): Promise<Row> {
  const [row] = await ctx.db
    .select()
    .from(aiPendingActions)
    .where(and(eq(aiPendingActions.id, id), eq(aiPendingActions.businessId, ctx.businessId), eq(aiPendingActions.userId, ctx.user.id)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Action not found" });
  return row;
}

export async function getAiActionCard(ctx: AiActionCtx, id: string): Promise<AiConfirmationCard> {
  return cardOrThrow(await loadOwn(ctx, id), nowOf(ctx));
}

// ── Edit (the person's) ──────────────────────────────────────────────────────

export async function updateAiAction(ctx: AiActionCtx, id: string, edits: Record<string, string>): Promise<AiConfirmationCard> {
  const now = nowOf(ctx);
  const row = await loadOwn(ctx, id);
  if (!isAiActionKind(row.kind)) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown action" });
  if (row.status !== "pending" || isAiActionExpired(row.expiresAt, now)) {
    throw new TRPCError({ code: "CONFLICT", message: "This action can no longer be changed. Ask me to prepare it again." });
  }
  assertCanDoAction(ctx, row.kind);
  const def = actionDef(row.kind);
  let built;
  try {
    built = await def.build(ctx, def.applyEdits(row.payload, edits));
  } catch (err) {
    if (err instanceof AiActionEditError || err instanceof AiToolInputError) throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
    throw err;
  }
  // Only while still pending: a confirmation that has started wins.
  const [updated] = await ctx.db
    .update(aiPendingActions)
    .set({ payload: built.payload, preview: built.preview as unknown as Record<string, unknown>, summary: built.summary, updatedAt: now })
    .where(and(eq(aiPendingActions.id, id), eq(aiPendingActions.userId, ctx.user.id), eq(aiPendingActions.businessId, ctx.businessId), eq(aiPendingActions.status, "pending")))
    .returning();
  if (!updated) throw new TRPCError({ code: "CONFLICT", message: "This action can no longer be changed." });
  await auditAction(ctx, "ai.action.edit", updated, { fields: Object.keys(edits).slice(0, 20), summary: clip(built.summary, 160) });
  return cardOrThrow(updated, now);
}

// ── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelAiAction(ctx: AiActionCtx, id: string): Promise<AiConfirmationCard> {
  const now = nowOf(ctx);
  const [cancelled] = await ctx.db
    .update(aiPendingActions)
    .set({ status: "cancelled", resolvedAt: now, updatedAt: now })
    .where(and(eq(aiPendingActions.id, id), eq(aiPendingActions.userId, ctx.user.id), eq(aiPendingActions.businessId, ctx.businessId), eq(aiPendingActions.status, "pending")))
    .returning();
  if (cancelled) {
    await auditAction(ctx, "ai.action.cancel", cancelled, { summary: clip(cancelled.summary, 160) });
    return cardOrThrow(cancelled, now);
  }
  // Already finished (or someone else's / unknown): report where it stands, never change it.
  return cardOrThrow(await loadOwn(ctx, id), now);
}

// ── Confirm ──────────────────────────────────────────────────────────────────

export interface ConfirmOutcome {
  /** The state of the action after this call (confirmed, failed, expired, cancelled). */
  status: AiActionStatus;
  card: AiConfirmationCard;
  /** Set when the action did not (or could not) happen: shown to the person. */
  message: string | null;
  /** True when this call did the work; false when it returned an earlier outcome (a repeated tap). */
  executedNow: boolean;
}

/** A message safe to show a person for an error the real procedure threw. */
export function friendlyActionError(err: unknown): string {
  if (err instanceof TRPCError) {
    const m = err.message.trim();
    // A schema failure surfaces as a JSON list of issues: not for people.
    if (m.startsWith("[") || m.startsWith("{")) return "Some details are not valid any more. Cancel this card and ask me to prepare it again.";
    return clip(m, 300) || "This could not be completed.";
  }
  if (err instanceof AiToolInputError || err instanceof AiActionEditError) return clip(err.message, 300);
  return "Something went wrong and nothing was saved. Please try again in a moment.";
}

/**
 * Run the person's confirmed action. The caller (the tRPC procedure) has
 * already checked the add-on, the owner's switches and the permission for this
 * kind. Here: claim the row (pending -> confirmed, once, under a row lock),
 * then run the real procedure as the person with every normal rule in force.
 */
export async function confirmAiAction(ctx: AiActionCtx, id: string): Promise<ConfirmOutcome> {
  const now = nowOf(ctx);
  const first = await loadOwn(ctx, id);
  if (!isAiActionKind(first.kind)) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown action" });
  const kind = first.kind;
  const def = actionDef(kind);

  // Checked before the claim so a refusal leaves the action waiting (permissions can change in between).
  if (first.status === "pending" && !isAiActionExpired(first.expiresAt, now)) {
    assertCanDoAction(ctx, kind);
  }

  const claim = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(aiPendingActions)
      .where(and(eq(aiPendingActions.id, id), eq(aiPendingActions.businessId, ctx.businessId), eq(aiPendingActions.userId, ctx.user.id)))
      .for("update")
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Action not found" });
    if (row.status !== "pending") return { claimed: false as const, row };
    if (isAiActionExpired(row.expiresAt, now)) {
      const [expired] = await tx.update(aiPendingActions).set({ status: "expired", resolvedAt: now, updatedAt: now }).where(eq(aiPendingActions.id, id)).returning();
      return { claimed: false as const, row: expired! };
    }
    const [claimed] = await tx.update(aiPendingActions).set({ status: "confirmed", resolvedAt: now, updatedAt: now }).where(eq(aiPendingActions.id, id)).returning();
    return { claimed: true as const, row: claimed! };
  });

  if (!claim.claimed) {
    const card = cardOrThrow(claim.row, now);
    const status = card.status;
    return {
      status,
      card,
      executedNow: false,
      message:
        status === "confirmed" ? null
        : status === "expired" ? "This action expired. Ask me to prepare it again."
        : status === "cancelled" ? "This action was cancelled."
        : card.error ?? "This action did not go through.",
    };
  }

  try {
    const result: AiActionResult = await runWithAuditSource({ source: AUDIT_SOURCE_AI, actionId: id }, () => def.execute(ctx, claim.row.payload));
    const [done] = await ctx.db
      .update(aiPendingActions)
      .set({ result: result as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(aiPendingActions.id, id))
      .returning();
    await auditAction(ctx, "ai.action.confirm", done!, { summary: clip(done!.summary, 160), entityType: result.entityType, entityId: result.id ?? null });
    return { status: "confirmed", card: cardOrThrow(done!, now), message: null, executedNow: true };
  } catch (err) {
    const message = friendlyActionError(err);
    if (!(err instanceof TRPCError)) logger.error({ err, kind, actionId: id }, "[ai] confirmed action failed");
    const [failed] = await ctx.db
      .update(aiPendingActions)
      .set({ status: "failed", error: message, resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(aiPendingActions.id, id))
      .returning();
    await auditAction(ctx, "ai.action.fail", failed!, { summary: clip(failed!.summary, 160), error: clip(message, 160) });
    return { status: "failed", card: cardOrThrow(failed!, now), message, executedNow: true };
  }
}

// ── Sweep (lazy cleanup) ─────────────────────────────────────────────────────

/**
 * Lazy cleanup, run whenever a proposal is made for this business (no new
 * scheduler): pending rows past their time become "expired", and finished rows
 * older than 30 days are deleted. The audit entries stay.
 */
export async function sweepAiActions(db: TenantDatabase, businessId: string, now: Date = new Date()): Promise<void> {
  try {
    await db
      .update(aiPendingActions)
      .set({ status: "expired", resolvedAt: now, updatedAt: now })
      .where(and(eq(aiPendingActions.businessId, businessId), eq(aiPendingActions.status, "pending"), lt(aiPendingActions.expiresAt, now)));
    await db
      .delete(aiPendingActions)
      .where(and(eq(aiPendingActions.businessId, businessId), ne(aiPendingActions.status, "pending"), lt(aiPendingActions.updatedAt, aiActionPurgeCutoff(now))));
  } catch (err) {
    logger.warn({ err }, "[ai] sweeping pending actions failed");
  }
}

// ── Rebuilding stored cards for a conversation ───────────────────────────────

/** The current cards for these action ids, owned by this person in this business (a card whose row is gone or not theirs is dropped). */
export async function loadActionCards(
  ctx: Pick<AiActionCtx, "db" | "businessId" | "user">,
  ids: string[],
  now: Date = new Date(),
): Promise<Map<string, AiConfirmationCard>> {
  const out = new Map<string, AiConfirmationCard>();
  if (ids.length === 0) return out;
  const rows = await ctx.db
    .select()
    .from(aiPendingActions)
    .where(and(inArray(aiPendingActions.id, ids), eq(aiPendingActions.businessId, ctx.businessId), eq(aiPendingActions.userId, ctx.user.id)));
  for (const r of rows) {
    const card = cardOf(r, now);
    if (card) out.set(r.id, card);
  }
  return out;
}

// ── Audit ────────────────────────────────────────────────────────────────────

async function auditAction(ctx: AiActionCtx, action: string, row: Row, extra: Record<string, unknown>): Promise<void> {
  await logAudit(ctx.db, {
    businessId: ctx.businessId,
    userId: ctx.user.id,
    action,
    entityType: "ai_action",
    entityId: row.id,
    metadata: { source: AUDIT_SOURCE_AI, kind: row.kind, aiActionId: row.id, ...extra },
    ipAddress: ctx.ipAddress ?? null,
    role: ctx.role,
  });
}

export { AI_ACTION_TTL_MS };
