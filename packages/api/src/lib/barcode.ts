/**
 * barcode.ts — Code 128 encoder.
 *
 * WHY THIS FILE EXISTS:
 * Label printing needs bar geometry, not an image. PDFKit draws the bars as
 * filled rectangles, so all we need from an encoder is the run-length
 * pattern. That is a small, fully specified algorithm, so it lives here
 * rather than pulling in an image-producing barcode dependency that would
 * then have to be rasterised back into the PDF.
 *
 * Code 128 subset B covers all printable ASCII (space through DEL-1), which
 * is exactly the range the barcode field validates against. Subset C (pair-
 * packed digits) is deliberately not implemented: it roughly halves the width
 * of long numeric codes, but retail codes printed here are short enough that
 * the added branching is not worth the risk of a mis-encode.
 */

/**
 * The 107 Code 128 symbols, each six digits: alternating bar/space widths in
 * modules. Index is the symbol value; 103-106 are START_B, START_C, and the
 * stop pattern's leading portion.
 */
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

/** Bar/space runs terminating every Code 128 symbol. */
const STOP = "2331112";

const START_B = 104;
/** Subset B maps a character to `charCode - 32`. */
const SUBSET_B_OFFSET = 32;

export interface BarcodeBar {
  /** Distance from the symbol's left edge, in modules. */
  x: number;
  /** Bar width in modules. */
  width: number;
}

export interface EncodedBarcode {
  bars: BarcodeBar[];
  /** Total symbol width in modules, including quiet zones if requested. */
  modules: number;
}

export class BarcodeError extends Error {}

/**
 * Encode `value` as Code 128 subset B and return the black bars.
 *
 * Returns positions in abstract "modules" so the caller picks the physical
 * size: a module is one narrow bar, and label templates scale it to fit.
 */
export function encodeCode128(value: string, quietZoneModules = 10): EncodedBarcode {
  if (!value) throw new BarcodeError("Barcode value is empty");

  const codes: number[] = [START_B];

  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) {
      throw new BarcodeError(
        `Character ${JSON.stringify(char)} cannot be encoded in Code 128 subset B`,
      );
    }
    codes.push(code - SUBSET_B_OFFSET);
  }

  // Checksum: start value plus each symbol weighted by its 1-based position,
  // modulo 103. Defined by the symbology; scanners reject a mismatch.
  let checksum = START_B;
  for (let i = 1; i < codes.length; i++) {
    checksum += codes[i] * i;
  }
  codes.push(checksum % 103);

  const runs = codes.map((c) => PATTERNS[c]).join("") + STOP;

  // Runs alternate bar, space, bar, space… starting with a bar.
  const bars: BarcodeBar[] = [];
  let x = quietZoneModules;
  for (let i = 0; i < runs.length; i++) {
    const width = Number(runs[i]);
    if (i % 2 === 0) bars.push({ x, width });
    x += width;
  }

  return { bars, modules: x + quietZoneModules };
}
