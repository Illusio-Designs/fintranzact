/** Pure helpers for the Upcoming features board (kept apart so they are easy to test). */

/** "2026-12" → "Dec 2026". */
export function formatTargetMonth(target: string | null): string | null {
  if (!target) return null;
  const [y, m] = target.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return target;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
}

export type DescriptionBlock =
  | { kind: "h"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

/**
 * Splits a description into headings ("### "), paragraphs, bullet lists
 * ("- ") and numbered lists ("1. "). Returns plain text only; nothing is
 * ever rendered as HTML.
 */
export function parseDescription(text: string): DescriptionBlock[] {
  const blocks: DescriptionBlock[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const last = blocks[blocks.length - 1];
    if (!line) {
      blocks.push({ kind: "p", text: "" });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (heading) blocks.push({ kind: "h", text: heading[1]! });
    else if (bullet) {
      if (last?.kind === "ul") last.items.push(bullet[1]!);
      else blocks.push({ kind: "ul", items: [bullet[1]!] });
    } else if (numbered) {
      if (last?.kind === "ol") last.items.push(numbered[1]!);
      else blocks.push({ kind: "ol", items: [numbered[1]!] });
    } else if (last?.kind === "p" && last.text) last.text += ` ${line}`;
    else blocks.push({ kind: "p", text: line });
  }
  return blocks.filter((b) => b.kind !== "p" || b.text);
}

/** "**PF:** 12%" → [{ bold: true, text: "PF:" }, { bold: false, text: " 12%" }] */
export function splitBold(text: string): { bold: boolean; text: string }[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((p) => (p.startsWith("**") && p.endsWith("**") && p.length > 4 ? { bold: true, text: p.slice(2, -2) } : { bold: false, text: p }));
}

/** First paragraph of a description as plain text, for a card. */
export function descriptionSummary(text: string): string {
  const first = parseDescription(text).find((b) => b.kind === "p");
  return first && first.kind === "p" ? first.text.replace(/\*\*/g, "") : "";
}
