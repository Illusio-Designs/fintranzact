/**
 * Keeps the structured "cards" block out of the streamed text.
 *
 * The model ends its final message with
 *   <fintranzact_cards>[ ...JSON... ]</fintranzact_cards>
 * which is our own block, parsed and validated server-side (shared
 * parseAiCards). The person must never see it as text while it streams, so this
 * filter holds back anything that could be the start of the open tag, swallows
 * the block, and hands the raw JSON over at the end.
 */

import { AI_CARDS_CLOSE, AI_CARDS_OPEN, AI_MAX_CARDS_JSON_CHARS, parseAiCards, type AiCard } from "@fintranzact/shared";

export class CardsStreamFilter {
  private pending = "";
  private inBlock = false;
  private raw = "";
  private closed = false;

  /** Feed a streamed chunk; returns the part that is safe to show now. */
  push(chunk: string): string {
    if (this.closed) return "";
    if (this.inBlock) {
      this.absorb(chunk);
      return "";
    }
    const buffer = this.pending + chunk;
    this.pending = "";
    const at = buffer.indexOf(AI_CARDS_OPEN);
    if (at >= 0) {
      this.inBlock = true;
      this.absorb(buffer.slice(at + AI_CARDS_OPEN.length));
      return buffer.slice(0, at);
    }
    // Hold back a trailing piece that could still turn into the open tag.
    const keep = partialSuffixLength(buffer, AI_CARDS_OPEN);
    this.pending = keep ? buffer.slice(buffer.length - keep) : "";
    return keep ? buffer.slice(0, buffer.length - keep) : buffer;
  }

  /** The stream is over: any held-back text (it was not a tag after all) and the raw cards JSON. */
  finish(): { tail: string; cardsRaw: string | null } {
    const tail = this.inBlock ? "" : this.pending;
    this.pending = "";
    return { tail, cardsRaw: this.inBlock ? this.raw : null };
  }

  private absorb(chunk: string): void {
    // Cap what we keep: a runaway block is simply dropped by the size check in parseAiCards.
    if (this.raw.length <= AI_MAX_CARDS_JSON_CHARS + 100) this.raw += chunk;
    const close = this.raw.indexOf(AI_CARDS_CLOSE);
    if (close >= 0) {
      this.raw = this.raw.slice(0, close);
      this.closed = true;
    }
  }
}

function partialSuffixLength(text: string, tag: string): number {
  const max = Math.min(text.length, tag.length - 1);
  for (let len = max; len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}

/** The text and validated cards of a complete answer. */
export function splitAnswer(full: string): { text: string; cards: AiCard[]; dropped: number } {
  const filter = new CardsStreamFilter();
  const shown = filter.push(full);
  const { tail, cardsRaw } = filter.finish();
  const parsed = cardsRaw === null ? { cards: [] as AiCard[], dropped: 0 } : parseAiCards(cardsRaw);
  return { text: (shown + tail).trim(), cards: parsed.cards, dropped: parsed.dropped };
}
