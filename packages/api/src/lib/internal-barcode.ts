/**
 * internal-barcode.ts — mint in-store barcodes for stock that arrives without one.
 *
 * WHY THESE LOOK LIKE EAN-13:
 * GS1 reserves prefixes 20-29 for codes a retailer assigns itself, and
 * guarantees they will never collide with a manufacturer's real GTIN. Using
 * that range means an internally-labelled item behaves exactly like a branded
 * one at the till: thirteen digits, a valid check digit, and no chance of
 * shadowing a supplier's barcode.
 *
 * Only EAN-13 businesses mint these (Code 128 / QR businesses get SKU or
 * "FT…" codes, see mintBarcode). label-pdf.ts draws them as real EAN-13 bars
 * because the check digit is valid; any code that is not a valid EAN-13 falls
 * back to Code 128, which a scanner decodes to the same value.
 */

/** GS1 in-store / restricted-distribution prefix. */
const INTERNAL_PREFIX = "2";

/** Digits between the prefix and the check digit. */
const BODY_LENGTH = 11;

/**
 * Standard GTIN modulo-10 check digit: weight alternating 3 and 1 from the
 * right, sum, then take the distance to the next multiple of ten.
 */
export function gtinCheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    // Rightmost body digit carries weight 3.
    const weight = (digits.length - i) % 2 === 1 ? 3 : 1;
    sum += Number(digits[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Build the barcode for a given sequence number.
 *
 * Kept pure and separate from allocation so it can be tested directly and so
 * the caller owns the transaction that reserves the number.
 */
export function internalBarcodeFor(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Barcode sequence must be a positive integer, got ${sequence}`);
  }

  const body = String(sequence).padStart(BODY_LENGTH, "0");
  if (body.length > BODY_LENGTH) {
    // ~100 billion codes per business; reaching this is a data problem, not a
    // scale one, and silently truncating would mint duplicates.
    throw new Error("Internal barcode sequence has exceeded 11 digits");
  }

  const withoutCheck = INTERNAL_PREFIX + body;
  return withoutCheck + gtinCheckDigit(withoutCheck);
}

/** True when `value` is one of our generated in-store codes. */
export function isInternalBarcode(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  if (value[0] !== INTERNAL_PREFIX) return false;
  return gtinCheckDigit(value.slice(0, 12)) === Number(value[12]);
}
