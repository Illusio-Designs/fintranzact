import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/trpc", () => ({ getBusinessId: () => "biz-1" }));
vi.mock("@/lib/isDesktop", () => ({ isDesktop: () => false }));
vi.mock("@/lib/desktop-session", () => ({ ensureAccessToken: async () => null }));

import { AiRequestError, splitSse, streamAiAnswer, toAiEvent, type AiStreamEvent } from "../ai-stream";

const enc = new TextEncoder();
function body(text: string, chunk = 9): ReadableStream<Uint8Array> {
  const bytes = enc.encode(text);
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + chunk));
      i += chunk;
    },
  });
}

describe("splitSse", () => {
  it("returns complete messages and keeps the unfinished tail", () => {
    const r = splitSse('event: text\ndata: {"delta":"a"}\n\nevent: text\ndata: {"del');
    expect(r.messages).toEqual([{ event: "text", data: '{"delta":"a"}' }]);
    expect(r.rest).toBe('event: text\ndata: {"del');
  });
  it("handles CRLF", () => {
    expect(splitSse("event: x\r\ndata: 1\r\n\r\n").messages).toEqual([{ event: "x", data: "1" }]);
  });
});

describe("toAiEvent", () => {
  it("ignores unknown events and bad JSON", () => {
    expect(toAiEvent({ event: "weird", data: "{}" })).toBeNull();
    expect(toAiEvent({ event: "text", data: "{not json" })).toBeNull();
  });

  it("re-validates cards on done: unknown types and bad links never reach the screen", () => {
    const ev = toAiEvent({
      event: "done",
      data: JSON.stringify({
        conversationId: "c", messageId: "m", text: "hi", remaining: 3,
        cards: [
          { type: "html", html: "<img src=x onerror=alert(1)>" },
          { type: "link", label: "x", target: { kind: "url", href: "https://evil.example" } },
          { type: "table", columns: ["A"], rows: [["1"]] },
        ],
      }),
    }) as Extract<AiStreamEvent, { event: "done" }>;
    expect(ev.data.cards).toEqual([{ type: "table", columns: ["A"], rows: [["1"]] }]);
    expect(ev.data.text).toBe("hi");
  });
});

describe("toAiEvent: confirmation cards", () => {
  const ACTION = "3f0f4d7e-8d7b-4a53-9a10-2f4f8d3c1a11";
  const card = {
    type: "confirmation", actionId: ACTION, kind: "create_party", title: "Add customer", status: "pending",
    fields: [{ label: "Name", value: "Meera Stores" }], totals: [], warnings: [], edits: [], expiresAt: "2026-10-09T06:30:00.000Z",
  };
  const done = (cards: unknown[]) => toAiEvent({ event: "done", data: JSON.stringify({ conversationId: "c", messageId: "m", text: "hi", remaining: 3, cards }) }) as Extract<AiStreamEvent, { event: "done" }>;

  it("keeps a valid confirmation card from the server and drops malformed or unknown-kind ones", () => {
    const ev = done([card, { ...card, kind: "delete_everything" }, { ...card, actionId: "not-a-uuid" }, { ...card, result: { entityType: "reminder", label: "x", externalUrl: "https://evil.example/x" } }]);
    expect(ev.data.cards).toEqual([expect.objectContaining({ type: "confirmation", actionId: ACTION })]);
  });

  it("cleans the text of a card (control characters and angle brackets)", () => {
    const ev = done([{ ...card, title: "<img src=x onerror=alert(1)>Add" }]);
    expect((ev.data.cards[0] as { title: string }).title).not.toMatch(/[<>]/);
  });
});

describe("streamAiAnswer", () => {
  const sse = (events: Array<[string, unknown]>) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");

  it("posts the question with the CSRF and business headers and reports events in order", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(body(sse([["meta", { conversationId: "c1", model: "m", tier: "fast" }], ["text", { delta: "Hel" }], ["text", { delta: "lo" }], ["done", { conversationId: "c1", messageId: "m1", text: "Hello", cards: [], remaining: 9 }]])), { status: 200 });
    }) as unknown as typeof fetch;
    const events: AiStreamEvent[] = [];
    await streamAiAnswer({ message: "hi", conversationId: "c0", onEvent: (e) => events.push(e), fetchImpl });
    expect(events.map((e) => e.event)).toEqual(["meta", "text", "text", "done"]);
    expect(seen!.url).toBe("/api/ai/stream");
    expect(seen!.init).toMatchObject({ method: "POST", credentials: "include" });
    expect(seen!.init.headers).toMatchObject({ "X-Requested-With": "fintranzact", "x-business-id": "biz-1" });
    expect(JSON.parse(String(seen!.init.body))).toEqual({ message: "hi", conversationId: "c0" });
  });

  it("sends the page context only when there is one", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(body(sse([["done", { conversationId: "c1", messageId: "m1", text: "ok", cards: [], remaining: 9 }]])), { status: 200 });
    }) as unknown as typeof fetch;
    const id = "3f0f4d7e-8d7b-4a53-9a10-2f4f8d3c1a11";
    await streamAiAnswer({ message: "this invoice", context: { kind: "invoice", id }, onEvent: () => undefined, fetchImpl });
    await streamAiAnswer({ message: "no page", context: null, onEvent: () => undefined, fetchImpl });
    await streamAiAnswer({ message: "no page either", onEvent: () => undefined, fetchImpl });
    expect(bodies).toEqual([{ message: "this invoice", context: { kind: "invoice", id } }, { message: "no page" }, { message: "no page either" }]);
  });

  it("raises AiRequestError with the server's message and code for a refusal before the stream", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: "Your organisation has used all its AI questions for this month. Ask your owner to add more.", code: "quota_exhausted" }), { status: 403 })) as unknown as typeof fetch;
    const err = await streamAiAnswer({ message: "hi", onEvent: () => undefined, fetchImpl }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(AiRequestError);
    expect(err).toMatchObject({ status: 403, code: "quota_exhausted" });
    expect(err.message).toMatch(/Ask your owner/);
  });

  it("maps a network failure to an offline message, and a rate limit to a friendly one", async () => {
    const offline = await streamAiAnswer({ message: "hi", onEvent: () => undefined, fetchImpl: (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch }).then(() => null, (e) => e);
    expect(offline).toMatchObject({ code: "offline" });
    const limited = await streamAiAnswer({ message: "hi", onEvent: () => undefined, fetchImpl: (async () => new Response("nope", { status: 429 })) as unknown as typeof fetch }).then(() => null, (e) => e);
    expect(limited).toMatchObject({ status: 429, code: "rate_limited" });
    expect(limited.message).toMatch(/too fast/);
  });

  it("rethrows an abort so the panel can tell a stop from a failure", async () => {
    const c = new AbortController();
    c.abort();
    const err = await streamAiAnswer({ message: "hi", signal: c.signal, onEvent: () => undefined, fetchImpl: (async () => { throw new DOMException("Aborted", "AbortError"); }) as unknown as typeof fetch }).then(() => null, (e) => e);
    expect(err).toMatchObject({ name: "AbortError" });
  });
});
