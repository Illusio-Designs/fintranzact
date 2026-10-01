import { describe, expect, it } from "vitest";
import { applyResolvedPrices, type Seen } from "../useLevelPricing";

const line = (unitPrice: string, discountPercent = "0") => ({ id: "l1", itemId: "shirt", quantity: "5", unitPrice, discountPercent });
const level = (unitPrice: string, discountPercent: string | null = null) =>
  new Map([["l1", { unitPrice, discountPercent }]]);

describe("applyResolvedPrices", () => {
  it("puts the level's price on a line whose price came from the item", () => {
    const seen = new Map<string, Seen>([["l1", { sig: "shirt|", auto: "800.00", autoDiscount: null }]]);
    const { lines, seen: filled } = applyResolvedPrices([line("800.00")], level("650.00"), seen);
    expect(lines[0]).toMatchObject({ unitPrice: "650" });
    expect(filled.get("l1")).toEqual({ sig: "shirt|", auto: "650", autoDiscount: null });
  });

  it("gives the same answer when React runs the state updater twice (StrictMode)", () => {
    // The hook used to mark the price as filled in from inside the updater,
    // so the second run saw "650" as ours, kept ₹800 and returned that.
    const seen = new Map<string, Seen>([["l1", { sig: "shirt|", auto: "800.00", autoDiscount: null }]]);
    const prev = [line("800.00")];
    const first = applyResolvedPrices(prev, level("650.00"), seen);
    for (const [id, entry] of first.seen) seen.set(id, entry);
    const snapshot = new Map([["l1", { sig: "shirt|", auto: "800.00", autoDiscount: null } as Seen]]);
    const again = applyResolvedPrices(prev, level("650.00"), snapshot);
    expect(again.lines).toEqual(first.lines);
    expect(again.lines[0].unitPrice).toBe("650");
  });

  it("keeps a price the user typed, and a level's discount comes and goes with it", () => {
    const typed = new Map<string, Seen>([["l1", { sig: "shirt|", auto: "800.00", autoDiscount: null }]]);
    expect(applyResolvedPrices([line("700.00")], level("650.00"), typed).lines[0].unitPrice).toBe("700.00");

    const seen = new Map<string, Seen>([["l1", { sig: "shirt|", auto: "800.00", autoDiscount: null }]]);
    const withDiscount = applyResolvedPrices([line("800.00")], level("800.00", "10.00"), seen);
    expect(withDiscount.lines[0]).toMatchObject({ unitPrice: "800", discountPercent: "10" });
    const back = applyResolvedPrices(withDiscount.lines, level("800.00"), withDiscount.seen);
    expect(back.lines[0]).toMatchObject({ unitPrice: "800", discountPercent: "0" });
  });
});
