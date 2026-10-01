import { describe, expect, it } from "vitest";
import { buildFieldNameMapping } from "@/lib/import-mapping";

const PARTY_FIELDS = [
  { key: "name", label: "Party Name" },
  { key: "phone", label: "Mobile Number" },
  { key: "openingBalance", label: "Opening Balance" },
  { key: "state", label: "State" },
];

const INVOICE_FIELDS = [
  { key: "partyName", label: "Party Name / Contact Name" },
  { key: "totalAmount", label: "Amount / Total Amount" },
  { key: "amountPaid", label: "Amount Paid" },
];

// Regression (J11 settings journey): Tally / Generic CSV had no preset, so
// every column had to be picked by hand even when it was named after the
// field ("Column names will be auto-detected", the wizard said).
describe("buildFieldNameMapping", () => {
  it("maps columns named after a field's label or key, ignoring case and punctuation", () => {
    expect(buildFieldNameMapping(["party name", "MOBILE_NUMBER", "openingBalance", "Notes"], PARTY_FIELDS)).toEqual({
      name: "party name",
      phone: "MOBILE_NUMBER",
      openingBalance: "openingBalance",
    });
  });

  it("matches either half of a two-name label, and a column only once", () => {
    expect(buildFieldNameMapping(["Contact Name", "Total Amount", "Amount Paid"], INVOICE_FIELDS)).toEqual({
      partyName: "Contact Name",
      totalAmount: "Total Amount",
      amountPaid: "Amount Paid",
    });
    expect(buildFieldNameMapping(["Amount"], INVOICE_FIELDS)).toEqual({ totalAmount: "Amount" });
  });

  it("leaves unknown columns for the user", () => {
    expect(buildFieldNameMapping(["Foo", "Bar"], PARTY_FIELDS)).toEqual({});
  });
});
