import { describe, it, expect } from "vitest";
import {
  gtinCheckDigit,
  internalBarcodeFor,
  isInternalBarcode,
} from "../lib/internal-barcode.js";

describe("gtinCheckDigit", () => {
  // Published EAN-13 examples, check digit stripped off the end.
  it.each([
    ["400638133393", 1], // 4006381333931
    ["590123412345", 7], // 5901234123457
    ["978020137962", 4], // 9780201379624
  ])("computes the documented check digit for %s", (body, expected) => {
    expect(gtinCheckDigit(body)).toBe(expected);
  });
});

describe("internalBarcodeFor", () => {
  it("returns 13 digits in the GS1 in-store range", () => {
    const code = internalBarcodeFor(1);
    expect(code).toHaveLength(13);
    expect(code.startsWith("2")).toBe(true);
    expect(code).toMatch(/^\d{13}$/);
  });

  it("zero-pads the sequence so every code is the same width", () => {
    expect(internalBarcodeFor(1)).toMatch(/^2\d{12}$/);
    expect(internalBarcodeFor(1).slice(0, 12)).toBe("200000000001");
    expect(internalBarcodeFor(42).slice(0, 12)).toBe("200000000042");
  });

  it("appends a check digit that validates", () => {
    for (const seq of [1, 2, 99, 12345, 99999999999]) {
      const code = internalBarcodeFor(seq);
      expect(gtinCheckDigit(code.slice(0, 12))).toBe(Number(code[12]));
    }
  });

  it("never repeats across a run of sequences", () => {
    const seen = new Set<string>();
    for (let i = 1; i <= 2000; i++) seen.add(internalBarcodeFor(i));
    expect(seen.size).toBe(2000);
  });

  it("rejects non-positive or non-integer sequences", () => {
    expect(() => internalBarcodeFor(0)).toThrow();
    expect(() => internalBarcodeFor(-1)).toThrow();
    expect(() => internalBarcodeFor(1.5)).toThrow();
  });

  it("refuses to truncate once the sequence outgrows 11 digits", () => {
    expect(() => internalBarcodeFor(100_000_000_000)).toThrow(/exceeded/);
  });
});

describe("isInternalBarcode", () => {
  it("recognises codes it generated", () => {
    expect(isInternalBarcode(internalBarcodeFor(7))).toBe(true);
  });

  it("rejects a manufacturer GTIN outside the in-store range", () => {
    expect(isInternalBarcode("4006381333931")).toBe(false);
  });

  it("rejects a bad check digit", () => {
    const code = internalBarcodeFor(7);
    const wrong = code.slice(0, 12) + ((Number(code[12]) + 1) % 10);
    expect(isInternalBarcode(wrong)).toBe(false);
  });

  it("rejects anything that is not 13 digits", () => {
    expect(isInternalBarcode("FT-1024")).toBe(false);
    expect(isInternalBarcode("200000000001")).toBe(false);
    expect(isInternalBarcode("")).toBe(false);
  });
});
