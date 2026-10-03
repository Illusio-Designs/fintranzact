import { describe, it, expect } from "vitest";
import { planGstinFill, type GstinDetails, type GstinFormValues } from "../gstin-fill.js";

const d = (over: Partial<GstinDetails> = {}): GstinDetails => ({
  gstin: "29AFSPB9500E1ZY", legalName: "SHREE PACKAGING BHANDARI", tradeName: "SHREE PACKAGING", billingAddress: "12 MG Road",
  city: "Bengaluru", state: "Karnataka", stateCode: "29", pincode: "560001", constitution: "partnership",
  gstRegistrationType: "regular", gstinStatus: "active", ...over,
});
const empty: GstinFormValues = { name: "", legalName: "", tradeName: "", billingAddress: "", city: "", state: "", stateCode: "", pincode: "", gstType: "", constitution: "" };

describe("planGstinFill", () => {
  it("fills everything into an empty form, state and code together", () => {
    const p = planGstinFill(d(), empty);
    expect(p.conflicts).toEqual([]);
    expect(p.fills).toEqual({
      name: "SHREE PACKAGING", legalName: "SHREE PACKAGING BHANDARI", tradeName: "SHREE PACKAGING", billingAddress: "12 MG Road",
      city: "Bengaluru", state: "Karnataka", stateCode: "29", pincode: "560001", gstType: "regular", constitution: "partnership",
    });
  });

  it("treats whitespace as empty, ignores equal values (case and spacing) and skips missing incoming fields", () => {
    const p = planGstinFill(d({ pincode: null, billingAddress: null }), { ...empty, legalName: "  ", city: " bengaluru ", name: "x" });
    expect(p.fills.legalName).toBe("SHREE PACKAGING BHANDARI");
    expect(p.fills.city).toBeUndefined();
    expect(p.conflicts).toEqual([]);
    expect("pincode" in p.fills).toBe(false);
    expect("billingAddress" in p.fills).toBe(false);
  });

  it("returns a conflict, not a fill, where the user already typed something different", () => {
    const p = planGstinFill(d(), { ...empty, name: "Mine", legalName: "My Legal", city: "Mysuru", pincode: "570001" });
    expect(p.fills.legalName).toBeUndefined();
    expect(p.fills.city).toBeUndefined();
    expect(p.fills.pincode).toBeUndefined();
    expect(p.conflicts.map((c) => c.key)).toEqual(["legalName", "city", "pincode"]);
    expect(p.conflicts[0]).toMatchObject({ label: "Legal name", current: "My Legal", incoming: "SHREE PACKAGING BHANDARI", patch: { legalName: "SHREE PACKAGING BHANDARI" } });
    // The party name is never a conflict.
    expect(p.fills.name).toBeUndefined();
    expect(p.conflicts.some((c) => c.key === "name")).toBe(false);
  });

  it("compares states by code, and conflicts carry both state fields", () => {
    expect(planGstinFill(d(), { ...empty, state: "Karnataka", stateCode: "29" }).conflicts).toEqual([]);
    const p = planGstinFill(d(), { ...empty, state: "Kerala", stateCode: "32" });
    expect(p.conflicts).toEqual([{ key: "state", label: "State", current: "Kerala", incoming: "Karnataka", patch: { state: "Karnataka", stateCode: "29" } }]);
  });

  it("shows GST type and business type with their labels", () => {
    const p = planGstinFill(d({ gstRegistrationType: "composition", constitution: "llp" }), { ...empty, gstType: "regular", constitution: "partnership" });
    expect(p.conflicts).toEqual([
      expect.objectContaining({ key: "gstType", current: "Registered (regular)", incoming: "Composition scheme" }),
      expect.objectContaining({ key: "constitution", current: "Partnership firm", incoming: "LLP" }),
    ]);
  });

  it("values the form derived itself count as empty", () => {
    const p = planGstinFill(d({ gstRegistrationType: "composition", constitution: "llp" }), { ...empty, gstType: "regular", constitution: "partnership" }, { gstType: "regular", constitution: "partnership" });
    expect(p.conflicts).toEqual([]);
    expect(p.fills).toMatchObject({ gstType: "composition", constitution: "llp" });
  });

  it("works for the IRP lookup, which has no state name", () => {
    const p = planGstinFill(d({ state: undefined }), empty);
    expect(p.fills).toMatchObject({ state: "Karnataka", stateCode: "29" });
  });
});
