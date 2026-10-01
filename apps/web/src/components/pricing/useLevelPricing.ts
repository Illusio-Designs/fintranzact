import { useEffect, useRef, useState } from "react";
import { mrpWarning } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";

/** The parts of an entry-form line that pricing reads and writes. */
export interface PricedLine {
  id: string;
  itemId?: string;
  selectedUnit?: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
}

export type Seen = {
  /** item|unit the line last had. */
  sig: string;
  /** The price we (or the item pick) filled in; null = the user owns the price. */
  auto: string | null;
  /** The discount a price level filled in, so it can be taken back. */
  autoDiscount: string | null;
};

type Resolved = { unitPrice: string | null; discountPercent: string | null };

/**
 * Puts resolved level prices on the lines whose price was filled in
 * automatically (`seen[id].auto` still matches): a price the user typed is
 * kept. Pure: returns the new lines and what is now filled in per line.
 */
export function applyResolvedPrices<L extends PricedLine>(
  lines: L[],
  resolved: Map<string, Resolved | undefined>,
  seen: Map<string, Seen>,
): { lines: L[]; seen: Map<string, Seen> } {
  const filled = new Map<string, Seen>();
  const next = lines.map((li) => {
    const r = resolved.get(li.id);
    const s = seen.get(li.id);
    if (!r || !s || r.unitPrice == null || s.auto === null || li.unitPrice !== s.auto) return li;
    let discountPercent = li.discountPercent;
    if (r.discountPercent) discountPercent = String(parseFloat(r.discountPercent));
    else if (s.autoDiscount !== null && li.discountPercent === s.autoDiscount) discountPercent = "0";
    const unitPrice = String(parseFloat(r.unitPrice));
    filled.set(li.id, { ...s, auto: unitPrice, autoDiscount: r.discountPercent ? discountPercent : null });
    return unitPrice === li.unitPrice && discountPercent === li.discountPercent ? li : { ...li, unitPrice, discountPercent };
  });
  return { lines: next, seen: filled };
}

/**
 * Prices sale lines from the party's price level (Tally price levels):
 * re-resolves when a line's item, unit or quantity changes, or the party or
 * date does. A price the user typed is left alone: only prices that were
 * filled in automatically (on picking the item or by an earlier resolve) are
 * replaced. Lines already present when the form opens (editing, prefill)
 * count as typed.
 *
 * Returns the level in use and, per line, an MRP warning when the price is
 * above the item's MRP.
 */
export function useLevelPricing<L extends PricedLine>({
  enabled,
  partyId,
  date,
  lines,
  setLines,
}: {
  enabled: boolean;
  partyId: string;
  date: string;
  lines: L[];
  setLines: (update: (prev: L[]) => L[]) => void;
}) {
  const utils = trpc.useUtils();
  const seen = useRef(new Map<string, Seen>());
  const lastKey = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [mrpByLine, setMrpByLine] = useState<Record<string, string | null>>({});
  const [priceLevelName, setPriceLevelName] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    for (const li of lines) {
      const sig = `${li.itemId ?? ""}|${li.selectedUnit ?? ""}`;
      const prev = seen.current.get(li.id);
      if (!prev) {
        seen.current.set(li.id, { sig, auto: li.itemId ? null : li.unitPrice, autoDiscount: null });
      } else if (prev.sig !== sig) {
        // A new item or unit was picked: the price it brought is ours to replace.
        seen.current.set(li.id, { sig, auto: li.itemId ? li.unitPrice : null, autoDiscount: prev.autoDiscount });
      }
    }

    const priced = lines.filter((li) => li.itemId);
    const key = JSON.stringify([partyId, date, priced.map((li) => [li.id, li.itemId, li.selectedUnit ?? "", li.quantity])]);
    if (key === lastKey.current) return;
    lastKey.current = key;
    clearTimeout(timer.current);
    if (priced.length === 0) return;

    timer.current = setTimeout(async () => {
      let res;
      try {
        res = await utils.pricing.resolve.fetch({
          partyId: partyId || null,
          date: date || null,
          lines: priced.map((li) => ({ itemId: li.itemId!, unit: li.selectedUnit ?? null, quantity: li.quantity || "1" })),
        });
      } catch {
        return; // Pricing is a convenience; the item's own price stays.
      }
      if (lastKey.current !== key) return; // Something changed meanwhile; a newer resolve is due.
      const byLine = new Map(priced.map((li, i) => [li.id, res.lines[i]]));
      setPriceLevelName(res.priceLevel?.name ?? null);
      setMrpByLine(Object.fromEntries(priced.map((li, i) => [li.id, res.lines[i]?.mrp ?? null])));
      // React may run a state updater twice (StrictMode, concurrent
      // rebases), so it works from this snapshot of what was filled in and
      // gives the same answer every time.
      const before = new Map(seen.current);
      setLines((prev) => {
        const { lines: next, seen: filled } = applyResolvedPrices(prev, byLine, before);
        for (const [id, entry] of filled) seen.current.set(id, entry);
        return next;
      });
    }, 250);
  }, [enabled, partyId, date, lines, setLines, utils]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    priceLevelName: enabled ? priceLevelName : null,
    mrpWarningFor: (line: PricedLine) => (enabled ? mrpWarning(line.unitPrice, mrpByLine[line.id]) : null),
  };
}
