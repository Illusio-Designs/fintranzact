import { describe, it, expect } from "vitest";
import { billingPlaceOfSupply } from "../billing.js";
import { INDIAN_STATES, isStateCode, stateByCode } from "../indian-states.js";

const SELLER = "24"; // Gujarat
const GUJ_GSTIN = "24AAKFS4821M1Z3";
const KA_GSTIN = "29AABCT1332L1ZZ";

describe("billingPlaceOfSupply (which GST a subscription invoice carries)", () => {
  const table: Array<[string, { gstin?: string | null; state?: string | null }, { stateCode: string | null; source: string; intraState: boolean; stateMismatch: boolean }]> = [
    ["GSTIN in the seller's state", { gstin: GUJ_GSTIN }, { stateCode: "24", source: "gstin", intraState: true, stateMismatch: false }],
    ["GSTIN in another state", { gstin: KA_GSTIN }, { stateCode: "29", source: "gstin", intraState: false, stateMismatch: false }],
    ["no GSTIN, billing state Gujarat", { gstin: null, state: "24" }, { stateCode: "24", source: "state", intraState: true, stateMismatch: false }],
    ["no GSTIN, another state", { gstin: null, state: "27" }, { stateCode: "27", source: "state", intraState: false, stateMismatch: false }],
    ["no GSTIN, no state: unknown is IGST", { gstin: null, state: null }, { stateCode: null, source: "none", intraState: false, stateMismatch: false }],
    ["nothing at all", {}, { stateCode: null, source: "none", intraState: false, stateMismatch: false }],
    ["GSTIN and a different state: the GSTIN wins", { gstin: KA_GSTIN, state: "24" }, { stateCode: "29", source: "gstin", intraState: false, stateMismatch: true }],
    ["GSTIN in Gujarat with another state: the GSTIN wins", { gstin: GUJ_GSTIN, state: "27" }, { stateCode: "24", source: "gstin", intraState: true, stateMismatch: true }],
    ["GSTIN and the same state", { gstin: GUJ_GSTIN, state: "24" }, { stateCode: "24", source: "gstin", intraState: true, stateMismatch: false }],
    ["an invalid GSTIN counts as none (falls to the state)", { gstin: "24NOTAGSTIN", state: "27" }, { stateCode: "27", source: "state", intraState: false, stateMismatch: false }],
    ["an invalid GSTIN and no state: IGST", { gstin: "24NOTAGSTIN" }, { stateCode: null, source: "none", intraState: false, stateMismatch: false }],
    ["an unknown state code is ignored", { gstin: null, state: "99" }, { stateCode: null, source: "none", intraState: false, stateMismatch: false }],
    ["a lower-case GSTIN is read", { gstin: GUJ_GSTIN.toLowerCase() }, { stateCode: "24", source: "gstin", intraState: true, stateMismatch: false }],
  ];
  for (const [name, customer, want] of table) {
    it(name, () => expect(billingPlaceOfSupply(customer, SELLER)).toEqual(want));
  }

  it("follows the seller's state (env-driven)", () => {
    expect(billingPlaceOfSupply({ gstin: KA_GSTIN }, "29").intraState).toBe(true);
    expect(billingPlaceOfSupply({ state: "24" }, "29").intraState).toBe(false);
  });
});

describe("the shared state list", () => {
  it("has Gujarat and rejects codes outside the list", () => {
    expect(stateByCode("24")?.name).toBe("Gujarat");
    expect(isStateCode("24")).toBe(true);
    expect(isStateCode("00")).toBe(false);
    expect(isStateCode("Gujarat")).toBe(false);
    expect(isStateCode(24)).toBe(false);
    expect(INDIAN_STATES.every((s) => /^\d{2}$/.test(s.code))).toBe(true);
  });
});
