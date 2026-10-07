/** A scripted fake of the model provider: plays one round per call, records the requests, never touches the network. */

import type { AiClient, AiContentBlock, AiStreamEvent, AiStreamRequest } from "../../lib/ai/client.js";

export type Round = { text?: string[]; toolUses?: Array<{ id: string; name: string; input: unknown }>; stop?: string; usage?: Partial<Record<"in" | "out", number>>; fail?: Error; delayMs?: number };

/** A fake provider that plays one scripted round per call and records the requests it received. */
export function scripted(rounds: Round[]): AiClient & { requests: AiStreamRequest[] } {
  const requests: AiStreamRequest[] = [];
  return {
    requests,
    stream(req) {
      requests.push(JSON.parse(JSON.stringify({ ...req, signal: undefined })));
      const round = rounds[requests.length - 1] ?? { text: ["(script ended)"] };
      return (async function* (): AsyncGenerator<AiStreamEvent> {
        if (round.fail) throw round.fail;
        if (round.delayMs) await new Promise((r) => setTimeout(r, round.delayMs));
        if (req.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        for (const t of round.text ?? []) yield { type: "text", text: t };
        const content: AiContentBlock[] = [
          ...(round.text?.length ? [{ type: "text" as const, text: round.text.join("") }] : []),
          ...(round.toolUses ?? []).map((u) => ({ type: "tool_use" as const, ...u })),
        ];
        yield { type: "done", content, stopReason: round.stop ?? (round.toolUses?.length ? "tool_use" : "end_turn"), usage: { inputTokens: round.usage?.in ?? 100, outputTokens: round.usage?.out ?? 20, cacheReadTokens: 0, cacheWriteTokens: 0 } };
      })();
    },
  };
}
