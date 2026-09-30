/**
 * Place-of-supply and GSTR-1 section rules.
 */
import { describe, it, expect } from "vitest";
import {
  B2CL_INVOICE_THRESHOLD,
  B2CL_INVOICE_THRESHOLD_BEFORE_AUG_2024,
  b2clThresholdFor,
  gstStateCode,
  gstr1Section,
  isIntraStateSupply,
} from "../gst.js";

const MH = { stateCode: "27", state: "Maharashtra", gstin: "27AABCA0000R1ZM" };

describe("gstStateCode", () => {
  it("prefers the saved state code", () => {
    expect(gstStateCode({ stateCode: "07", gstin: "27AABCA0000R1ZM" })).toBe("07");
  });
  it("falls back to the GSTIN prefix", () => {
    expect(gstStateCode({ stateCode: null, gstin: "29AABCB1111R1ZP" })).toBe("29");
    expect(gstStateCode({ stateCode: "  ", gstin: "29AABCB1111R1ZP" })).toBe("29");
  });
  it("is null with neither, or a GSTIN without a numeric prefix", () => {
    expect(gstStateCode({})).toBeNull();
    expect(gstStateCode({ gstin: "URP" })).toBeNull();
  });
});

describe("isIntraStateSupply — intra (CGST+SGST) vs inter (IGST)", () => {
  it.each([
    ["same state code", { stateCode: "27" }, true],
    ["different state code", { stateCode: "07" }, false],
    ["no code, same-state GSTIN", { gstin: "27AABCP0000R1ZM" }, true],
    ["no code, other-state GSTIN", { gstin: "07AABCP0000R1ZM" }, false],
    ["code beats a conflicting name", { stateCode: "27", state: "Delhi" }, true],
    ["name only, same (case-insensitive)", { state: "  maharashtra " }, true],
    ["name only, different", { state: "Karnataka" }, false],
  ] as const)("%s", (_label, buyer, expected) => {
    expect(isIntraStateSupply(MH, buyer)).toBe(expected);
  });

  it("returns null (caller decides) when the buyer's state is unknown", () => {
    expect(isIntraStateSupply(MH, {})).toBeNull();
    expect(isIntraStateSupply({}, { stateCode: "27" })).toBeNull();
  });

  it("uses the seller's GSTIN prefix when its state code is missing", () => {
    expect(isIntraStateSupply({ gstin: "27AABCA0000R1ZM" }, { stateCode: "27" })).toBe(true);
  });
});

describe("B2CL limit — ₹2.5L before 1 Aug 2024, ₹1L from then (IST)", () => {
  it("switches at 1 Aug 2024 00:00 IST", () => {
    expect(b2clThresholdFor(new Date("2024-07-31T18:29:59.999Z"))).toBe(B2CL_INVOICE_THRESHOLD_BEFORE_AUG_2024);
    expect(b2clThresholdFor(new Date("2024-07-31T18:30:00.000Z"))).toBe(B2CL_INVOICE_THRESHOLD);
    expect(B2CL_INVOICE_THRESHOLD).toBe(100000);
    expect(B2CL_INVOICE_THRESHOLD_BEFORE_AUG_2024).toBe(250000);
  });
});

describe("gstr1Section — B2B / B2CL / B2CS", () => {
  const now = new Date("2026-06-15T06:30:00.000Z");
  const old = new Date("2024-06-15T06:30:00.000Z");
  it.each([
    ["registered, intra", "27AABCP0000R1ZM", true, 500, now, "b2b"],
    ["registered, inter, large", "07AABCP0000R1ZM", false, 900000, now, "b2b"],
    ["unregistered, inter, above ₹1L", null, false, 100000.01, now, "b2cLarge"],
    ["unregistered, inter, exactly ₹1L", null, false, 100000, now, "b2cSmall"],
    ["unregistered, intra, large", null, true, 900000, now, "b2cSmall"],
    ["unregistered, inter, ₹1.5L before Aug 2024", null, false, 150000, old, "b2cSmall"],
    ["unregistered, inter, above ₹2.5L before Aug 2024", null, false, 250000.01, old, "b2cLarge"],
    ["empty GSTIN counts as unregistered", "", false, 150000, now, "b2cLarge"],
  ] as const)("%s → %s", (_l, partyGstin, intraState, invoiceValue, invoiceDate, section) => {
    expect(gstr1Section({ partyGstin, intraState, invoiceValue, invoiceDate })).toBe(section);
  });
});
