/**
 * The storefront shows the delivery charge with its own small copy of the rule
 * (apps/store/src/pricing.ts, which does not depend on the shared package). The
 * server prices the order with calcStoreDelivery + calcInvoiceTotals. These two
 * must agree to the paisa, so what the shopper sees is what the order is
 * charged at.
 */
import { describe, expect, it } from "vitest";
import { calcInvoiceTotals, calcStoreDelivery } from "@fintranzact/shared";
import { cartTotals } from "../../../../store/src/pricing";
import type { CartItem, StoreItem } from "../../../../store/src/types";

function entry(price: string, qty: number, taxPercent: string, taxInclusive = false): CartItem {
  const item = { id: `i-${price}-${taxPercent}`, name: "x", price, unit: "pc", inStock: true, sortOrder: 0, taxPercent, taxInclusive, itemMode: "simple" } as StoreItem;
  return { item, quantity: qty, effectivePrice: price };
}

function server(cart: CartItem[], fee: string | null, freeAbove: string | null) {
  const lineItems = cart.map((c) => ({
    quantity: String(c.quantity), unitPrice: c.effectivePrice, taxPercent: c.item.taxPercent ?? "0", discountPercent: "0", taxInclusive: !!c.item.taxInclusive,
  }));
  const goods = calcInvoiceTotals({ lineItems, intraState: true });
  const d = calcStoreDelivery({ fee, freeAbove, subtotal: goods.subtotal });
  const totals = calcInvoiceTotals({ lineItems, charges: d.charge === "0.00" ? undefined : [{ amount: d.charge }], intraState: true });
  return { subtotal: Number(totals.subtotal), tax: Number(totals.taxTotal), total: Number(totals.total), charge: Number(d.charge) };
}

describe("storefront delivery pricing matches the server", () => {
  const carts: Array<[string, CartItem[]]> = [
    ["one item at 18%", [entry("100.00", 1, "18")]],
    ["mixed rates", [entry("800.00", 2, "5"), entry("450.00", 1, "12")]],
    ["nil-rated only", [entry("250.00", 3, "0")]],
    ["tax-inclusive", [entry("118.00", 2, "18", true), entry("99.50", 1, "5", true)]],
    ["odd paise", [entry("33.33", 3, "12"), entry("7.77", 7, "18")]],
  ];
  const settings: Array<[string | null, string | null]> = [
    ["0", null], ["49", null], ["49.50", "500"], ["40", "900"], ["40", "900.01"], ["99.99", "100"],
  ];
  for (const [name, cart] of carts) {
    for (const [fee, freeAbove] of settings) {
      it(`${name}, fee ${fee}, free above ${freeAbove}`, () => {
        const s = server(cart, fee, freeAbove);
        const c = cartTotals(cart, { fee, freeAbove });
        expect(c.subtotal).toBeCloseTo(s.subtotal, 2);
        expect(c.delivery.charge).toBeCloseTo(s.charge, 2);
        expect(c.tax).toBeCloseTo(s.tax, 2);
        expect(c.total).toBeCloseTo(s.total, 2);
      });
    }
  }
});
