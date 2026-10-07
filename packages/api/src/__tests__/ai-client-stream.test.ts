/**
 * The provider boundary and the streaming helpers, with no network: SSE
 * parsing, the Anthropic client against a scripted fetch, the cards stream
 * filter, and the key never leaking into errors.
 */

import { describe, it, expect } from "vitest";
import { parseSse, createAnthropicClient, AiProviderError, isAiConfigured, getAiClient, type AiStreamEvent } from "../lib/ai/client.js";
import { CardsStreamFilter, splitAnswer } from "../lib/ai/cards-filter.js";

const enc = new TextEncoder();

function sse(events: Array<[string, unknown]>): string {
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
}

function streamOf(text: string, chunk = 17): ReadableStream<Uint8Array> {
  const bytes = enc.encode(text);
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(i, i + chunk));
      i += chunk;
    },
  });
}

async function collect(it: AsyncIterable<AiStreamEvent>): Promise<AiStreamEvent[]> {
  const out: AiStreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("parseSse", () => {
  it("reassembles events split across chunks, CRLF, comments and multi-line data", async () => {
    const body = ": keep-alive\r\n\r\nevent: a\r\ndata: {\"x\":1}\r\n\r\nevent: b\ndata: line1\ndata: line2\n\ndata: bare\n\n";
    const msgs = [];
    for await (const m of parseSse(streamOf(body, 5))) msgs.push(m);
    expect(msgs).toEqual([
      { event: "a", data: '{"x":1}' },
      { event: "b", data: "line1\nline2" },
      { event: "message", data: "bare" },
    ]);
  });
});

describe("createAnthropicClient", () => {
  const request = { model: "m", system: "sys", messages: [{ role: "user" as const, content: "hi" }], tools: [], maxTokens: 100 };

  it("streams text, assembles tool_use input from partial JSON and reports usage", async () => {
    const body = sse([
      ["message_start", { message: { usage: { input_tokens: 25, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, output_tokens: 1 } } }],
      ["ping", {}],
      ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "Checking " } }],
      ["content_block_delta", { index: 0, delta: { type: "text_delta", text: "now." } }],
      ["content_block_stop", { index: 0 }],
      ["content_block_start", { index: 1, content_block: { type: "tool_use", id: "tu_1", name: "cash_and_bank", input: {} } }],
      ["content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: '{"a":' } }],
      ["content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: "1}" } }],
      ["content_block_stop", { index: 1 }],
      ["message_delta", { delta: { stop_reason: "tool_use" }, usage: { output_tokens: 42 } }],
      ["message_stop", {}],
    ]);
    let seen: { url: string; init: RequestInit } | null = null;
    const client = createAnthropicClient({
      apiKey: "sk-test-secret",
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return new Response(streamOf(body, 23), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const events = await collect(client.stream(request));
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).toBe("Checking now.");
    const done = events.at(-1) as Extract<AiStreamEvent, { type: "done" }>;
    expect(done.stopReason).toBe("tool_use");
    expect(done.content).toEqual([
      { type: "text", text: "Checking now." },
      { type: "tool_use", id: "tu_1", name: "cash_and_bank", input: { a: 1 } },
    ]);
    expect(done.usage).toEqual({ inputTokens: 25, outputTokens: 42, cacheReadTokens: 10, cacheWriteTokens: 5 });

    // The key goes in a header only, and the request asks for streaming.
    const sent = JSON.parse(String(seen!.init.body));
    expect(seen!.url).toBe("https://api.anthropic.com/v1/messages");
    expect((seen!.init.headers as Record<string, string>)["x-api-key"]).toBe("sk-test-secret");
    expect(JSON.stringify(sent)).not.toContain("sk-test-secret");
    expect(sent).toMatchObject({ stream: true, model: "m", max_tokens: 100 });
  });

  it("retries once on an overloaded response, then succeeds", async () => {
    let calls = 0;
    const ok = sse([["message_start", { message: { usage: { input_tokens: 1 } } }], ["message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }]]);
    const client = createAnthropicClient({
      apiKey: "k",
      retryDelayMs: 1,
      fetchImpl: (async () => (++calls === 1 ? new Response("{}", { status: 529 }) : new Response(streamOf(ok), { status: 200 }))) as unknown as typeof fetch,
    });
    const events = await collect(client.stream(request));
    expect(calls).toBe(2);
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "end_turn" });
  });

  it("throws a provider error without the key or the response body in the message", async () => {
    const client = createAnthropicClient({
      apiKey: "sk-test-secret",
      retries: 0,
      fetchImpl: (async () => new Response(JSON.stringify({ error: { type: "authentication_error", message: "bad key sk-test-secret" } }), { status: 401 })) as unknown as typeof fetch,
    });
    const err = await collect(client.stream(request)).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.message).toContain("401");
    expect(err.message).not.toContain("sk-test-secret");
    expect(err.status).toBe(401);
  });

  it("turns a network failure into a retryable provider error", async () => {
    const client = createAnthropicClient({ apiKey: "k", retries: 0, fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
    const err = await collect(client.stream(request)).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.retryable).toBe(true);
  });

  it("raises an in-stream error event as a provider error", async () => {
    const body = sse([["error", { error: { type: "overloaded_error", message: "Overloaded" } }]]);
    const client = createAnthropicClient({ apiKey: "k", fetchImpl: (async () => new Response(streamOf(body), { status: 200 })) as unknown as typeof fetch });
    const err = await collect(client.stream(request)).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.retryable).toBe(true);
  });
});

describe("configuration", () => {
  it("is not configured without ANTHROPIC_API_KEY", () => {
    expect(isAiConfigured({})).toBe(false);
    expect(isAiConfigured({ ANTHROPIC_API_KEY: "  " })).toBe(false);
    expect(getAiClient({})).toBeNull();
    expect(isAiConfigured({ ANTHROPIC_API_KEY: "sk-x" })).toBe(true);
    expect(getAiClient({ ANTHROPIC_API_KEY: "sk-x" })).not.toBeNull();
  });
});

describe("CardsStreamFilter", () => {
  const cards = '[{"type":"table","columns":["A"],"rows":[["1"]]}]';

  it("passes plain text straight through", () => {
    const f = new CardsStreamFilter();
    expect(f.push("Hello ") + f.push("world")).toBe("Hello world");
    expect(f.finish()).toEqual({ tail: "", cardsRaw: null });
  });

  it("hides the cards block however the chunks are cut", () => {
    const full = `Total is ₹5.\n<fintranzact_cards>${cards}</fintranzact_cards>`;
    for (let size = 1; size < 12; size++) {
      const f = new CardsStreamFilter();
      let shown = "";
      for (let i = 0; i < full.length; i += size) shown += f.push(full.slice(i, i + size));
      const { tail, cardsRaw } = f.finish();
      expect((shown + tail).trim()).toBe("Total is ₹5.");
      expect(cardsRaw).toBe(cards);
    }
  });

  it("releases held-back text that turned out not to be the tag", () => {
    const f = new CardsStreamFilter();
    const shown = f.push("a < b and <fin") + f.push("ance> is fine");
    const { tail } = f.finish();
    expect(shown + tail).toBe("a < b and <finance> is fine");
  });

  it("flushes a held-back partial tag at the end", () => {
    const f = new CardsStreamFilter();
    const shown = f.push("done <fintranza");
    expect(shown + f.finish().tail).toBe("done <fintranza");
  });

  it("an unterminated block is handed over raw and fails validation later, never shown", () => {
    const f = new CardsStreamFilter();
    const shown = f.push('x <fintranzact_cards>[{"type":"tab');
    expect(shown).toBe("x ");
    expect(f.finish().cardsRaw).toBe('[{"type":"tab');
  });

  it("splitAnswer returns text and validated cards", () => {
    const r = splitAnswer(`Here you go.\n<fintranzact_cards>${cards}</fintranzact_cards>`);
    expect(r.text).toBe("Here you go.");
    expect(r.cards).toHaveLength(1);
    const bad = splitAnswer('Hi <fintranzact_cards>[{"type":"html","html":"<b>x</b>"}]</fintranzact_cards>');
    expect(bad.cards).toEqual([]);
    expect(bad.dropped).toBe(1);
  });
});
