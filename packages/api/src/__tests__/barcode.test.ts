import { describe, it, expect } from "vitest";
import { encodeCode128, encodeEan13, isValidEan13, BarcodeError, type EncodedBarcode } from "../lib/barcode.js";

/**
 * Code 128 is fully specified, so rather than asserting against our own
 * output these tests rebuild the expected symbol from the spec and compare.
 */

// Symbol patterns, indexed by value — the same table the spec publishes.
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "233111",
];

/** Independent reference encoder, written straight from the symbology. */
function referenceRuns(value: string): string {
  const codes = [104, ...[...value].map((c) => c.charCodeAt(0) - 32)];
  let checksum = 104;
  for (let i = 1; i < codes.length; i++) checksum += codes[i] * i;
  codes.push(checksum % 103);
  return codes.map((c) => PATTERNS[c]).join("") + "2331112";
}

/** Rebuild the full bar/space run string from the encoder's black bars. */
function runsFromBars({ bars, modules }: EncodedBarcode, quietZone: number): string {
  const runs: number[] = [];
  let cursor = quietZone;
  for (const bar of bars) {
    if (bar.x > cursor) runs.push(bar.x - cursor); // the space before it
    runs.push(bar.width);
    cursor = bar.x + bar.width;
  }
  // Trailing space before the closing quiet zone, if any.
  const end = modules - quietZone;
  if (cursor < end) runs.push(end - cursor);
  return runs.join("");
}

describe("encodeCode128", () => {
  it.each(["A", "PJJ123C", "FT-1024/XL", "8901234567894", "a b~c"])(
    "reproduces the reference symbol for %j",
    (value) => {
      const encoded = encodeCode128(value, 10);
      expect(runsFromBars(encoded, 10)).toBe(referenceRuns(value));
    },
  );

  it("computes the spec checksum (PJJ123C → 55)", () => {
    // 104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7 = 879; 879 % 103 = 55.
    const runs = runsFromBars(encodeCode128("PJJ123C", 10), 10);
    const checkPattern = PATTERNS[55];
    // The check symbol is the last one before the 7-run stop pattern.
    expect(runs.slice(-6 - 7, -7)).toBe(checkPattern);
  });

  it("starts with the START_B pattern", () => {
    const { bars } = encodeCode128("A", 0);
    // START_B = "211214" → bar 2 at 0, bar 1 at 3, bar 1 at 6.
    expect(bars.slice(0, 3)).toEqual([
      { x: 0, width: 2 },
      { x: 3, width: 1 },
      { x: 6, width: 1 },
    ]);
  });

  it("ends flush with the stop pattern's 2-module bar", () => {
    const { bars, modules } = encodeCode128("A", 0);
    const last = bars[bars.length - 1];
    expect(last.width).toBe(2);
    expect(last.x + last.width).toBe(modules);
  });

  it("keeps every bar inside the symbol and within legal widths", () => {
    const { bars, modules } = encodeCode128("FT-1024/XL", 10);
    for (const bar of bars) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(modules);
      expect(bar.width).toBeGreaterThanOrEqual(1);
      expect(bar.width).toBeLessThanOrEqual(4);
    }
  });

  it("grows by exactly one 11-module symbol per character", () => {
    expect(encodeCode128("12", 0).modules - encodeCode128("1", 0).modules).toBe(11);
  });

  it("applies the quiet zone on both sides", () => {
    expect(encodeCode128("A", 10).modules - encodeCode128("A", 0).modules).toBe(20);
    expect(encodeCode128("A", 10).bars[0].x).toBe(10);
  });

  it("rejects characters outside subset B", () => {
    expect(() => encodeCode128("café")).toThrow(BarcodeError);
    expect(() => encodeCode128("line\nbreak")).toThrow(BarcodeError);
  });

  it("rejects an empty value", () => {
    expect(() => encodeCode128("")).toThrow(BarcodeError);
  });
});

describe("encodeEan13", () => {
  // Reference modules for 4006381333931, from an independent encoder (bwip-js).
  const REFERENCE =
    "10100011010100111010111101111010001001011001101010100001010000101000010111010010000101100110101";

  const modulesOf = (e: EncodedBarcode) => {
    const bits = Array(e.modules).fill("0");
    for (const bar of e.bars) for (let k = 0; k < bar.width; k++) bits[bar.x + k] = "1";
    return bits.join("");
  };

  it("matches the reference encoding, with 11 + 7 module quiet zones", () => {
    const encoded = encodeEan13("4006381333931");
    expect(encoded.modules).toBe(113);
    expect(modulesOf(encoded).slice(11, 106)).toBe(REFERENCE);
  });

  it("checks the check digit", () => {
    expect(isValidEan13("8901234567890")).toBe(true);
    expect(isValidEan13("8901234567891")).toBe(false);
    expect(isValidEan13("890123456789")).toBe(false);
    expect(() => encodeEan13("8901234567891")).toThrow(BarcodeError);
  });
});
