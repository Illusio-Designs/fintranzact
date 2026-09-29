/**
 * RecordPaymentPanel — pure helper unit tests
 *
 * These helpers map bank-account types to icons, labels, and payment modes.
 * They are pure functions with no trpc or React dependencies, so we test
 * them in isolation without rendering the component.
 */

import { describe, it, expect, vi } from "vitest";
import { BankIcon, Cash01Icon, CreditCardIcon, Link01Icon, SmartPhone01Icon } from "@hugeicons/core-free-icons";

// Importing RecordPaymentPanel pulls in the trpc client module at eval time.
// Even though we only touch pure helpers, we stub trpc to keep the import safe.
vi.mock("@/lib/trpc", () => ({ trpc: {} }));

import {
  accountTypeIcon,
  accountTypeLabel,
  accountTypeToMode,
} from "../RecordPaymentPanel";

describe("accountTypeIcon", () => {
  it("returns the cash icon for cash", () => {
    expect(accountTypeIcon("cash")).toBe(Cash01Icon);
  });

  it("returns the bank icon for current and savings accounts", () => {
    expect(accountTypeIcon("current")).toBe(BankIcon);
    expect(accountTypeIcon("savings")).toBe(BankIcon);
  });

  it("returns the phone icon for upi", () => {
    expect(accountTypeIcon("upi")).toBe(SmartPhone01Icon);
  });

  it("returns the card icon for credit_card", () => {
    expect(accountTypeIcon("credit_card")).toBe(CreditCardIcon);
  });

  it("returns the link icon for payment_gateway", () => {
    expect(accountTypeIcon("payment_gateway")).toBe(Link01Icon);
  });

  it("falls back to the card icon for unknown account types", () => {
    expect(accountTypeIcon("unknown")).toBe(CreditCardIcon);
    expect(accountTypeIcon("")).toBe(CreditCardIcon);
  });
});

describe("accountTypeLabel", () => {
  it("returns human-readable labels for known account types", () => {
    expect(accountTypeLabel("savings")).toBe("Savings");
    expect(accountTypeLabel("current")).toBe("Current");
    expect(accountTypeLabel("cash")).toBe("Cash");
    expect(accountTypeLabel("upi")).toBe("UPI");
    expect(accountTypeLabel("credit_card")).toBe("Credit Card");
    expect(accountTypeLabel("payment_gateway")).toBe("Gateway");
  });

  it("echoes unknown types verbatim (default branch)", () => {
    expect(accountTypeLabel("weird-type")).toBe("weird-type");
    expect(accountTypeLabel("")).toBe("");
  });
});

describe("accountTypeToMode", () => {
  it("maps cash → cash", () => {
    expect(accountTypeToMode("cash")).toBe("cash");
  });

  it("maps upi → upi", () => {
    expect(accountTypeToMode("upi")).toBe("upi");
  });

  it("maps all other types to bank (savings, current, credit_card, payment_gateway, anything)", () => {
    expect(accountTypeToMode("savings")).toBe("bank");
    expect(accountTypeToMode("current")).toBe("bank");
    expect(accountTypeToMode("credit_card")).toBe("bank");
    expect(accountTypeToMode("payment_gateway")).toBe("bank");
    expect(accountTypeToMode("weird-unseen-type")).toBe("bank");
    expect(accountTypeToMode("")).toBe("bank");
  });
});
