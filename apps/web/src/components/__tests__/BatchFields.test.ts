import { describe, expect, it } from "vitest";
import { batchInPayload, expiryLabel, fefoPreview } from "@/components/inventory/BatchFields";

const batch = (batchNumber: string, quantity: string, expired = false, expiryDate: string | null = "2027-01-31") => ({
  id: batchNumber,
  batchNumber,
  quantity,
  expired,
  expiryDate,
  mfgDate: null,
  mrp: null,
  daysToExpiry: expired ? -3 : 100,
});

describe("fefoPreview", () => {
  it("takes batches in order, skipping expired ones", () => {
    const { pieces, short } = fefoPreview([batch("C3", "4", true), batch("B2", "5"), batch("A1", "12")], 7);
    expect(pieces).toEqual([{ batchNumber: "B2", quantity: 5 }, { batchNumber: "A1", quantity: 2 }]);
    expect(short).toBe(0);
  });

  it("includes expired batches when they may go out, and reports what is short", () => {
    const { pieces, short } = fefoPreview([batch("C3", "4", true), batch("B2", "1")], 8, true);
    expect(pieces.map((p) => p.batchNumber)).toEqual(["C3", "B2"]);
    expect(short).toBe(3);
  });
});

describe("batchInPayload", () => {
  it("sends a saved batch by id, a typed one by number with its dates", () => {
    expect(batchInPayload({ batchId: "b-1", batchNumber: "X" })).toEqual({ batchId: "b-1" });
    expect(batchInPayload({ batchNumber: " B7 ", expiryDate: "2027-05-31", mfgDate: "", batchMrp: "" })).toEqual({
      batchNumber: "B7",
      expiryDate: "2027-05-31",
      mfgDate: undefined,
      batchMrp: undefined,
    });
    expect(batchInPayload({ batchNumber: "  " })).toEqual({});
  });
});

describe("expiryLabel", () => {
  it("says when a batch expires or expired", () => {
    expect(expiryLabel({ expiryDate: null })).toBe("no expiry");
    expect(expiryLabel({ expiryDate: "2027-01-31", expired: false })).toBe("exp 31 Jan 2027");
    expect(expiryLabel({ expiryDate: "2026-01-31", expired: true })).toBe("expired 31 Jan 2026");
  });
});
