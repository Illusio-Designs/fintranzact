import { describe, expect, it } from "vitest";
import { paymentModes } from "@fintranzact/shared";
import { paymentModeLabel } from "../payment-modes";

describe("paymentModeLabel", () => {
  // Regression: card payments (taken at the POS) showed as "credit_card".
  it("has a readable label for every mode the API accepts", () => {
    for (const mode of paymentModes) expect(paymentModeLabel(mode)).not.toMatch(/_/);
    expect(paymentModeLabel("credit_card")).toBe("Credit Card");
    expect(paymentModeLabel("upi")).toBe("UPI");
  });

  it("falls back to a readable form of an unknown mode", () => {
    expect(paymentModeLabel("store_credit")).toBe("Store credit");
    expect(paymentModeLabel(null)).toBe("—");
  });
});
