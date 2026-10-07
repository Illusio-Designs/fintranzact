/**
 * The tool-use loop: ask the model, run the tools it asks for (only ones in the
 * allowlist, through the user's own caller), give the results back as data,
 * and repeat until it answers, with a cap on rounds, tokens and time. Text is
 * streamed to `onText` as it arrives; the cards block is filtered out of it.
 *
 * Provider and tool execution are injected, so tests drive it with a scripted
 * fake client and a fake tool runner (no network, no database).
 */

import type { AiConfirmationCard, AiTokenUsage } from "@fintranzact/shared";
import { AiProviderError, type AiClient, type AiContentBlock, type AiMessage, type AiToolDef } from "./client.js";
import type { AiToolOutcome, AiToolStatus } from "./tools.js";
import { CardsStreamFilter } from "./cards-filter.js";

export const DEFAULT_MAX_ROUNDS = 6;
export const DEFAULT_MAX_TOOL_CALLS_PER_ROUND = 6;
/** Total tokens (input + output, all rounds) one question may use before the loop stops asking for more. */
export const DEFAULT_TOKEN_BUDGET = 60_000;
export const DEFAULT_DEADLINE_MS = 90_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 1_500;

export interface AiLoopInput {
  client: AiClient;
  model: string;
  system: string;
  tools: AiToolDef[];
  /** Earlier turns of the conversation (text only). */
  history: AiMessage[];
  question: string;
  runTool: (name: string, input: unknown) => Promise<AiToolOutcome>;
  signal?: AbortSignal;
  maxRounds?: number;
  maxToolCallsPerRound?: number;
  tokenBudget?: number;
  deadlineMs?: number;
  maxOutputTokens?: number;
  onText?: (delta: string) => void;
  onToolStart?: (name: string) => void;
  onToolEnd?: (name: string, status: AiToolStatus) => void;
  /** Updated live (text shown so far, tokens, tool calls), so a failure or abort still knows what was spent. */
  state?: AiLoopState;
}

/** Progress the caller can read even when the loop is cut short by an error or an abort. */
export interface AiLoopState {
  visible: string;
  usage: Required<AiTokenUsage>;
  toolCalls: Array<{ name: string; status: AiToolStatus }>;
  rounds: number;
  /** Confirmation cards the action tools produced (server-built from stored proposals, never from model text). */
  actionCards: AiConfirmationCard[];
}

export function newAiLoopState(): AiLoopState {
  return { visible: "", usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, toolCalls: [], rounds: 0, actionCards: [] };
}

export interface AiLoopResult {
  /** The visible answer (cards block removed). */
  text: string;
  /** The raw JSON the model put between the cards tags, or null. */
  cardsRaw: string | null;
  usage: Required<AiTokenUsage>;
  toolCalls: Array<{ name: string; status: AiToolStatus }>;
  /** Confirmation cards proposed by action tools, in order. */
  actionCards: AiConfirmationCard[];
  rounds: number;
  /** end_turn, or why the loop stopped early: max_rounds, token_budget, deadline, max_tokens. */
  stopReason: string;
}

const STOP_NOTE = "I had to stop before finishing because this question needed too many steps. Please ask it in a narrower way, for example for one month or one party.";

export async function runAiLoop(input: AiLoopInput): Promise<AiLoopResult> {
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxCalls = input.maxToolCallsPerRound ?? DEFAULT_MAX_TOOL_CALLS_PER_ROUND;
  const budget = input.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const deadline = Date.now() + (input.deadlineMs ?? DEFAULT_DEADLINE_MS);

  const messages: AiMessage[] = [...input.history, { role: "user", content: input.question }];
  const state = input.state ?? newAiLoopState();
  const usage = state.usage;
  const toolCalls = state.toolCalls;
  const filter = new CardsStreamFilter();
  const emit = (text: string) => {
    if (!text) return;
    state.visible += text;
    input.onText?.(text);
  };

  let stopReason = "end_turn";

  for (;;) {
    if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    state.rounds++;
    let done: { content: AiContentBlock[]; stopReason: string; usage: AiTokenUsage } | null = null;

    // Separate the text of one round from the next when an earlier round spoke.
    let roundStarted = false;
    for await (const ev of input.client.stream({
      model: input.model,
      system: input.system,
      messages,
      tools: input.tools,
      maxTokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      signal: input.signal,
    })) {
      if (ev.type === "text") {
        if (!roundStarted) {
          roundStarted = true;
          if (state.visible && !/\s$/.test(state.visible)) emit("\n\n");
        }
        emit(filter.push(ev.text));
      } else {
        done = { content: ev.content, stopReason: ev.stopReason, usage: ev.usage };
      }
    }
    if (!done) throw new AiProviderError("The AI provider ended the response early", undefined, true);

    usage.inputTokens += done.usage.inputTokens;
    usage.outputTokens += done.usage.outputTokens;
    usage.cacheReadTokens += done.usage.cacheReadTokens ?? 0;
    usage.cacheWriteTokens += done.usage.cacheWriteTokens ?? 0;

    const toolUses = done.content.filter((b): b is Extract<AiContentBlock, { type: "tool_use" }> => b.type === "tool_use");
    if (done.stopReason !== "tool_use" || toolUses.length === 0) {
      stopReason = done.stopReason === "max_tokens" ? "max_tokens" : "end_turn";
      break;
    }

    const spent = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
    if (state.rounds >= maxRounds || spent >= budget || Date.now() >= deadline) {
      stopReason = state.rounds >= maxRounds ? "max_rounds" : spent >= budget ? "token_budget" : "deadline";
      emit(`${state.visible ? "\n\n" : ""}${STOP_NOTE}`);
      break;
    }

    // Run the tools (in order, a bounded number), then hand the results back as data.
    const results: AiContentBlock[] = [];
    for (const [i, use] of toolUses.entries()) {
      if (i >= maxCalls) {
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify({ error: "Too many tool calls in one step; ask again for what is still missing." }), is_error: true });
        continue;
      }
      input.onToolStart?.(use.name);
      const outcome = await input.runTool(use.name, use.input);
      toolCalls.push({ name: use.name, status: outcome.status });
      if (outcome.card) state.actionCards.push(outcome.card);
      input.onToolEnd?.(use.name, outcome.status);
      results.push({ type: "tool_result", tool_use_id: use.id, content: outcome.content, ...(outcome.status === "ok" ? {} : { is_error: true }) });
    }
    messages.push({ role: "assistant", content: done.content });
    messages.push({ role: "user", content: results });
  }

  const { tail, cardsRaw } = filter.finish();
  emit(tail);
  return { text: state.visible.trim(), cardsRaw, usage, toolCalls, actionCards: state.actionCards, rounds: state.rounds, stopReason };
}
