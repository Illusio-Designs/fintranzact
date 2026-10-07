/**
 * AI business assistant (Phase 1, read-only questions): status, the owner's
 * switches, per-person conversation history, and `begin`, which starts a
 * question (permission, add-on, switches, quota, history, ledger row, audit).
 *
 * The answer itself streams over POST /api/ai/stream (http/aiStream.ts), which
 * calls `begin` through a caller built from the same request, so there is one
 * gate for both. The assistant's data tools call the existing procedures the
 * same way, as the signed-in user (lib/ai/tools.ts).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { controlDb, tenantMembers } from "@fintranzact/db";
import { AI_MAX_QUESTION_CHARS, AI_ROLE_LABELS, AI_SWITCHABLE_ROLES, aiSettingsSchema } from "@fintranzact/shared";
import { router, viewerProcedure, tenantProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { assertAi, assertAiSwitchedOn } from "../lib/ai/access.js";
import { aiStatus, beginQuestion, deleteConversation, getConversation, listConversations, type AiCtx } from "../lib/ai/service.js";
import { getAiSettings, saveAiSettings } from "../lib/ai/settings.js";
import { PLAN_MANAGER_ROLES } from "../lib/plan-manager.js";

const idInput = z.object({ id: z.string().uuid() });

function aiCtx(ctx: {
  db: AiCtx["db"];
  tenantId: string;
  businessId: string;
  user: { id: string };
  role: string;
  ability: AiCtx["ability"];
  ipAddress?: string | null;
}): AiCtx {
  return { db: ctx.db, tenantId: ctx.tenantId, businessId: ctx.businessId, user: { id: ctx.user.id }, role: ctx.role, ability: ctx.ability, ipAddress: ctx.ipAddress };
}

/** The organisation's owner (the tenant role owner or superadmin): only they switch the assistant on and off. */
async function requireAiOwner(ctx: { tenantId: string | null; user: { id: string } | null }): Promise<string> {
  if (!ctx.tenantId || !ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  const [m] = await controlDb
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, ctx.tenantId), eq(tenantMembers.userId, ctx.user.id)))
    .limit(1);
  if (!m || !PLAN_MANAGER_ROLES.includes(m.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the organization owner can change the AI assistant settings." });
  }
  return ctx.tenantId;
}

export const aiRouter = router({
  /**
   * What the panel needs: configured on this server, whether this person may use
   * it (and why not), the tier and the questions left. Open to every role that has
   * the assistant; never throws for a missing add-on (the page shows a notice).
   */
  status: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "Ai");
    return aiStatus({ tenantId: ctx.tenantId, role: ctx.role });
  }),

  /** The person's own conversations in this business, newest first. */
  conversations: viewerProcedure.query(async ({ ctx }) => {
    await assertAi(ctx, "read");
    await assertAiSwitchedOn(ctx);
    return listConversations(aiCtx(ctx));
  }),

  /** One of the person's own conversations with its messages and validated cards. */
  conversation: viewerProcedure.input(idInput).query(async ({ ctx, input }) => {
    await assertAi(ctx, "read");
    await assertAiSwitchedOn(ctx);
    return getConversation(aiCtx(ctx), input.id);
  }),

  /** Delete one of the person's own conversations (nobody else's). */
  deleteConversation: viewerProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    requireCan(ctx.ability, "create", "Ai");
    return deleteConversation(aiCtx(ctx), input.id);
  }),

  /**
   * Start a question: checks everything, takes one question from the quota and
   * saves the person's message. The streaming route calls this and then asks the
   * model; a question that is never answered is given back after a few minutes.
   */
  begin: viewerProcedure
    .input(z.object({ conversationId: z.string().uuid().optional(), message: z.string().trim().min(1).max(AI_MAX_QUESTION_CHARS) }))
    .mutation(async ({ ctx, input }) => {
      const r = await beginQuestion(aiCtx(ctx), input);
      return { conversationId: r.conversationId, usageId: r.usageId, tier: r.tier, isNewConversation: r.isNewConversation, history: r.history };
    }),

  /** The owner's switches: the assistant for the organisation, and per role. */
  settings: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = await requireAiOwner(ctx);
    return {
      ...(await getAiSettings(tenantId)),
      roles: AI_SWITCHABLE_ROLES.map((role) => ({ role, label: AI_ROLE_LABELS[role] })),
    };
  }),

  /** Owner only: switch the assistant off for the organisation or for some roles. Enforced on the server. */
  updateSettings: tenantProcedure.input(aiSettingsSchema).mutation(async ({ ctx, input }) => {
    const tenantId = await requireAiOwner(ctx);
    await saveAiSettings(tenantId, { enabled: input.enabled, disabledRoles: [...new Set(input.disabledRoles)] }, ctx.user.id);
    return getAiSettings(tenantId);
  }),
});
