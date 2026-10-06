import type { CartItem } from "./types";

/**
 * What the customer pays for the cart, GST included — worked out the way the
 * API prices the order (packages/shared calcLineItem): a tax-exclusive price
 * gets its GST added on top; a tax-inclusive one is split back into taxable
 * value and GST.
 *
 * Store orders are billed to the Walk-in Customer (no state), so they are
 * intra-state: CGST and SGST are each taken at half the rate and rounded to
 * the paisa on their own, and the line's GST is the two together.
 *
 * The cart and checkout used to show the bare price sum as the total, so a
 * customer saw ₹800 on "Place Order" for an item at ₹800 + 5% GST and was
 * then charged ₹840.
 *
 * Delivery: the store's flat fee, free once the subtotal reaches its
 * threshold (the same rule as packages/shared calcStoreDelivery). The charge
 * is taxed like any invoice charge: at the highest rate in the cart
 * (chargeTaxRateFor), CGST and SGST rounded the same way. The server works
 * out the real figure from its own settings; this only shows it.
 */

export interface DeliveryConfig {
  /** Flat fee in rupees (before GST), a money string; empty or 0 = no delivery charge. */
  fee?: string | null;
  /** Subtotal at or above which delivery is free; empty or 0 = no threshold. */
  freeAbove?: string | null;
}

/** The store's delivery settings as the catalog sends them. */
export function deliveryConfigOf(business: { deliveryFee?: string; freeDeliveryAbove?: string | null }): DeliveryConfig {
  return { fee: business.deliveryFee, freeAbove: business.freeDeliveryAbove };
}

export interface DeliveryQuote {
  /** Delivery charge before GST. */
  charge: number;
  /** none: the store charges nothing; fee: the flat fee applies; threshold: waived by the threshold. */
  reason: "none" | "fee" | "threshold";
  /** While the fee applies and a threshold is set: how many more rupees make delivery free. */
  amountToFree: number | null;
}

const paise = (v: string | null | undefined): number => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

export function deliveryFor(subtotal: number, cfg?: DeliveryConfig): DeliveryQuote {
  const fee = paise(cfg?.fee);
  if (fee === 0) return { charge: 0, reason: "none", amountToFree: null };
  const threshold = paise(cfg?.freeAbove);
  const sub = Math.round(subtotal * 100);
  if (threshold > 0 && sub >= threshold) return { charge: 0, reason: "threshold", amountToFree: null };
  return { charge: fee / 100, reason: "fee", amountToFree: threshold > 0 ? (threshold - sub) / 100 : null };
}

/** What the delivery row says: the charge, or "Free delivery". */
export function deliveryLabel(q: DeliveryQuote, symbol: string): string {
  return q.charge > 0 ? `${symbol}${q.charge.toFixed(2)}` : "Free delivery";
}

/** "Add ₹X more for free delivery" while a threshold is set and not yet reached; else null. */
export function deliveryHint(q: DeliveryQuote, symbol: string): string | null {
  if (q.amountToFree === null || q.amountToFree <= 0) return null;
  const more = Number.isInteger(q.amountToFree) ? String(q.amountToFree) : q.amountToFree.toFixed(2);
  return `Add ${symbol}${more} more for free delivery`;
}

export interface CartTotals {
  subtotal: number;
  /** All GST, including the GST on the delivery charge. */
  tax: number;
  /** What the customer pays: goods, GST and delivery. */
  total: number;
  /** The goods with their GST, without delivery (what the minimum order amount is judged on). */
  goodsTotal: number;
  delivery: DeliveryQuote;
}

export function cartTotals(cart: CartItem[], deliveryCfg?: DeliveryConfig): CartTotals {
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  let subtotal = 0;
  let tax = 0;
  let maxRate = 0;
  for (const entry of cart) {
    const price = parseFloat(entry.effectivePrice) || 0;
    const rate = parseFloat(entry.item.taxPercent ?? "0") || 0;
    const unitBase = entry.item.taxInclusive ? round2(price / (1 + rate / 100)) : price;
    const lineSubtotal = round2(unitBase * entry.quantity);
    subtotal += lineSubtotal;
    tax += 2 * round2((lineSubtotal * rate) / 200);
    maxRate = Math.max(maxRate, rate);
  }
  subtotal = round2(subtotal);
  tax = round2(tax);
  const goodsTotal = round2(subtotal + tax);
  const delivery = deliveryFor(subtotal, deliveryCfg);
  const deliveryTax = delivery.charge > 0 ? 2 * round2((delivery.charge * maxRate) / 200) : 0;
  return {
    subtotal,
    tax: round2(tax + deliveryTax),
    total: round2(goodsTotal + delivery.charge + deliveryTax),
    goodsTotal,
    delivery,
  };
}
