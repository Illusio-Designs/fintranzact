/**
 * Client of POST /api/ai/stream (server-sent events). Same identity as every
 * other call: the session cookie (or the desktop Bearer token), X-Requested-With
 * and the x-business-id header. The server validates everything it sends back;
 * cards are validated again here before they are ever rendered.
 */

import { parseTrustedAiCards, type AiAnyCard, type AiPageContext } from "@fintranzact/shared";
import { apiUrl } from "@/lib/api-url";
import { getBusinessId } from "@/lib/trpc";
import { isDesktop } from "@/lib/isDesktop";
import { ensureAccessToken } from "@/lib/desktop-session";

export type AiStreamEvent =
  | { event: "meta"; data: { conversationId: string; model: string; tier: string } }
  | { event: "tool"; data: { name: string; status: string } }
  | { event: "text"; data: { delta: string } }
  | { event: "done"; data: { conversationId: string; messageId: string; text: string; cards: AiAnyCard[]; remaining: number | null } }
  | { event: "error"; data: { code: string; message: string } };

/** A refusal before the stream started (add-on, quota, switched off, not configured, rate limit, ...). */
export class AiRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "AiRequestError";
  }
}

const FRIENDLY: Record<string, string> = {
  rate_limited: "You are asking too fast. Wait a moment and try again.",
  unauthorized: "Your session has ended. Please sign in again.",
};

/** Split an SSE text buffer into complete messages; returns what is left over. */
export function splitSse(buffer: string): { messages: Array<{ event: string; data: string }>; rest: string } {
  const normal = buffer.replace(/\r\n/g, "\n");
  const parts = normal.split("\n\n");
  const rest = parts.pop() ?? "";
  const messages: Array<{ event: string; data: string }> = [];
  for (const raw of parts) {
    let event = "message";
    const data: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length) messages.push({ event, data: data.join("\n") });
  }
  return { messages, rest };
}

/** Turn a server message into a typed event (unknown events and bad JSON are ignored). Cards are re-validated. */
export function toAiEvent(message: { event: string; data: string }): AiStreamEvent | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(message.data) as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (message.event) {
    case "meta":
    case "tool":
    case "text":
    case "error":
      return { event: message.event, data } as AiStreamEvent;
    case "done":
      return { event: "done", data: { ...data, cards: parseTrustedAiCards(data.cards ?? []) } } as unknown as AiStreamEvent;
    default:
      return null;
  }
}

export interface StreamOptions {
  message: string;
  conversationId?: string;
  /** The page the person is on (allowlisted shapes only; the server verifies it). */
  context?: AiPageContext | null;
  signal?: AbortSignal;
  onEvent: (event: AiStreamEvent) => void;
  fetchImpl?: typeof fetch;
}

/**
 * Ask a question and report events as they arrive. Resolves when the stream
 * ends; rejects with AiRequestError for a refusal before it started.
 */
export async function streamAiAnswer(opts: StreamOptions): Promise<void> {
  const desktop = isDesktop();
  const headers: Record<string, string> = { "content-type": "application/json", "X-Requested-With": "fintranzact" };
  const businessId = getBusinessId();
  if (businessId) headers["x-business-id"] = businessId;
  if (desktop) {
    headers["x-fintranzact-client"] = "desktop";
    const token = await ensureAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(apiUrl("/api/ai/stream"), {
      method: "POST",
      headers,
      credentials: desktop ? "omit" : "include",
      body: JSON.stringify({ message: opts.message, ...(opts.conversationId ? { conversationId: opts.conversationId } : {}), ...(opts.context ? { context: opts.context } : {}) }),
      signal: opts.signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new AiRequestError("You appear to be offline. Check your internet connection and try again.", 0, "offline");
  }

  if (!res.ok || !res.body) {
    let body: { error?: string; code?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* not JSON */
    }
    const code = body.code ?? (res.status === 429 ? "rate_limited" : "internal");
    throw new AiRequestError(body.error || FRIENDLY[code] || "Something went wrong. Please try again.", res.status, code);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { messages, rest } = splitSse(buffer);
    buffer = rest;
    for (const m of messages) {
      const ev = toAiEvent(m);
      if (ev) opts.onEvent(ev);
    }
  }
  const { messages } = splitSse(`${buffer}\n\n`);
  for (const m of messages) {
    const ev = toAiEvent(m);
    if (ev) opts.onEvent(ev);
  }
}
