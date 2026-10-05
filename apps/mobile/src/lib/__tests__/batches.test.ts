import {
  NEAR_EXPIRY_DAYS,
  baseQuantity,
  expiryStatus,
  expiryWarning,
  fefoPreview,
  fromDateOnly,
  inwardBatchError,
  inwardBatchPayload,
  inwardLinesError,
  lineBatchPayload,
  outwardBatchError,
  outwardBatchPayload,
  outwardLinesError,
  sortBatchesFefo,
  toDateOnly,
  type BatchRow,
} from "../batches";

const row = (over: Partial<BatchRow>): BatchRow => ({
  id: "b",
  batchNumber: "B",
  mfgDate: null,
  expiryDate: null,
  mrp: null,
  quantity: "10.000",
  expired: false,
  daysToExpiry: null,
  ...over,
});

describe("expiry status", () => {
  it("uses the web's 30-day near-expiry threshold", () => {
    expect(NEAR_EXPIRY_DAYS).toBe(30);
    expect(expiryStatus({ daysToExpiry: null })).toBe("none");
    expect(expiryStatus({ daysToExpiry: 31 })).toBe("ok");
    expect(expiryStatus({ daysToExpiry: 30 })).toBe("near");
    expect(expiryStatus({ daysToExpiry: 0 })).toBe("near");
    expect(expiryStatus({ daysToExpiry: -1 })).toBe("expired");
    expect(expiryStatus({ daysToExpiry: 5, expired: true })).toBe("expired");
  });

  it("words the warning", () => {
    expect(expiryWarning({ daysToExpiry: 90 })).toBeNull();
    expect(expiryWarning({ daysToExpiry: null })).toBeNull();
    expect(expiryWarning({ daysToExpiry: 0 })).toBe("Expires today");
    expect(expiryWarning({ daysToExpiry: 12 })).toBe("12d left");
    expect(expiryWarning({ daysToExpiry: -3, expired: true })).toBe("Expired 3d ago");
  });
});

describe("FEFO ordering", () => {
  it("sorts earliest expiry first, undated last, without mutating the input", () => {
    const input = [
      { batchNumber: "C", expiryDate: null },
      { batchNumber: "B", expiryDate: "2027-01-01" },
      { batchNumber: "A", expiryDate: "2026-11-01" },
    ];
    expect(sortBatchesFefo(input).map((b) => b.batchNumber)).toEqual(["A", "B", "C"]);
    expect(input[0].batchNumber).toBe("C");
  });

  it("previews the split, skipping expired stock", () => {
    const batches = [
      row({ id: "x", batchNumber: "OLD", expiryDate: "2026-09-01", expired: true, daysToExpiry: -34, quantity: "50.000" }),
      row({ id: "a", batchNumber: "A", expiryDate: "2026-11-01", daysToExpiry: 27, quantity: "4.000" }),
      row({ id: "b", batchNumber: "B", expiryDate: "2027-02-01", daysToExpiry: 119, quantity: "10.000" }),
    ];
    const p = fefoPreview(batches, 6);
    expect(p.pieces).toEqual([
      { batchNumber: "A", quantity: 4 },
      { batchNumber: "B", quantity: 2 },
    ]);
    expect(p.short).toBe(0);
    expect(fefoPreview(batches, 20).short).toBe(6);
    expect(fefoPreview(batches, 60, true).pieces[0].batchNumber).toBe("OLD");
  });
});

describe("dates", () => {
  it("round-trips local calendar days", () => {
    expect(toDateOnly(new Date(2026, 9, 5))).toBe("2026-10-05");
    expect(toDateOnly(fromDateOnly("2027-03-09")!)).toBe("2027-03-09");
    expect(fromDateOnly("")).toBeNull();
    expect(fromDateOnly("nope")).toBeNull();
  });
});

describe("inward batch", () => {
  it("requires a number, and an expiry when the item tracks it", () => {
    expect(inwardBatchError({}, { trackExpiry: false, itemName: "Paracetamol" })).toMatch(/Enter a batch number for Paracetamol/);
    expect(inwardBatchError({ batchNumber: "  " }, { trackExpiry: false })).toMatch(/batch number/);
    expect(inwardBatchError({ batchNumber: "B1" }, { trackExpiry: false })).toBeNull();
    expect(inwardBatchError({ batchNumber: "B1" }, { trackExpiry: true })).toMatch(/expiry date for batch B1/);
    expect(inwardBatchError({ batchNumber: "B1", expiryDate: "2027-01-01" }, { trackExpiry: true })).toBeNull();
  });

  it("rejects an expiry before the manufacturing date", () => {
    expect(
      inwardBatchError({ batchNumber: "B1", mfgDate: "2026-06-01", expiryDate: "2026-05-01" }, { trackExpiry: true }),
    ).toMatch(/after the manufacturing date/);
  });

  it("checks the MRP shape the API accepts", () => {
    expect(inwardBatchError({ batchNumber: "B1", batchMrp: "12.5" }, { trackExpiry: false })).toBeNull();
    expect(inwardBatchError({ batchNumber: "B1", batchMrp: "12.555" }, { trackExpiry: false })).toMatch(/MRP/);
  });

  it("sends exactly the API's lineBatchFields, trimmed, with blanks omitted", () => {
    expect(inwardBatchPayload(undefined)).toEqual({});
    expect(inwardBatchPayload({ batchNumber: "  " })).toEqual({});
    expect(
      inwardBatchPayload({ batchNumber: " B1 ", mfgDate: "2026-01-01", expiryDate: "2027-01-01", batchMrp: " 9.5 " }),
    ).toEqual({ batchNumber: "B1", mfgDate: "2026-01-01", expiryDate: "2027-01-01", batchMrp: "9.5" });
    expect(inwardBatchPayload({ batchNumber: "B1", mfgDate: "", expiryDate: "" })).toEqual({
      batchNumber: "B1",
      mfgDate: undefined,
      expiryDate: undefined,
      batchMrp: undefined,
    });
  });
});

describe("outward batch", () => {
  const batches = [
    row({ id: "ok", batchNumber: "OK", quantity: "10.000" }),
    row({ id: "old", batchNumber: "OLD", quantity: "10.000", expired: true, daysToExpiry: -2, expiryDate: "2026-10-03" }),
  ];

  it("lets the server allocate when nothing is picked", () => {
    expect(outwardBatchPayload(undefined)).toEqual({});
    expect(outwardBatchPayload({ batchId: "" })).toEqual({});
    expect(outwardBatchError({ batchId: "" }, batches, 999)).toBeNull();
  });

  it("sends the picked batch, with allowExpired only when set", () => {
    expect(outwardBatchPayload({ batchId: "ok" })).toEqual({ batchId: "ok" });
    expect(outwardBatchPayload({ batchId: "old", allowExpired: true })).toEqual({ batchId: "old", allowExpired: true });
  });

  it("refuses more than is available and expired stock without permission", () => {
    expect(outwardBatchError({ batchId: "ok" }, batches, 10)).toBeNull();
    expect(outwardBatchError({ batchId: "ok" }, batches, 11, "Syrup")).toMatch(/Only 10 left in batch OK of Syrup/);
    expect(outwardBatchError({ batchId: "old" }, batches, 1)).toMatch(/has expired/);
    expect(outwardBatchError({ batchId: "old", allowExpired: true }, batches, 1)).toBeNull();
  });
});

describe("line glue", () => {
  it("converts to the base unit", () => {
    expect(baseQuantity({ quantity: "3", conversionFactor: "12" })).toBe(36);
    expect(baseQuantity({ quantity: "3", conversionFactor: "12", variantId: "v" })).toBe(3);
    expect(baseQuantity({ quantity: "", conversionFactor: undefined })).toBe(0);
  });

  it("sends nothing for untracked items or a plan without batches", () => {
    const tracked = { itemName: "X", quantity: "1", trackBatches: true, batchIn: { batchNumber: "B1" }, batchOut: { batchId: "id" } };
    expect(lineBatchPayload({ ...tracked, trackBatches: false }, "in", true)).toEqual({});
    expect(lineBatchPayload(tracked, "in", false)).toEqual({});
    expect(lineBatchPayload(tracked, "out", false)).toEqual({});
    expect(lineBatchPayload(tracked, "in", true)).toMatchObject({ batchNumber: "B1" });
    expect(lineBatchPayload(tracked, "out", true)).toEqual({ batchId: "id" });
  });

  it("checks tracked inward lines only", () => {
    expect(inwardLinesError([{ itemName: "Plain", quantity: "1" }])).toBeNull();
    expect(inwardLinesError([{ itemName: "Tab", quantity: "1", trackBatches: true, trackExpiry: true, batchIn: { batchNumber: "B1" } }])).toMatch(
      /expiry date/,
    );
  });

  it("checks picked outward batches against what they hold", async () => {
    const fetch = jest.fn().mockResolvedValue([row({ id: "b1", batchNumber: "B1", quantity: "2.000" })]);
    const line = { itemId: "i", itemName: "Syrup", quantity: "5", trackBatches: true, batchOut: { batchId: "b1" } };
    await expect(outwardLinesError([line], "2026-10-05", fetch)).resolves.toMatch(/Only 2 left in batch B1/);
    expect(fetch).toHaveBeenCalledWith({ itemId: "i", variantId: null, warehouseId: null, asOf: "2026-10-05" });
    fetch.mockClear();
    await expect(outwardLinesError([{ ...line, batchOut: {} }, { ...line, trackBatches: false }], "2026-10-05", fetch)).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
