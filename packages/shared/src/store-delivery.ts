/**
 * Delivery charge at online store checkout.
 *
 * The owner sets a flat fee (rupees, before GST) and, optionally, an order
 * subtotal at or above which delivery is free. The charge is worked out from
 * those two settings and the order's subtotal ONLY, on the server, when the
 * order is placed; a shopper's device never sends it.
 *
 * "Subtotal" is the items' value after line discounts and before GST, the
 * figure checkout labels "Subtotal". The charge then goes on the order's
 * invoice as an additional charge (calcInvoiceTotals `charges`), which takes
 * GST the way every invoice charge does (chargeTaxRateFor). Nothing here
 * decides tax.
 */

/** The largest flat delivery fee a store may set (rupees). */
export const STORE_DELIVERY_FEE_MAX = 10_000;
/** The largest free-delivery threshold a store may set (rupees). */
export const STORE_FREE_DELIVERY_ABOVE_MAX = 10_000_000;

export interface StoreDeliveryInput {
  /** Flat fee in rupees as a money string; null/empty/0 = no delivery charge. */
  fee: string | null | undefined;
  /** Subtotal at or above which delivery is free; null/empty/0 = no threshold. */
  freeAbove: string | null | undefined;
  /** Order subtotal in rupees (items after line discounts, before GST). */
  subtotal: string | number;
}

export type StoreDeliveryReason = "none" | "fee" | "threshold";

export interface StoreDeliveryResult {
  /** Charge before GST, a money string ("0.00" when none). */
  charge: string;
  /**
   * none: the store charges nothing for delivery; fee: the flat fee applies;
   * threshold: the order reached the free-delivery threshold, so the fee is waived.
   */
  reason: StoreDeliveryReason;
  /** While the fee applies and a threshold is set: how much more (rupees) makes delivery free; else null. */
  amountToFree: string | null;
}

function toPaise(v: string | number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

function toMoney(paise: number): string {
  return (paise / 100).toFixed(2);
}

/**
 * The delivery charge in a sentence for the policy page and previews, or null
 * when the store charges nothing: "Rs 49 per order, plus GST where applicable, free on orders
 * of Rs 500 or more".
 */
export function describeStoreDelivery(fee: string | null | undefined, freeAbove: string | null | undefined): string | null {
  const f = toPaise(fee);
  if (f === 0) return null;
  const t = toPaise(freeAbove);
  const amount = (p: number) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));
  return `Rs ${amount(f)} per order, plus GST where applicable${t > 0 ? `, free on orders of Rs ${amount(t)} or more` : ""}`;
}

export function calcStoreDelivery(input: StoreDeliveryInput): StoreDeliveryResult {
  const fee = toPaise(input.fee);
  if (fee === 0) return { charge: "0.00", reason: "none", amountToFree: null };
  const threshold = toPaise(input.freeAbove);
  const subtotal = toPaise(input.subtotal);
  if (threshold > 0 && subtotal >= threshold) return { charge: "0.00", reason: "threshold", amountToFree: null };
  return {
    charge: toMoney(fee),
    reason: "fee",
    amountToFree: threshold > 0 ? toMoney(threshold - subtotal) : null,
  };
}
