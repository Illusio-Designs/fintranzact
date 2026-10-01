import { describe, expect, it } from "vitest";
import { paymentsForSplit, splitRemainder, TENDER_MODE } from "../payment-split";

describe("POS split payment", () => {
  it("says what is left to take, in paise", () => {
    expect(splitRemainder({}, 1234.5)).toBe(123450);
    expect(splitRemainder({ cash: "1000", upi: "200.5" }, 1234.5)).toBe(3400);
    expect(splitRemainder({ cash: "1000", upi: "200.5", card: "34" }, 1234.5)).toBe(0);
    expect(splitRemainder({ cash: "2000" }, 1234.5)).toBe(-76550);
    // Floats that do not add up exactly in binary still balance.
    expect(splitRemainder({ cash: "0.1", upi: "0.2" }, 0.3)).toBe(0);
  });

  it("records one payment per tender used, in a fixed order", () => {
    expect(paymentsForSplit({ card: "34", cash: "1000", upi: "200.50" }, "1234.50")).toEqual([
      { tender: "cash", amount: "1000.00" },
      { tender: "upi", amount: "200.50" },
      { tender: "card", amount: "34.00" },
    ]);
    expect(paymentsForSplit({ upi: "", cash: "0" }, "10.00")).toEqual([]);
  });

  it("lets the last tender absorb paise the server's rounding added or removed", () => {
    expect(paymentsForSplit({ cash: "500", card: "734.49" }, "1234.50")).toEqual([
      { tender: "cash", amount: "500.00" },
      { tender: "card", amount: "734.50" },
    ]);
    expect(paymentsForSplit({ cash: "500", upi: "734.51" }, "1234.50")).toEqual([
      { tender: "cash", amount: "500.00" },
      { tender: "upi", amount: "734.50" },
    ]);
  });

  it("records a card as a card payment mode the API accepts", () => {
    expect(TENDER_MODE.card).toBe("credit_card");
  });
});
