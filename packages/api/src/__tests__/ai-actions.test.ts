/**
 * The assistant's action layer without a database: the tool-use loop with the
 * scripted fake provider and PROPOSE tools produces proposals and cards, and
 * nothing in the loop, the tools, or the streaming route has a way to write or
 * to confirm. The database and the caller are recording stubs, so these tests
 * also prove which procedures a proposal touches (only reads).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { runAiLoop } from "../lib/ai/loop.js";
import { AI_TOOLS, AI_TOOL_NAMES, aiToolDefs, runAiTool, type AiActionToolContext, type AiCaller } from "../lib/ai/tools.js";
import { AI_ACTION_BY_TOOL, AI_ACTION_REGISTRY } from "../lib/ai/actions/registry.js";
import { buildSystemPrompt } from "../lib/ai/prompt.js";
import { defineAbilityFor } from "../lib/permissions.js";
import { actionKindsOf } from "../lib/ai/service.js";
import { parsePageContext } from "../lib/ai/page-context.js";
import { friendlyActionError } from "../lib/ai/actions/service.js";
import { runWithAuditSource, withAuditSource } from "../lib/audit-source.js";
import { AI_ACTION_KINDS, AI_ACTION_TOOL_NAMES } from "@fintranzact/shared";
import { scripted } from "./helpers/ai-fake-client.js";
import { TRPCError } from "@trpc/server";

const PARTY = "11111111-1111-4111-8111-111111111111";
const ACTION_ID = "99999999-9999-4999-8999-999999999999";

/** A caller whose every procedure records its path and answers from `answers`. */
function stubCaller(answers: Record<string, unknown>, calls: string[]): AiCaller {
  const handler = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_t, prop: string) => handler([...path, prop]),
      apply: async (_t, _this, args) => {
        const key = path.join(".");
        calls.push(key);
        const a = answers[key];
        if (a instanceof Error) throw a;
        return typeof a === "function" ? (a as (i: unknown) => unknown)(args[0]) : a;
      },
    });
  return handler([]) as AiCaller;
}

/** A tenant database stub: reads answer a count of 0, an insert returns the stored row, everything is recorded. */
function stubDb() {
  const writes: Array<{ op: string; table?: unknown; values?: unknown }> = [];
  const thenable = (value: unknown) => ({
    then: (res: (v: unknown) => unknown) => Promise.resolve(value).then(res),
    returning: async () => (Array.isArray(value) ? value : [value]),
  });
  const chain = (result: unknown): unknown =>
    new Proxy({}, { get: (_t, p) => (p === "then" ? (res: (v: unknown) => unknown) => Promise.resolve(result).then(res) : () => chain(result)) });
  const db = {
    select: () => chain([{ n: 0 }]),
    update: (table: unknown) => ({ set: () => ({ where: () => { writes.push({ op: "update", table }); return thenable([]); } }) }),
    delete: (table: unknown) => ({ where: () => { writes.push({ op: "delete", table }); return thenable([]); } }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        writes.push({ op: "insert", table, values });
        const row = { id: ACTION_ID, result: null, error: null, resolvedAt: null, createdAt: new Date(), updatedAt: new Date(), ...values };
        return thenable([row]);
      },
    }),
  };
  return { db, writes };
}

function ctxFor(role: string, calls: string[], answers: Record<string, unknown> = {}) {
  const { db, writes } = stubDb();
  const ability = defineAbilityFor({ userId: "u1", role });
  const caller = stubCaller(answers, calls);
  const ctx: AiActionToolContext = {
    db: db as never, tenantId: "t1", businessId: "b1", user: { id: "u1", name: "U" }, role, ability, caller,
    conversationId: null, kinds: actionKindsOf(ability), proposed: { count: 0 },
  };
  return { ctx, writes };
}

const WRITE_PROCEDURES = /^(invoice|quotation|payment|party|item|reminder|expense|stock|ai)\.(create|update|delete|record|send|sendNow|confirmAction|cancelAction|updateAction|adjust|merge)/;

describe("propose tools in the loop", () => {
  it("a scripted model prepares a party: the loop returns a confirmation card, the model is told nothing is saved, and no write procedure ran", async () => {
    const calls: string[] = [];
    const { ctx, writes } = ctxFor("superadmin", calls, { "party.list": { data: [], total: 0 } });
    const client = scripted([
      { toolUses: [{ id: "t1", name: "propose_create_party", input: { type: "customer", name: "Meera Stores", city: "Pune" } }] },
      { text: ["I prepared it. Please review and tap Confirm."] },
    ]);
    const result = await runAiLoop({
      client, model: "m", system: "s", tools: aiToolDefs(ctx.kinds), history: [], question: "Add a customer Meera Stores in Pune",
      runTool: (name, input) => runAiTool(ctx.caller, name, input, undefined, ctx),
    });
    expect(result.toolCalls).toEqual([{ name: "propose_create_party", status: "ok" }]);
    expect(result.actionCards).toHaveLength(1);
    expect(result.actionCards[0]).toMatchObject({ type: "confirmation", kind: "create_party", status: "pending", actionId: ACTION_ID, title: "Add customer" });
    // Only reads reached the caller; the only database insert is the pending proposal.
    expect(calls.filter((c) => WRITE_PROCEDURES.test(c))).toEqual([]);
    expect(writes.filter((w) => w.op === "insert").map((w) => (w.values as { status?: string; kind?: string }).kind ?? "audit")).toEqual(expect.arrayContaining(["create_party"]));
    const proposal = writes.find((w) => (w.values as { kind?: string } | undefined)?.kind === "create_party")!;
    expect(proposal.values).toMatchObject({ status: "pending", userId: "u1", businessId: "b1", kind: "create_party", payload: expect.objectContaining({ name: "Meera Stores", type: "customer" }) });
    // The tool result the model saw says it is waiting, and gives it nothing to confirm with.
    const toolResult = (client.requests[1]!.messages.at(-1)!.content as Array<{ content: string }>)[0]!.content;
    expect(JSON.parse(toolResult)).toMatchObject({ proposed: true, status: "waiting_for_the_person_to_confirm" });
    expect(toolResult).not.toContain(ACTION_ID);
    expect(toolResult).toMatch(/NOTHING is saved yet/);
  });

  it("an ambiguous or unknown reference comes back to the model as a message, not a guess", async () => {
    const calls: string[] = [];
    const rows = [
      { id: PARTY, name: "Asha Traders", type: "customer", city: "Pune", gstin: null },
      { id: "22222222-2222-4222-8222-222222222222", name: "Asha Textiles", type: "customer", city: "Surat", gstin: null },
    ];
    const { ctx, writes } = ctxFor("superadmin", calls, { "party.list": { data: rows, total: 2 } });
    const r = await runAiTool(ctx.caller, "propose_create_invoice", { partyName: "Asha", lines: [{ itemId: PARTY, quantity: 1 }] }, undefined, ctx);
    expect(r.status).toBe("bad_input");
    expect(r.card).toBeUndefined();
    expect(r.content).toContain("Asha Traders");
    expect(r.content).toContain("Asha Textiles");
    expect(r.content).toMatch(/Ask the person which one/);
    expect(writes.filter((w) => w.op === "insert")).toEqual([]); // nothing stored (the lazy sweep only touches old rows)
    expect(calls.filter((c) => WRITE_PROCEDURES.test(c))).toEqual([]);
  });

  it("a refusal for a missing permission is polite, and nothing is stored", async () => {
    const calls: string[] = [];
    const { ctx, writes } = ctxFor("seller", calls);
    const forced = { ...ctx, kinds: [...AI_ACTION_KINDS] };
    const r = await runAiTool(forced.caller, "propose_create_item", { name: "Lamp" }, undefined, forced);
    expect(r.status).toBe("denied");
    expect(JSON.parse(r.content)).toEqual({ error: "You do not have permission to do this. Ask your owner for access.", accessDenied: true });
    expect(writes.filter((w) => w.op === "insert")).toEqual([]);
  });

  it("a tool that is not offered does not exist, and without an action context no action tool runs at all", async () => {
    const calls: string[] = [];
    const { ctx, writes } = ctxFor("accountant", calls); // an accountant is offered only record_payment
    expect(ctx.kinds).toEqual(["record_payment"]);
    expect((await runAiTool(ctx.caller, "propose_create_invoice", { partyId: PARTY, lines: [{ itemId: PARTY, quantity: 1 }] }, undefined, ctx)).status).toBe("unknown_tool");
    expect((await runAiTool(ctx.caller, "propose_create_party", { type: "customer", name: "x" })).status).toBe("unknown_tool");
    expect(writes).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("proposing more than three actions in one question is refused", async () => {
    const calls: string[] = [];
    const { ctx } = ctxFor("superadmin", calls, { "party.list": { data: [], total: 0 } });
    const outcomes = [];
    for (let i = 0; i < 4; i++) outcomes.push(await runAiTool(ctx.caller, "propose_create_party", { type: "customer", name: `P${i}` }, undefined, ctx));
    expect(outcomes.map((o) => o.status)).toEqual(["ok", "ok", "ok", "bad_input"]);
  });
});

describe("the tool layer has no way to confirm", () => {
  it("every action tool is a propose tool; no tool anywhere is named or described as confirm, cancel, edit or execute", () => {
    const defs = aiToolDefs([...AI_ACTION_KINDS]);
    const names = defs.map((d) => d.name);
    expect(names.filter((n) => n.startsWith("propose_"))).toEqual(Object.values(AI_ACTION_TOOL_NAMES));
    expect(names.filter((n) => /confirm|cancel|update|edit|execute|approve|apply/i.test(n))).toEqual([]);
    // No tool takes an action id: the model cannot even name one.
    for (const d of defs) {
      const props = Object.keys((d.input_schema as { properties: Record<string, unknown> }).properties);
      expect(props, d.name).not.toContain("actionId");
      for (const forbidden of ["businessId", "tenantId", "userId", "organizationId", "confirm", "confirmed"]) expect(props, d.name).not.toContain(forbidden);
      expect(d.input_schema).toMatchObject({ additionalProperties: false });
    }
    expect(AI_TOOL_NAMES.every((n) => !n.startsWith("propose_"))).toBe(true);
    expect(AI_TOOLS.length).toBe(AI_TOOL_NAMES.length);
    expect([...AI_ACTION_BY_TOOL.keys()].sort()).toEqual(Object.values(AI_ACTION_TOOL_NAMES).sort());
  });

  it("names a model might try are refused without touching anything", async () => {
    const calls: string[] = [];
    const { ctx, writes } = ctxFor("superadmin", calls);
    for (const name of ["confirm_action", "confirmAction", "ai.confirmAction", "ai.cancelAction", "ai.updateAction", "cancel_action", "invoice.create", "payment.create", "propose_create_invoice ", "PROPOSE_CREATE_PARTY", "__proto__", "constructor", "toString"]) {
      const r = await runAiTool(ctx.caller, name, { id: ACTION_ID, actionId: ACTION_ID }, undefined, ctx);
      expect(r.status, name).toBe("unknown_tool");
    }
    expect(calls).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("the modules the model's tools and the stream run through never import the confirm, cancel or edit services", () => {
    const root = join(__dirname, "..");
    const files = [
      "lib/ai/tools.ts", "lib/ai/loop.ts", "lib/ai/prompt.ts", "lib/ai/page-context.ts", "lib/ai/cards-filter.ts", "http/aiStream.ts",
      ...readdirSync(join(root, "lib/ai/actions/kinds")).map((f) => `lib/ai/actions/kinds/${f}`),
    ];
    for (const f of files) {
      const src = readFileSync(join(root, f), "utf8");
      expect(src, f).not.toMatch(/confirmAiAction|cancelAiAction|updateAiAction|confirmAction|cancelAction|updateAction/);
    }
    // The confirm service is imported only by the tRPC router, the card buttons' procedures.
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) { if (e !== "__tests__" && e !== "node_modules" && e !== "data-audit") walk(p); continue; }
        if (/\.tsx?$/.test(e) && /\bconfirmAiAction\b/.test(readFileSync(p, "utf8"))) importers.push(p.slice(root.length + 1));
      }
    };
    walk(root);
    expect(importers.sort()).toEqual(["lib/ai/actions/service.ts", "routers/ai.ts"]);
  });

  it("the registry gives every kind a propose tool, a real-procedure builder, edits and an executor", () => {
    for (const kind of AI_ACTION_KINDS) {
      const def = AI_ACTION_REGISTRY[kind];
      expect(def.kind).toBe(kind);
      expect(def.toolName).toBe(AI_ACTION_TOOL_NAMES[kind]);
      for (const fn of ["propose", "build", "applyEdits", "execute"] as const) expect(typeof def[fn], `${kind}.${fn}`).toBe("function");
      expect(def.description).toMatch(/Nothing is (saved|sent)/);
    }
  });
});

describe("the system prompt", () => {
  it("only mentions actions when some are offered, and tells the model it can only prepare them", () => {
    const readOnly = buildSystemPrompt({ today: "2026-10-09", businessName: "X" });
    expect(readOnly).toMatch(/You can only read/);
    expect(readOnly).not.toMatch(/propose_/);
    const withActions = buildSystemPrompt({ today: "2026-10-09", businessName: "X", actions: ["create_invoice", "record_payment"] });
    expect(withActions).toContain("propose_create_invoice");
    expect(withActions).toContain("propose_record_payment");
    expect(withActions).not.toContain("propose_create_party");
    expect(withActions).toMatch(/only PREPARE/);
    expect(withActions).toMatch(/Never say it has been created, saved, recorded or sent/);
    expect(withActions).toMatch(/never guess/);
    expect(withActions).not.toMatch(/You can only read/);
    expect(withActions).toMatch(/Never write a confirmation card yourself/);
  });

  it("the page context block goes last, after the business line", () => {
    const p = buildSystemPrompt({ today: "2026-10-09", businessName: "X", pageContext: "Current page (verified): the person has invoice INV-1 open." });
    expect(p.trimEnd().endsWith("INV-1 open.")).toBe(true);
    expect(p.indexOf("The business is")).toBeLessThan(p.indexOf("Current page"));
  });
});

describe("page context parsing and errors for people", () => {
  it("anything outside the allowlist parses to nothing", () => {
    expect(parsePageContext({ kind: "invoice", id: PARTY })).toEqual({ kind: "invoice", id: PARTY });
    for (const bad of [undefined, null, 1, "x", [], {}, { kind: "invoice", id: "x" }, { kind: "ledger", id: PARTY }]) expect(parsePageContext(bad)).toBeNull();
  });

  it("a procedure's schema-failure message is not shown to people; its own business messages are", () => {
    expect(friendlyActionError(new TRPCError({ code: "BAD_REQUEST", message: '[{"code":"invalid_string","path":["partyId"]}]' }))).toMatch(/not valid any more/);
    expect(friendlyActionError(new TRPCError({ code: "FORBIDDEN", message: "Books are locked through 31 Mar 2026" }))).toBe("Books are locked through 31 Mar 2026");
    expect(friendlyActionError(new Error("connection to 10.0.0.5 refused, password=hunter2"))).not.toMatch(/hunter2|10\.0\.0\.5/);
  });
});

describe("audit source", () => {
  it("adds the source only inside a confirmed action's run, and never overrides an explicit one", async () => {
    expect(withAuditSource({ a: 1 })).toEqual({ a: 1 });
    expect(withAuditSource(undefined)).toBeUndefined();
    await runWithAuditSource({ source: "via AI assistant", actionId: ACTION_ID }, async () => {
      expect(withAuditSource({ a: 1 })).toEqual({ a: 1, source: "via AI assistant", aiActionId: ACTION_ID });
      expect(withAuditSource(undefined)).toEqual({ source: "via AI assistant", aiActionId: ACTION_ID });
      expect(withAuditSource({ source: "api key" })).toEqual({ source: "api key" });
      await Promise.resolve();
      expect(withAuditSource({})).toMatchObject({ source: "via AI assistant" }); // survives awaits
    });
    expect(withAuditSource({ a: 1 })).toEqual({ a: 1 });
  });
});
