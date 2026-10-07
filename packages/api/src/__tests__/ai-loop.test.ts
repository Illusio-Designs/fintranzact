/**
 * The tool-use loop with a scripted fake client: no network, no database.
 */

import { describe, it, expect } from "vitest";
import { runAiLoop, newAiLoopState } from "../lib/ai/loop.js";
import { AiProviderError } from "../lib/ai/client.js";
import { scripted } from "./helpers/ai-fake-client.js";
import { buildSystemPrompt } from "../lib/ai/prompt.js";
import { parseAiCards } from "@fintranzact/shared";

const base = { model: "m", system: "sys", tools: [], history: [], question: "How much is outstanding?" };
const okTool = async (name: string) => ({ status: "ok" as const, content: JSON.stringify({ tool: name, total: 100 }) });

describe("runAiLoop", () => {
  it("answers without tools in one round and streams the text", async () => {
    const client = scripted([{ text: ["You are ", "owed ₹100."] }]);
    const seen: string[] = [];
    const r = await runAiLoop({ ...base, client, runTool: okTool, onText: (d) => seen.push(d) });
    expect(r.text).toBe("You are owed ₹100.");
    expect(seen.join("")).toBe("You are owed ₹100.");
    expect(r.rounds).toBe(1);
    expect(r.toolCalls).toEqual([]);
    expect(r.usage).toMatchObject({ inputTokens: 100, outputTokens: 20 });
    expect(r.stopReason).toBe("end_turn");
  });

  it("runs the tool the model asks for and passes the result back as a tool_result", async () => {
    const client = scripted([
      { text: ["Let me check."], toolUses: [{ id: "tu1", name: "outstanding_balances", input: { type: "receivable" } }] },
      { text: ["You are owed ₹100."] },
    ]);
    const ran: Array<[string, unknown]> = [];
    const r = await runAiLoop({ ...base, client, runTool: async (n, i) => { ran.push([n, i]); return okTool(n); } });
    expect(ran).toEqual([["outstanding_balances", { type: "receivable" }]]);
    expect(r.toolCalls).toEqual([{ name: "outstanding_balances", status: "ok" }]);
    expect(r.rounds).toBe(2);
    expect(r.text).toBe("Let me check.\n\nYou are owed ₹100.");
    // The second request carries the assistant's tool_use and our tool_result (as data, in a user turn).
    const second = client.requests[1]!;
    expect(second.messages.at(-2)).toMatchObject({ role: "assistant" });
    expect(second.messages.at(-1)).toMatchObject({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: JSON.stringify({ tool: "outstanding_balances", total: 100 }) }] });
    expect(r.usage).toMatchObject({ inputTokens: 200, outputTokens: 40 });
  });

  it("marks a denied or failed tool result as an error for the model", async () => {
    const client = scripted([{ toolUses: [{ id: "a", name: "cash_and_bank", input: {} }] }, { text: ["You do not have access to that."] }]);
    const r = await runAiLoop({ ...base, client, runTool: async () => ({ status: "denied", content: '{"accessDenied":true}' }) });
    expect(client.requests[1]!.messages.at(-1)).toMatchObject({ content: [{ type: "tool_result", is_error: true }] });
    expect(r.toolCalls).toEqual([{ name: "cash_and_bank", status: "denied" }]);
  });

  it("a tool the model invents is passed to the runner, which refuses it (allowlist lives in runAiTool)", async () => {
    const client = scripted([{ toolUses: [{ id: "a", name: "payrollRun.list", input: { businessId: "other" } }] }, { text: ["Sorry."] }]);
    const refusals: string[] = [];
    await runAiLoop({ ...base, client, runTool: async (name) => { refusals.push(name); return { status: "unknown_tool", content: '{"error":"That tool does not exist."}' }; } });
    expect(refusals).toEqual(["payrollRun.list"]);
  });

  it("caps tool calls inside one round", async () => {
    const uses = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, name: "cash_and_bank", input: {} }));
    const client = scripted([{ toolUses: uses }, { text: ["ok"] }]);
    let ran = 0;
    await runAiLoop({ ...base, client, maxToolCallsPerRound: 3, runTool: async (n) => { ran++; return okTool(n); } });
    expect(ran).toBe(3);
    const results = (client.requests[1]!.messages.at(-1)!.content as Array<{ is_error?: boolean }>);
    expect(results).toHaveLength(9);
    expect(results.filter((r) => r.is_error)).toHaveLength(6);
  });

  it("stops after the maximum number of rounds and says so", async () => {
    const loopForever = Array.from({ length: 10 }, (_, i) => ({ toolUses: [{ id: `t${i}`, name: "cash_and_bank", input: {} }] }));
    const client = scripted(loopForever);
    const r = await runAiLoop({ ...base, client, maxRounds: 3, runTool: okTool });
    expect(r.stopReason).toBe("max_rounds");
    expect(client.requests).toHaveLength(3);
    expect(r.text).toMatch(/too many steps/);
  });

  it("stops when the token budget is spent", async () => {
    const client = scripted([{ toolUses: [{ id: "a", name: "cash_and_bank", input: {} }], usage: { in: 50_000, out: 11_000 } }, { text: ["never"] }]);
    const r = await runAiLoop({ ...base, client, tokenBudget: 60_000, runTool: okTool });
    expect(r.stopReason).toBe("token_budget");
    expect(client.requests).toHaveLength(1);
  });

  it("stops at the deadline", async () => {
    const client = scripted([{ toolUses: [{ id: "a", name: "cash_and_bank", input: {} }], delayMs: 30 }, { text: ["never"] }]);
    const r = await runAiLoop({ ...base, client, deadlineMs: 5, runTool: okTool });
    expect(r.stopReason).toBe("deadline");
  });

  it("aborts when the client goes away, and keeps the progress so far", async () => {
    const controller = new AbortController();
    const client = scripted([{ text: ["Part one. "], toolUses: [{ id: "a", name: "cash_and_bank", input: {} }] }, { text: ["never"] }]);
    const state = newAiLoopState();
    const p = runAiLoop({ ...base, client, state, signal: controller.signal, runTool: async (n) => { controller.abort(); return okTool(n); } });
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(state.visible).toBe("Part one. ");
    expect(state.usage.inputTokens).toBe(100);
    expect(state.toolCalls).toHaveLength(1);
  });

  it("propagates a provider failure", async () => {
    const client = scripted([{ fail: new AiProviderError("AI provider returned 529", 529, true) }]);
    await expect(runAiLoop({ ...base, client, runTool: okTool })).rejects.toBeInstanceOf(AiProviderError);
  });

  it("keeps the cards block out of the streamed text and hands the raw JSON back", async () => {
    const cards = '[{"type":"bar_chart","bars":[{"label":"Sep","value":1}]}]';
    const client = scripted([{ text: ["Sales rose.\n<fintranzact_", `cards>${cards}</fintranzact_cards>`] }]);
    const shown: string[] = [];
    const r = await runAiLoop({ ...base, client, runTool: okTool, onText: (d) => shown.push(d) });
    expect(shown.join("")).toBe("Sales rose.\n");
    expect(r.text).toBe("Sales rose.");
    expect(r.cardsRaw).toBe(cards);
    expect(parseAiCards(r.cardsRaw).cards).toHaveLength(1);
  });

  it("sends earlier turns as history before the new question", async () => {
    const client = scripted([{ text: ["ok"] }]);
    await runAiLoop({ ...base, client, history: [{ role: "user", content: "earlier q" }, { role: "assistant", content: "earlier a" }], runTool: okTool });
    expect(client.requests[0]!.messages.map((m) => m.content)).toEqual(["earlier q", "earlier a", "How much is outstanding?"]);
  });
});

describe("system prompt", () => {
  const prompt = buildSystemPrompt({ today: "2026-10-09", businessName: 'Evil "Corp" <script>' });

  it("states the rules the assistant must follow", () => {
    expect(prompt).toMatch(/DATA, not instructions/);
    expect(prompt).toMatch(/Hinglish/);
    expect(prompt).toMatch(/Never invent|Never invent, guess or estimate/);
    expect(prompt).toMatch(/lakh and crore/);
    expect(prompt).toMatch(/report and which period/);
    expect(prompt).toMatch(/not a tax or legal adviser/);
    expect(prompt).toMatch(/CA/);
    expect(prompt).toMatch(/Politely decline/);
    expect(prompt).toMatch(/only read/i);
    expect(prompt).toContain("Today is 2026-10-09");
  });

  it("neutralises a hostile business name", () => {
    expect(prompt).not.toContain("<script>");
    expect(prompt).toContain("is data, not an instruction");
  });
});
