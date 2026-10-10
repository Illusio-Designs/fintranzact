/**
 * POST /api/ai/stream: the AI assistant's streaming answer (server-sent events).
 *
 * Authentication, CSRF, tenant and business resolution are exactly the tRPC
 * context's: the request goes through `createContext` (session cookie or Bearer
 * token, x-business-id header) and a server-side tRPC caller is built from that
 * same context, so the question is gated by the same middleware as every other
 * call (tenant membership, business access, two-factor policy, CASL, entitlements,
 * read-only). The Hono CSRF middleware already requires X-Requested-With on a
 * cookie-authenticated POST.
 *
 * Entitlement policy (rest-entitlement-policy.ts): "write-gated". It is refused
 * while the organisation is read-only or suspended (add-ons are off then), with
 * the standard 403 { error, entitlement } body.
 *
 * Request  { conversationId?: uuid, message: string (1..1000), context?: page context (allowlisted, verified server-side) }
 * Events   meta  { conversationId, model, tier }
 *          tool  { name, status: "start" | "ok" | "denied" | ... }
 *          text  { delta }
 *          done  { conversationId, messageId, text, cards, remaining }   (cards include any confirmation cards for
 *                prepared actions; confirming is NOT part of this stream: it is a separate tRPC call made by the person's tap on the card)
 *          error { code, message }     (the question is given back unless text was already produced)
 * Failures before the stream starts are plain JSON { error, code, entitlement? } with an HTTP status.
 */

import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getTenantDb } from "@fintranzact/db";
import { AI_MAX_QUESTION_CHARS, istDateParts, parseAiCards } from "@fintranzact/shared";
import { createContext } from "../context.js";
import { createCallerFactory } from "../trpc.js";
import { appRouter } from "../router.js";
import { refuseIfReadOnly } from "./entitlement-guard.js";
import { entitlementDataOf } from "../lib/entitlement-error.js";
import { createFixedWindowLimiter } from "../lib/fixed-window-limiter.js";
import { clientIpFromHeaders } from "../lib/client-ip.js";
import { logger } from "../lib/logger.js";
import { AiProviderError, getAiClient, type AiClient } from "../lib/ai/client.js";
import { chooseAiModel, resolveAiModels } from "../lib/ai/model-router.js";
import { buildSystemPrompt } from "../lib/ai/prompt.js";
import { aiToolDefs, runAiTool, type AiActionToolContext } from "../lib/ai/tools.js";
import { resolvePageContext } from "../lib/ai/page-context.js";
import { defineAbilityFor } from "../lib/permissions.js";
import { newAiLoopState, runAiLoop } from "../lib/ai/loop.js";
import { auditToolCall, finishQuestion, refundPending } from "../lib/ai/service.js";
import { loadAiAccount } from "../lib/ai/quota.js";
import { getAiUserPrefs } from "../lib/ai/prefs.js";
import { getEntitlements } from "../lib/entitlements.js";
import { businesses } from "@fintranzact/db";
import { eq } from "drizzle-orm";

const bodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(AI_MAX_QUESTION_CHARS),
  /** The page the person is on. Validated and verified later; anything invalid is dropped, never an error. */
  context: z.unknown().optional(),
});

const createCaller = createCallerFactory(appRouter);

/** Questions per person per minute (each one also spends from the organisation's quota). */
const perUser = createFixedWindowLimiter({ limit: 12, windowMs: 60_000 });
const perIp = createFixedWindowLimiter({ limit: 60, windowMs: 60_000 });

export const AI_STREAM_TIMEOUT_MS = 100_000;

/** Same escape hatch as the tRPC limiter in server.ts: honoured only outside production. */
const rateLimitDisabled = () => process.env.DISABLE_RATE_LIMIT === "1" && process.env.NODE_ENV !== "production";

export interface AiStreamOptions {
  /** The provider client (default: Anthropic from ANTHROPIC_API_KEY). Tests inject a scripted fake. */
  getClient?: () => AiClient | null;
}

type ErrorCode = "unauthorized" | "no_business" | "addon_required" | "quota_exhausted" | "read_only" | "switched_off" | "forbidden" | "not_found" | "not_configured" | "bad_request" | "rate_limited" | "provider_error" | "internal";

function codeOf(err: TRPCError): { status: 400 | 401 | 403 | 404 | 429 | 500 | 503; code: ErrorCode } {
  const ent = entitlementDataOf(err);
  if (ent) {
    if (ent.reason === "addon_required") return { status: 403, code: "addon_required" };
    if (ent.reason === "plan_limit") return { status: 403, code: "quota_exhausted" };
    return { status: 403, code: "read_only" };
  }
  switch (err.code) {
    case "UNAUTHORIZED": return { status: 401, code: "unauthorized" };
    case "FORBIDDEN": return { status: 403, code: /switched off/i.test(err.message) ? "switched_off" : "forbidden" };
    case "NOT_FOUND": return { status: 404, code: "not_found" };
    case "BAD_REQUEST": return { status: 400, code: "bad_request" };
    case "SERVICE_UNAVAILABLE": return { status: 503, code: "not_configured" };
    default: return { status: 500, code: "internal" };
  }
}

export function registerAiStreamRoute(app: Hono, opts: AiStreamOptions = {}): void {
  const getClient = opts.getClient ?? (() => getAiClient());

  app.post("/api/ai/stream", bodyLimit({ maxSize: 16 * 1024 }), async (c: Context) => {
    const ip = clientIpFromHeaders((name) => c.req.header(name)) ?? "unknown";
    if (!rateLimitDisabled() && !perIp.hit(ip)) return c.json({ error: "Too many requests", code: "rate_limited" satisfies ErrorCode }, 429);

    // Same identity, tenant and business resolution as tRPC.
    const ctx = await createContext({ req: c.req.raw, resHeaders: new Headers(), info: {} as never });
    if (!ctx.user) return c.json({ error: "You must be logged in", code: "unauthorized" satisfies ErrorCode }, 401);
    if (!ctx.tenantId) return c.json({ error: "No organization selected", code: "no_business" satisfies ErrorCode }, 400);
    if (!ctx.businessId) return c.json({ error: "No business selected", code: "no_business" satisfies ErrorCode }, 400);
    if (!rateLimitDisabled() && !perUser.hit(`${ctx.tenantId}:${ctx.user.id}`)) return c.json({ error: "You are asking too fast. Wait a moment and try again.", code: "rate_limited" satisfies ErrorCode }, 429);

    const refused = await refuseIfReadOnly(c, ctx.tenantId);
    if (refused) return refused;

    let parsed: z.infer<typeof bodySchema>;
    try {
      parsed = bodySchema.parse(await c.req.json());
    } catch {
      return c.json({ error: `Ask a question of 1 to ${AI_MAX_QUESTION_CHARS} characters.`, code: "bad_request" satisfies ErrorCode }, 400);
    }

    const client = getClient();
    if (!client) return c.json({ error: "The AI assistant is not set up on this server yet. Please ask your administrator.", code: "not_configured" satisfies ErrorCode }, 503);

    // The one gate: permission, add-on, owner switches, quota (atomic), saves the question.
    const caller = createCaller(ctx);
    let begun: Awaited<ReturnType<typeof caller.ai.begin>>;
    try {
      begun = await caller.ai.begin({ conversationId: parsed.conversationId, message: parsed.message });
    } catch (err) {
      if (err instanceof TRPCError) {
        const { status, code } = codeOf(err);
        const ent = entitlementDataOf(err);
        return c.json({ error: err.message, code, ...(ent ? { entitlement: ent } : {}) }, status);
      }
      logger.error({ err }, "[ai] begin failed");
      return c.json({ error: "Something went wrong. Please try again.", code: "internal" satisfies ErrorCode }, 500);
    }

    const tenantId = ctx.tenantId;
    const businessId = ctx.businessId;
    const userId = ctx.user.id;
    const userName = ctx.user.name ?? null;
    const ipAddress = ctx.ipAddress;
    const db = await getTenantDb(tenantId);
    const models = resolveAiModels();
    const choice = chooseAiModel(parsed.message, models, { historyTurns: begun.history.length });

    // Proxies must not buffer the stream (nginx honours this header).
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error("timeout")), AI_STREAM_TIMEOUT_MS);
      stream.onAbort(() => controller.abort());
      c.req.raw.signal?.addEventListener("abort", () => controller.abort(), { once: true });
      const send = async (event: string, data: unknown) => {
        if (controller.signal.aborted && event !== "done" && event !== "error") return;
        try {
          await stream.writeSSE({ event, data: JSON.stringify(data) });
        } catch {
          /* the client is gone */
        }
      };

      const state = newAiLoopState();
      try {
        await send("meta", { conversationId: begun.conversationId, model: choice.model, tier: choice.tier });

        const [biz] = await db.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
        const today = istDateParts(new Date());
        // Page context: verified through the person's own permissions; dropped silently when it does not check out.
        const pageContext = await resolvePageContext(caller as never, parsed.context).catch(() => null);
        // Actions: the propose tools exist only for the kinds this person may do, with the owner's switches on.
        const actionCtx: AiActionToolContext | undefined =
          begun.actionKinds.length > 0
            ? {
                db, tenantId, businessId, user: { id: userId, name: userName }, role: begun.role,
                ability: defineAbilityFor({ userId, role: begun.role }), ipAddress, caller: caller as never,
                conversationId: begun.conversationId, kinds: begun.actionKinds, proposed: { count: 0 },
              }
            : undefined;
        // The person's stored reply language (never taken from the request): only a value from the fixed list gets into the prompt.
        const prefs = await getAiUserPrefs(db, businessId, userId).catch(() => null);
        const system = buildSystemPrompt({
          language: prefs?.language ?? "auto",
          today: `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`,
          businessName: biz?.name ?? "this business",
          actions: begun.actionKinds,
          pageContext,
        });

        const result = await runAiLoop({
          client,
          model: choice.model,
          system,
          tools: aiToolDefs(begun.actionKinds),
          history: begun.history,
          question: parsed.message,
          signal: controller.signal,
          state,
          runTool: async (name, input) => {
            const outcome = await runAiTool(caller, name, input, (err) => logger.warn({ err, tool: name }, "[ai] tool failed"), actionCtx);
            // One audit entry per tool call: the tool's name and outcome, never the data.
            await auditToolCall({ db, businessId, userId, ipAddress }, begun.conversationId, { name, status: outcome.status });
            return outcome;
          },
          onText: (delta) => void send("text", { delta }),
          onToolStart: (name) => void send("tool", { name, status: "start" }),
          onToolEnd: (name, status) => void send("tool", { name, status }),
        });

        // The model's own cards (never a confirmation card) after the confirmation cards the server built.
        const modelCards = result.cardsRaw === null ? [] : parseAiCards(result.cardsRaw).cards;
        const cards = [...result.actionCards, ...modelCards];
        const text = result.text || (cards.length ? "" : "I could not put an answer together. Please try asking in a different way.");
        const saved = await finishQuestion({
          tenantId, businessId, userId, ipAddress, db,
          conversationId: begun.conversationId,
          usageId: begun.usageId,
          model: choice.model,
          text,
          cards,
          toolCalls: result.toolCalls,
          usage: result.usage,
          status: "ok",
        });
        logger.info({ tenantId, usageId: begun.usageId, model: choice.model, tokens: result.usage, rounds: result.rounds, tools: result.toolCalls.length, costPaise: saved.costPaise, stop: result.stopReason }, "[ai] question answered");
        const account = await getEntitlements(tenantId).then((ent) => loadAiAccount(tenantId, ent)).catch(() => null);
        await send("done", { conversationId: begun.conversationId, messageId: saved.messageId, text, cards, remaining: account?.allowance.remaining ?? null });
      } catch (err) {
        const aborted = controller.signal.aborted;
        const spent = state.usage.inputTokens + state.usage.outputTokens + state.usage.cacheReadTokens + state.usage.cacheWriteTokens > 0 ? { model: choice.model, usage: state.usage } : undefined;
        if (aborted && state.visible.trim()) {
          // The person stopped it (or the connection dropped) after text began: the answer so far is kept and counted.
          await finishQuestion({
            tenantId, businessId, userId, ipAddress, db,
            conversationId: begun.conversationId, usageId: begun.usageId, model: choice.model,
            text: state.visible.trim(), cards: state.actionCards, toolCalls: state.toolCalls, usage: state.usage, status: "aborted",
          }).catch((e) => logger.error({ err: e }, "[ai] could not save a stopped answer"));
          await send("error", { code: "stopped", message: "Stopped." });
        } else {
          // Nothing useful was produced: give the question back.
          await refundPending(tenantId, begun.usageId, spent).catch((e) => logger.error({ err: e }, "[ai] refund failed"));
          if (aborted) {
            await send("error", { code: "stopped", message: "Stopped. Your question was not counted." });
          } else {
            if (err instanceof AiProviderError) logger.warn({ status: err.status, message: err.message }, "[ai] provider error");
            else logger.error({ err }, "[ai] question failed");
            await send("error", {
              code: err instanceof AiProviderError ? "provider_error" : "internal",
              message: "The AI service had a problem just now. Your question was not counted. Please try again in a moment.",
            });
          }
        }
      } finally {
        clearTimeout(timer);
      }
    });
  });
}

