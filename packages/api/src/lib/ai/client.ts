/**
 * The model provider boundary of the AI assistant.
 *
 * `AiClient` is the only thing the rest of the assistant knows about the
 * provider: tests inject a scripted fake, production uses
 * `createAnthropicClient` (a small fetch client for the Anthropic Messages API
 * with streaming; no SDK dependency to keep the supply chain short).
 *
 * The API key is read from the environment by `getAiClient()` only, handed to
 * the fetch call as a header, and never put in an error message, a log line or
 * anything returned to a client.
 */

import type { AiTokenUsage } from "@fintranzact/shared";

export interface AiToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type AiContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface AiMessage {
  role: "user" | "assistant";
  content: string | AiContentBlock[];
}

export interface AiStreamRequest {
  model: string;
  system: string;
  messages: AiMessage[];
  tools: AiToolDef[];
  maxTokens: number;
  signal?: AbortSignal;
}

export type AiStreamEvent =
  | { type: "text"; text: string }
  | { type: "done"; content: AiContentBlock[]; stopReason: string; usage: AiTokenUsage };

export interface AiClient {
  stream(req: AiStreamRequest): AsyncIterable<AiStreamEvent>;
}

/** A failure of the provider (network, rate limit, overload, bad key). The message is safe to log; it never holds the key. */
export class AiProviderError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
    this.name = "AiProviderError";
  }
}

// ── Configuration ────────────────────────────────────────────────────────────

export function isAiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.ANTHROPIC_API_KEY ?? "").trim().length > 0;
}

/** The production client, or null when ANTHROPIC_API_KEY is not set. */
export function getAiClient(env: NodeJS.ProcessEnv = process.env): AiClient | null {
  const key = (env.ANTHROPIC_API_KEY ?? "").trim();
  return key ? createAnthropicClient({ apiKey: key }) : null;
}

// ── Server-sent events ───────────────────────────────────────────────────────

export interface SseMessage {
  event: string;
  data: string;
}

/** Parse a text/event-stream body into messages (handles chunks split anywhere, CRLF, comments). */
export async function* parseSse(body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const decoder = new TextDecoder();
  let buffer = "";
  const chunks: AsyncIterable<Uint8Array> =
    Symbol.asyncIterator in body ? (body as AsyncIterable<Uint8Array>) : readableToAsync(body as ReadableStream<Uint8Array>);
  // A blank line ends a message; the line ending may be \n, \r\n or \r, and may arrive split across chunks.
  const boundary = /\r\n\r\n|\n\n|\r\r/;
  const flush = function* (final: boolean): Generator<SseMessage> {
    for (;;) {
      const m = boundary.exec(buffer);
      if (!m) break;
      const raw = buffer.slice(0, m.index);
      buffer = buffer.slice(m.index + m[0].length);
      const msg = toMessage(raw);
      if (msg) yield msg;
    }
    if (final && buffer.trim()) {
      const msg = toMessage(buffer);
      buffer = "";
      if (msg) yield msg;
    }
  };
  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true });
    yield* flush(false);
  }
  buffer += decoder.decode();
  yield* flush(true);
}

async function* readableToAsync(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function toMessage(raw: string): SseMessage | null {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length || event !== "message" ? { event, data: data.join("\n") } : null;
}

// ── Anthropic Messages API ───────────────────────────────────────────────────

export interface AnthropicClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Retries on 429 / 5xx / overload before any text has streamed (default 1). */
  retries?: number;
  retryDelayMs?: number;
}

const ANTHROPIC_VERSION = "2023-06-01";

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export function createAnthropicClient(opts: AnthropicClientOptions): AiClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = (opts.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  const maxRetries = opts.retries ?? 1;

  async function open(req: AiStreamRequest): Promise<Response> {
    const body = JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens,
      stream: true,
      // The system prompt and tool list are the same for every question of a model: cache them.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      ...(req.tools.length ? { tools: req.tools } : {}),
      messages: req.messages,
    });
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": opts.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body,
          signal: req.signal,
        });
      } catch (err) {
        if (req.signal?.aborted) throw err;
        if (attempt < maxRetries) {
          await sleep(opts.retryDelayMs ?? 800, req.signal);
          continue;
        }
        throw new AiProviderError("Could not reach the AI provider", undefined, true);
      }
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
      if (retryable && attempt < maxRetries) {
        await res.body?.cancel().catch(() => undefined);
        await sleep(opts.retryDelayMs ?? 800, req.signal);
        continue;
      }
      // Never echo the response body into logs verbatim: keep the provider's short error type only.
      let type = "";
      try {
        const parsed = (await res.json()) as { error?: { type?: string } };
        type = parsed.error?.type ?? "";
      } catch {
        /* not JSON */
      }
      throw new AiProviderError(`AI provider returned ${res.status}${type ? ` (${type})` : ""}`, res.status, retryable);
    }
  }

  return {
    async *stream(req) {
      const res = await open(req);
      if (!res.body) throw new AiProviderError("The AI provider sent an empty response");

      const blocks = new Map<number, { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; json: string }>();
      const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      let stopReason = "end_turn";
      const addUsage = (u: Usage | undefined, replaceOutput: boolean) => {
        if (!u) return;
        if (typeof u.input_tokens === "number") usage.inputTokens = u.input_tokens;
        if (typeof u.cache_read_input_tokens === "number") usage.cacheReadTokens = u.cache_read_input_tokens;
        if (typeof u.cache_creation_input_tokens === "number") usage.cacheWriteTokens = u.cache_creation_input_tokens;
        if (typeof u.output_tokens === "number") usage.outputTokens = replaceOutput ? u.output_tokens : Math.max(usage.outputTokens, u.output_tokens);
      };

      for await (const msg of parseSse(res.body)) {
        if (msg.event === "ping" || !msg.data) continue;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(msg.data) as Record<string, unknown>;
        } catch {
          continue;
        }
        switch (msg.event) {
          case "message_start":
            addUsage((data.message as { usage?: Usage } | undefined)?.usage, false);
            break;
          case "content_block_start": {
            const block = data.content_block as { type?: string; id?: string; name?: string; text?: string } | undefined;
            const index = data.index as number;
            if (block?.type === "text") {
              blocks.set(index, { type: "text", text: "" });
              if (block.text) {
                (blocks.get(index) as { text: string }).text += block.text;
                yield { type: "text", text: block.text };
              }
            } else if (block?.type === "tool_use") {
              blocks.set(index, { type: "tool_use", id: String(block.id ?? ""), name: String(block.name ?? ""), json: "" });
            }
            break;
          }
          case "content_block_delta": {
            const delta = data.delta as { type?: string; text?: string; partial_json?: string } | undefined;
            const block = blocks.get(data.index as number);
            if (!block || !delta) break;
            if (delta.type === "text_delta" && block.type === "text" && delta.text) {
              block.text += delta.text;
              yield { type: "text", text: delta.text };
            } else if (delta.type === "input_json_delta" && block.type === "tool_use" && delta.partial_json) {
              block.json += delta.partial_json;
            }
            break;
          }
          case "message_delta": {
            const d = data.delta as { stop_reason?: string } | undefined;
            if (d?.stop_reason) stopReason = d.stop_reason;
            addUsage(data.usage as Usage | undefined, true);
            break;
          }
          case "error": {
            const e = data.error as { type?: string } | undefined;
            const overloaded = e?.type === "overloaded_error" || e?.type === "rate_limit_error";
            throw new AiProviderError(`AI provider error${e?.type ? ` (${e.type})` : ""}`, undefined, overloaded);
          }
          default:
            break;
        }
      }

      const content: AiContentBlock[] = [...blocks.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, b]) => {
          if (b.type === "text") return { type: "text" as const, text: b.text };
          let input: unknown = {};
          try {
            input = b.json ? JSON.parse(b.json) : {};
          } catch {
            input = { __invalid: true };
          }
          return { type: "tool_use" as const, id: b.id, name: b.name, input };
        })
        .filter((b) => b.type !== "text" || b.text.length > 0);
      yield { type: "done", content, stopReason, usage };
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error("aborted"));
    }, { once: true });
  });
}
