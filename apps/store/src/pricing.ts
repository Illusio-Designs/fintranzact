import type { CartItem } from "./types";

/**
 * What the customer pays for the cart, GST included — worked out the way the
 * API prices the order (packages/shared calcLineItem): a tax-exclusive price
 * gets its GST added on top; a tax-inclusive one is split back into taxable
 * value and GST.
 *
 * The cart and checkout used to show the bare price sum as the total, so a
 * customer saw ₹800 on "Place Order" for an item at ₹800 + 5% GST and was
 * then charged ₹840.
 */
export function cartTotals(cart: CartItem[]): { subtotal: number; tax: number; total: number } {
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  let subtotal = 0;
  let tax = 0;
  for (const entry of cart) {
    const price = parseFloat(entry.effectivePrice) || 0;
    const rate = parseFloat(entry.item.taxPercent ?? "0") || 0;
    const unitBase = entry.item.taxInclusive ? round2(price / (1 + rate / 100)) : price;
    const lineSubtotal = round2(unitBase * entry.quantity);
    subtotal += lineSubtotal;
    tax += round2((lineSubtotal * rate) / 100);
  }
  subtotal = round2(subtotal);
  tax = round2(tax);
  return { subtotal, tax, total: round2(subtotal + tax) };
}
