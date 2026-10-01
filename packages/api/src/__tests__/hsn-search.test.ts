import { describe, it, expect } from "vitest";

describe("HSN master data search", () => {
  it("finds exact HSN code match", async () => {
    const { searchHsn } = await import("../lib/hsn-data.js");
    const results = searchHsn("0101");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].hsn).toBe("0101");
  });

  it("finds by description keyword", async () => {
    const { searchHsn } = await import("../lib/hsn-data.js");
    const results = searchHsn("rice");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.description.toLowerCase().includes("rice"))).toBe(true);
  });

  it("returns empty array for gibberish", async () => {
    const { searchHsn } = await import("../lib/hsn-data.js");
    expect(searchHsn("xyzzy12345")).toEqual([]);
  });

  it("respects limit parameter", async () => {
    const { searchHsn } = await import("../lib/hsn-data.js");
    const results = searchHsn("01", { limit: 5 });
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it("filters by type (goods vs services)", async () => {
    const { searchHsn } = await import("../lib/hsn-data.js");
    const goods = searchHsn("01", { type: "goods" });
    const services = searchHsn("99", { type: "services" });
    expect(goods.every(r => r.type === "goods")).toBe(true);
    expect(services.every(r => r.type === "services")).toBe(true);
  });

  it("validates HSN code format", async () => {
    const { isValidHsn } = await import("../lib/hsn-data.js");
    expect(isValidHsn("0101")).toBe(true);     // 4-digit, exists in master
    expect(isValidHsn("01")).toBe(false);       // too short
    expect(isValidHsn("ABCD")).toBe(false);     // not numeric
    expect(isValidHsn("0000")).toBe(false);     // not a code or a heading of one
  });

  it("enforces digit requirements based on turnover", async () => {
    const { validateHsnForTurnover } = await import("../lib/hsn-data.js");
    // Up to 5Cr: 4-digit minimum
    expect(validateHsnForTurnover("0101", "40000000")).toEqual({ valid: true });
    // Above 5Cr: 6-digit minimum
    expect(validateHsnForTurnover("0101", "60000000")).toEqual({ valid: false, message: expect.stringContaining("6") });
    expect(validateHsnForTurnover("010121", "60000000")).toEqual({ valid: true });
  });

  it("searches the full CBIC list: 8-digit codes and multi-word descriptions", async () => {
    const { searchHsn } = await import("../lib/hsn-data.js");
    expect(searchHsn("30041010")[0]).toMatchObject({ hsn: "30041010", type: "goods" });
    // A heading comes before its sub-codes.
    expect(searchHsn("3004").map((r) => r.hsn)[0]).toBe("3004");
    expect(searchHsn("3004").some((r) => r.hsn === "30041010")).toBe(true);
    expect(searchHsn("penicillins medicaments").length).toBeGreaterThan(0);
    expect(searchHsn("998713")[0]).toMatchObject({ hsn: "998713", type: "services" });
  });

  it("describes a code, or a heading of listed codes", async () => {
    const { describeHsn } = await import("../lib/hsn-data.js");
    expect(describeHsn("30041010")).toMatchObject({ code: "30041010", type: "goods", match: "code" });
    expect(describeHsn("998713")).toMatchObject({ type: "services", match: "code" });
    expect(describeHsn("0000")).toBeNull();
    expect(describeHsn("52AB")).toBeNull();
  });

  it("explains why an item's code would be refused", async () => {
    const { hsnProblem } = await import("../lib/hsn-data.js");
    expect(hsnProblem("")).toBeNull();
    expect(hsnProblem("5208")).toBeNull();
    expect(hsnProblem("30041010")).toBeNull();
    expect(hsnProblem("52AB")).toMatch(/digits only/);
    expect(hsnProblem("52081")).toMatch(/4, 6 or 8 digits/);
    expect(hsnProblem("00000000")).toMatch(/not in the GST HSN/);
  });
});
