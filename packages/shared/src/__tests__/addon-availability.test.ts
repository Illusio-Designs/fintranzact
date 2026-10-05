import { afterEach, describe, expect, it } from "vitest";
import { ADDON_IDS } from "../billing.js";
import { ADDON_COMING_SOON_MESSAGE, ADDON_FEATURES, availableAddonIds, isAddonAvailable } from "../entitlements.js";

describe("add-on availability", () => {
  const original = Object.fromEntries(ADDON_IDS.map((id) => [id, ADDON_FEATURES[id].implemented]));
  afterEach(() => {
    for (const id of ADDON_IDS) ADDON_FEATURES[id].implemented = original[id] as boolean;
  });

  it("is driven only by ADDON_FEATURES[id].implemented", () => {
    for (const id of ADDON_IDS) expect(isAddonAvailable(id)).toBe(ADDON_FEATURES[id].implemented);
  });

  it("no add-on is on sale until its feature is built", () => {
    expect(availableAddonIds()).toEqual([]);
  });

  it("flipping implemented to true re-enables exactly that add-on", () => {
    ADDON_FEATURES.payroll.implemented = true;
    expect(isAddonAvailable("payroll")).toBe(true);
    expect(isAddonAvailable("store_pro")).toBe(false);
    expect(availableAddonIds()).toEqual(["payroll"]);
  });

  it("an unknown id is never available", () => {
    expect(isAddonAvailable("nope")).toBe(false);
  });

  it("has a friendly refusal message", () => {
    expect(ADDON_COMING_SOON_MESSAGE).toMatch(/coming soon/i);
  });
});
