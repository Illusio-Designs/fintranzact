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

// ── EAN-13 ────────────────────────────────────────────────────────────────

/** Left-half "L" (odd parity) patterns for digits 0-9, as 7 modules. */
const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
/** Left-half "G" (even parity) patterns. */
const EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
/** Right-half "R" patterns. */
const EAN_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
/** Parity of the six left digits, chosen by the first (implicit) digit. */
const EAN_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(value: string): boolean {
  return /^\d{13}$/.test(value) && ean13CheckDigit(value.slice(0, 12)) === Number(value[12]);
}

/**
 * Encode a 13-digit EAN with a valid check digit. Quiet zones are the
 * standard 11 modules left and 7 right.
 */
export function encodeEan13(value: string): EncodedBarcode {
  if (!isValidEan13(value)) throw new BarcodeError(`${value} is not a valid EAN-13 code`);
  const parity = EAN_PARITY[Number(value[0])];
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? EAN_L : EAN_G)[Number(value[i])];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += EAN_R[Number(value[i])];
  bits += "101";

  const quietLeft = 11;
  const bars: BarcodeBar[] = [];
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === "1") {
      let j = i;
      while (j < bits.length && bits[j] === "1") j++;
      bars.push({ x: quietLeft + i, width: j - i });
      i = j;
    } else i++;
  }
  return { bars, modules: quietLeft + bits.length + 7 };
}
