import { describe, it, expect } from "vitest";
import {
  validateGstin, gstinCheckChar, stateCodeFromStateName, stateNameFromCode, gstTypeFromTaxpayerType, constitutionFromText,
  partyFieldsFromGstinProfile, shippingEntryFromGstinAddress, GST_STATES, type GstinProfile,
} from "../gstin.js";

describe("validateGstin", () => {
  it("accepts regular GSTINs with a correct check digit", () => {
    for (const g of ["27AACCA8432H2ZP", "24AAACZ0629H1ZI", "27AAPFU0939F1ZV"]) {
      expect(validateGstin(g)).toMatchObject({ valid: true, format: "regular", checksumOk: true });
    }
    expect(gstinCheckChar("29AFSPB9500E1Z")).toBe("F");
  });

  it("normalises case and spaces", () => {
    expect(validateGstin(" 27aapfu0939f1zv ")).toMatchObject({ gstin: "27AAPFU0939F1ZV", valid: true });
  });

  it("rejects a wrong check digit when strict, reports it when not", () => {
    // The Sandbox docs' headline example carries a wrong check digit.
    expect(validateGstin("29AFSPB9500E1ZY")).toMatchObject({ valid: false, reason: "checksum", checksumOk: false });
    expect(validateGstin("36AEOFS9999J1ZI")).toMatchObject({ valid: false, reason: "checksum" });
    expect(validateGstin("29AFSPB9500E1ZY", { strictChecksum: false })).toMatchObject({ valid: true, checksumOk: false });
  });

  it("rejects garbage", () => {
    for (const g of ["", "   ", "ABC", "29AFSPB9500E1Z", "29AFSPB9500E1ZYY", "29AFSPB9500E1XY", "!!AFSPB9500E1ZY", "123456789012345"]) {
      expect(validateGstin(g).valid, g).toBe(false);
    }
    expect(validateGstin("").reason).toBe("empty");
    expect(validateGstin("ABC").reason).toBe("format");
  });

  it("allows non-resident patterns (no check digit)", () => {
    expect(validateGstin("9917SGP29002OSR")).toMatchObject({ valid: true, format: "oidar", checksumOk: null });
    expect(validateGstin("3418FIN00001UNY")).toMatchObject({ valid: true, format: "uin", checksumOk: null });
  });
});

describe("state helpers", () => {
  it("maps portal state names to GST codes, including spelling variants", () => {
    expect(stateCodeFromStateName("Karnataka")).toBe("29");
    expect(stateCodeFromStateName("  karnataka ")).toBe("29");
    expect(stateCodeFromStateName("Jammu and Kashmir")).toBe("01");
    expect(stateCodeFromStateName("Andaman and Nicobar Islands")).toBe("35");
    expect(stateCodeFromStateName("Dadra and Nagar Haveli and Daman and Diu")).toBe("26");
    expect(stateCodeFromStateName("Orissa")).toBe("21");
    expect(stateCodeFromStateName("Andhra Pradesh")).toBe("28");
    expect(stateCodeFromStateName("Atlantis")).toBeNull();
    expect(stateCodeFromStateName("")).toBeNull();
    expect(stateCodeFromStateName(null)).toBeNull();
  });

  it("every listed state name round-trips, except the duplicate Andhra Pradesh code", () => {
    for (const s of GST_STATES) {
      if (s.code === "37") continue;
      expect(stateCodeFromStateName(s.name), s.name).toBe(s.code);
    }
    expect(stateNameFromCode("29")).toBe("Karnataka");
    expect(stateNameFromCode("99")).toBeNull();
  });
});

describe("type mapping", () => {
  it("maps taxpayer types to GST treatments", () => {
    expect(gstTypeFromTaxpayerType("Regular")).toBe("regular");
    expect(gstTypeFromTaxpayerType("Composition")).toBe("composition");
    expect(gstTypeFromTaxpayerType("SEZ Developer")).toBe("sez");
    expect(gstTypeFromTaxpayerType("SEZ Unit")).toBe("sez");
    expect(gstTypeFromTaxpayerType("Input Service Distributor (ISD)")).toBe("regular");
    expect(gstTypeFromTaxpayerType("Non-Resident Online Services Provider")).toBe("overseas");
    expect(gstTypeFromTaxpayerType("UIN Holder")).toBe("uin");
    expect(gstTypeFromTaxpayerType("Something New")).toBeNull();
    expect(gstTypeFromTaxpayerType("")).toBeNull();
  });

  it("maps constitution text and treats NA as unknown", () => {
    expect(constitutionFromText("Private Limited Company")).toBe("private_company");
    expect(constitutionFromText("Public Limited Company")).toBe("public_company");
    expect(constitutionFromText("Limited Liability Partnership")).toBe("llp");
    expect(constitutionFromText("Partnership")).toBe("partnership");
    expect(constitutionFromText("Proprietorship")).toBe("proprietorship");
    expect(constitutionFromText("Hindu Undivided Family")).toBe("huf");
    expect(constitutionFromText("Society/Club/Trust/AOP")).toBe("trust");
    expect(constitutionFromText("Government Department")).toBe("government");
    expect(constitutionFromText("NA")).toBeNull();
    expect(constitutionFromText("")).toBeNull();
  });
});

const profile = (over: Partial<GstinProfile> = {}): GstinProfile => ({
  gstin: "29AFSPB9500E1ZY",
  legalName: "SHREE PACKAGING BHANDARI",
  tradeName: "SHREE PACKAGING",
  status: "active",
  statusRaw: "Active",
  taxpayerType: "Regular",
  constitution: "Partnership",
  registeredOn: "2017-07-01",
  cancelledOn: null,
  lastUpdatedOn: null,
  eInvoiceEnabled: true,
  natureOfBusiness: [],
  principalAddress: { line1: "3rd Floor, No 12, Prestige Tower", line2: "MG Road", city: "Bengaluru", district: "Bengaluru Urban", state: "Karnataka", stateCode: "29", pincode: "560001" },
  additionalAddresses: [],
  source: "sandbox",
  inferred: [],
  ...over,
});

describe("partyFieldsFromGstinProfile", () => {
  it("maps an active regular taxpayer onto party fields", () => {
    expect(partyFieldsFromGstinProfile(profile())).toEqual({
      gstin: "29AFSPB9500E1ZY",
      legalName: "SHREE PACKAGING BHANDARI",
      tradeName: "SHREE PACKAGING",
      billingAddress: "3rd Floor, No 12, Prestige Tower, MG Road",
      city: "Bengaluru",
      state: "Karnataka",
      stateCode: "29",
      pincode: "560001",
      pan: "AFSPB9500E",
      constitution: "partnership",
      gstRegistrationType: "regular",
      gstinStatus: "active",
      blocked: false,
      registeredOn: "2017-07-01",
      cancelledOn: null,
    });
  });

  it("maps status, composition and SEZ treatments, and falls back to the PAN for the constitution", () => {
    expect(partyFieldsFromGstinProfile(profile({ status: "cancelled", cancelledOn: "2023-12-31" }))).toMatchObject({ gstinStatus: "cancelled", cancelledOn: "2023-12-31" });
    expect(partyFieldsFromGstinProfile(profile({ status: "suspended" }))).toMatchObject({ gstinStatus: "suspended" });
    expect(partyFieldsFromGstinProfile(profile({ status: "provisional" }))).toMatchObject({ gstinStatus: "active" });
    expect(partyFieldsFromGstinProfile(profile({ status: "other" }))).toMatchObject({ gstinStatus: null });
    expect(partyFieldsFromGstinProfile(profile({ taxpayerType: "Composition" }))).toMatchObject({ gstRegistrationType: "composition" });
    expect(partyFieldsFromGstinProfile(profile({ taxpayerType: "SEZ Developer" }))).toMatchObject({ gstRegistrationType: "sez" });
    // PAN 4th character P -> proprietorship when the portal text is NA.
    expect(partyFieldsFromGstinProfile(profile({ constitution: "" }))).toMatchObject({ constitution: "proprietorship" });
  });

  it("tolerates a sparse record with no address", () => {
    expect(partyFieldsFromGstinProfile(profile({ gstin: "9917SGP29002OSR", principalAddress: null, constitution: "", taxpayerType: "Non-Resident Online Services Provider" })))
      .toMatchObject({ billingAddress: null, city: null, state: null, stateCode: null, pincode: null, pan: null, constitution: null, gstRegistrationType: "overseas" });
  });
});

describe("shippingEntryFromGstinAddress", () => {
  it("builds a shipping address entry with a label and omits empty parts", () => {
    expect(shippingEntryFromGstinAddress({ line1: "7, Annex", line2: "", city: "Chennai", district: "", state: "Tamil Nadu", stateCode: "33", pincode: "600001" }, "Additional place of business 1"))
      .toEqual({ label: "Additional place of business 1", address: "7, Annex", city: "Chennai", state: "Tamil Nadu", stateCode: "33", pincode: "600001" });
    expect(shippingEntryFromGstinAddress({ line1: "", line2: "", city: "Pune", district: "", state: "", stateCode: "", pincode: "" }, "x"))
      .toEqual({ label: "x", address: "Pune", city: "Pune" });
  });
});
