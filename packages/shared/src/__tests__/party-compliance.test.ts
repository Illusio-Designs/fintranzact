import { describe, it, expect } from "vitest";
import {
  tdsRateFor,
  constitutionFromPan,
  stateCodeFromGstin,
  panFromGstin,
  partyComplianceWarnings,
  isMsmePaymentRuleCovered,
  IFSC_REGEX,
  UDYAM_REGEX,
} from "../party-compliance.js";

const GSTIN = "27AABCU9603R1ZM";

describe("GSTIN helpers", () => {
  it("reads the PAN and state code out of a GSTIN", () => {
    expect(panFromGstin(GSTIN)).toBe("AABCU9603R");
    expect(stateCodeFromGstin(GSTIN)).toBe("27");
    expect(stateCodeFromGstin("not-a-gstin")).toBeNull();
  });

  it("guesses the business type from the PAN's 4th character", () => {
    expect(constitutionFromPan("AABCU9603R")).toBe("private_company");
    expect(constitutionFromPan("ABCPK1234L")).toBe("proprietorship");
    expect(constitutionFromPan("AAAFK1234L")).toBe("partnership");
    expect(constitutionFromPan("AAAHK1234L")).toBe("huf");
    expect(constitutionFromPan("bad")).toBeNull();
  });
});

describe("tdsRateFor", () => {
  it("uses 0.1% on goods purchases with a PAN and 5% without one", () => {
    expect(tdsRateFor({ tdsSection: "194Q", pan: "AABCU9603R" })).toBe("0.1");
    expect(tdsRateFor({ tdsSection: "194Q", gstin: GSTIN })).toBe("0.1");
    expect(tdsRateFor({ tdsSection: "194Q" })).toBe("5");
  });

  it("uses 1% for individual contractors, 2% for others, 20% without PAN", () => {
    expect(tdsRateFor({ tdsSection: "194C", pan: "ABCPK1234L", constitution: "proprietorship" })).toBe("1");
    expect(tdsRateFor({ tdsSection: "194C", pan: "AABCU9603R", constitution: "private_company" })).toBe("2");
    expect(tdsRateFor({ tdsSection: "194C" })).toBe("20");
  });

  it("returns null when no TDS section is set", () => {
    expect(tdsRateFor({ pan: "AABCU9603R" })).toBeNull();
  });
});

describe("partyComplianceWarnings", () => {
  it("flags cancelled GSTINs, no-ITC suppliers, missing PAN for TDS and MSME without Udyam", () => {
    const warnings = partyComplianceWarnings({
      type: "supplier",
      gstinStatus: "cancelled",
      gstRegistrationType: "composition",
      tdsSection: "194J_PROF",
      isMsme: true,
    });
    expect(warnings).toHaveLength(4);
    expect(warnings.join(" ")).toMatch(/cancelled/);
    expect(warnings.join(" ")).toMatch(/No input tax credit/);
    expect(warnings.join(" ")).toMatch(/20%/);
    expect(warnings.join(" ")).toMatch(/Udyam/);
  });

  it("flags PAN and state that contradict the GSTIN", () => {
    const warnings = partyComplianceWarnings({ gstin: GSTIN, pan: "ABCDE1234F", stateCode: "29" });
    expect(warnings).toHaveLength(2);
  });

  it("has nothing to say about a clean registered supplier", () => {
    expect(partyComplianceWarnings({
      type: "supplier", gstin: GSTIN, pan: "AABCU9603R", stateCode: "27",
      gstRegistrationType: "regular", gstinStatus: "active", tdsSection: "194Q",
    })).toEqual([]);
  });
});

describe("formats and MSME rule", () => {
  it("validates IFSC and Udyam numbers", () => {
    expect(IFSC_REGEX.test("HDFC0001234")).toBe(true);
    expect(IFSC_REGEX.test("HDFC1001234")).toBe(false);
    expect(UDYAM_REGEX.test("UDYAM-MH-26-0012345")).toBe(true);
    expect(UDYAM_REGEX.test("UDYAM-MH-0012345")).toBe(false);
  });

  it("applies the 45-day rule to micro and small suppliers only", () => {
    expect(isMsmePaymentRuleCovered({ isMsme: true, msmeCategory: "micro" })).toBe(true);
    expect(isMsmePaymentRuleCovered({ isMsme: true, msmeCategory: "medium" })).toBe(false);
    expect(isMsmePaymentRuleCovered({ isMsme: false })).toBe(false);
  });
});
