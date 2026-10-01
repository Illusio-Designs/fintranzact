import { describe, expect, it } from "vitest";
import { isPayingOut } from "../RecordPaymentPanel";

describe("RecordPaymentPanel isPayingOut", () => {
  const bills = [
    { id: "p1", type: "purchase" },
    { id: "p2", type: "purchase" },
  ];
  const sales = [{ id: "s1", type: "sale" }];

  it("pays out when the payment settles a supplier's bill (the account reads 'Pay from')", () => {
    expect(isPayingOut(bills, new Set(["p2"]))).toBe(true);
  });

  it("takes money in for a customer's invoices", () => {
    expect(isPayingOut(sales, new Set(["s1"]))).toBe(false);
  });

  it("with nothing picked, goes by the party's open bills", () => {
    expect(isPayingOut(bills, new Set())).toBe(true);
    expect(isPayingOut(sales, new Set())).toBe(false);
    expect(isPayingOut([], new Set())).toBe(false);
  });

  it("follows the first picked bill, as the server does", () => {
    const mixed = [...sales, ...bills];
    expect(isPayingOut(mixed, new Set(["p1"]))).toBe(true);
    expect(isPayingOut(mixed, new Set(["s1", "p1"]))).toBe(false);
  });
});
