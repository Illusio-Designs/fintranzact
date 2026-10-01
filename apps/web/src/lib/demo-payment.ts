/**
 * Field checks for the demo checkout (components/billing/DemoCheckout.tsx).
 * They mirror what a real payment form checks before it lets you pay; no
 * payment details ever leave the browser.
 */

/** Digits only, at most 19 (the longest card numbers). */
export function cardDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 19);
}

/** "4111111111111111" → "4111 1111 1111 1111". */
export function formatCardNumber(value: string): string {
  return cardDigits(value).replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** The Luhn checksum every card number carries. */
export function luhnValid(value: string): boolean {
  const digits = cardDigits(value);
  if (digits.length < 12) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Typing "0428" shows "04/28"; deleting past the slash works naturally. */
export function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

/** MM/YY with a real month, and the card not expired (valid to the month's end). */
export function expiryValid(value: string, now: Date = new Date()): boolean {
  const match = /^(\d{2})\/(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return false;
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  return year > thisYear || (year === thisYear && month >= thisMonth);
}

export function cvvValid(value: string): boolean {
  return /^\d{3}$/.test(value);
}

/** A UPI ID (VPA): "name@bank" — letters, digits, dot, dash or underscore, then the bank handle. */
export function upiIdValid(value: string): boolean {
  return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/.test(value.trim());
}

export const DEMO_TEST_CARD = "4111 1111 1111 1111";

export const NETBANKING_BANKS = [
  { id: "sbi", name: "State Bank of India" },
  { id: "hdfc", name: "HDFC Bank" },
  { id: "icici", name: "ICICI Bank" },
  { id: "axis", name: "Axis Bank" },
  { id: "kotak", name: "Kotak Mahindra Bank" },
] as const;
