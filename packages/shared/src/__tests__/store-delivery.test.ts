import { describe, expect, it } from "vitest";
import { calcInvoiceTotals } from "../calc.js";
import { calcStoreDelivery, describeStoreDelivery } from "../store-delivery.js";

describe("describeStoreDelivery", () => {
  it("is null for a store that charges nothing", () => {
    expect(describeStoreDelivery("0", "500")).toBeNull();
    expect(describeStoreDelivery(null, null)).toBeNull();
  });
  it("describes the fee and the free threshold", () => {
    expect(describeStoreDelivery("49", null)).toBe("Rs 49 per order, plus GST where applicable");
    expect(describeStoreDelivery("49.50", "500")).toBe("Rs 49.50 per order, plus GST where applicable, free on orders of Rs 500 or more");
  });
});

describe("calcStoreDelivery", () => {
  it("charges nothing when the fee is zero, empty or missing", () => {
    for (const fee of ["0", "0.00", "", null, undefined]) {
      expect(calcStoreDelivery({ fee, freeAbove: "500", subtotal: "100" })).toEqual({ charge: "0.00", reason: "none", amountToFree: null });
    }
  });

  it("charges the flat fee with no threshold", () => {
    expect(calcStoreDelivery({ fee: "49", freeAbove: null, subtotal: "100000" })).toEqual({ charge: "49.00", reason: "fee", amountToFree: null });
    expect(calcStoreDelivery({ fee: "49", freeAbove: "0", subtotal: "1" }).reason).toBe("fee");
  });

  it("is free at exactly the threshold and charged one paisa below it", () => {
    expect(calcStoreDelivery({ fee: "49", freeAbove: "500", subtotal: "500.00" })).toEqual({ charge: "0.00", reason: "threshold", amountToFree: null });
    expect(calcStoreDelivery({ fee: "49", freeAbove: "500", subtotal: "500.01" }).reason).toBe("threshold");
    expect(calcStoreDelivery({ fee: "49", freeAbove: "500", subtotal: "499.99" })).toEqual({ charge: "49.00", reason: "fee", amountToFree: "0.01" });
  });

  it("says how much more makes delivery free", () => {
    expect(calcStoreDelivery({ fee: "40", freeAbove: "1000", subtotal: "250.50" }).amountToFree).toBe("749.50");
  });

  it("rounds to the paisa without float drift", () => {
    expect(calcStoreDelivery({ fee: "49.995", freeAbove: null, subtotal: 0 }).charge).toBe("50.00");
    expect(calcStoreDelivery({ fee: "0.1", freeAbove: "0.3", subtotal: 0.1 + 0.2 }).reason).toBe("threshold");
  });

  it("ignores negative and non-numeric settings", () => {
    expect(calcStoreDelivery({ fee: "-5", freeAbove: null, subtotal: "10" }).charge).toBe("0.00");
    expect(calcStoreDelivery({ fee: "abc", freeAbove: null, subtotal: "10" }).charge).toBe("0.00");
  });

  it("goes through the invoice charge mechanism and takes the principal supply's GST rate", () => {
    const { charge } = calcStoreDelivery({ fee: "50", freeAbove: null, subtotal: "1000" });
    const totals = calcInvoiceTotals({
      lineItems: [
        { quantity: "1", unitPrice: "1000", taxPercent: "18", discountPercent: "0" },
        { quantity: "1", unitPrice: "100", taxPercent: "5", discountPercent: "0" },
      ],
      charges: [{ amount: charge }],
      intraState: true,
    });
    expect(totals.chargesTotal).toBe("50.00");
    expect(totals.chargeTaxRate).toBe("18.00");
    expect(totals.chargeTax).toBe("9.00");
    expect(totals.total).toBe(String((1000 + 180 + 100 + 5 + 50 + 9).toFixed(2)));
  });
});
