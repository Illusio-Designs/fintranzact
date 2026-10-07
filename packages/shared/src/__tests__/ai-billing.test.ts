import { describe, it, expect, afterEach } from "vitest";
import {
  ADDONS,
  ADDON_FEATURES,
  AI_PACK_MAX_PER_ORDER,
  AI_PACK_PRICE_INR,
  AI_PACK_QUESTIONS,
  addonCycleAmount,
  aiPackAmount,
  aiQuotaResetsAt,
  aiTierDirection,
  cycleAmount,
  effectiveAddonPrice,
  isAddonAvailable,
  isAiPackAvailable,
  normaliseAddonPrices,
  NO_ADDON_PRICE_OVERRIDES,
} from "../index.js";

describe("AI add-on prices", () => {
  it("AI Assistant is 399 and AI Plus 999 a month, ex-GST, with 18% GST on top", () => {
    expect(addonCycleAmount("ai_assistant", "monthly")).toEqual({ basePaise: 39_900, gstPaise: 7_182, totalPaise: 47_082 });
    expect(addonCycleAmount("ai_plus", "monthly")).toEqual({ basePaise: 99_900, gstPaise: 17_982, totalPaise: 117_882 });
  });

  it("yearly is ten months (two months free) unless the admin set a yearly price", () => {
    expect(addonCycleAmount("ai_assistant", "yearly").basePaise).toBe(399 * 10 * 100);
    expect(addonCycleAmount("ai_plus", "yearly").basePaise).toBe(999 * 10 * 100);
    const o = normaliseAddonPrices({ ai_plus: { monthlyPriceInr: 1_099, yearlyPriceInr: 10_000 } });
    expect(addonCycleAmount("ai_plus", "yearly", o).basePaise).toBe(1_000_000);
    expect(addonCycleAmount("ai_plus", "monthly", o).basePaise).toBe(109_900);
  });

  it("matches the plan checkout math exactly", () => {
    expect(addonCycleAmount("ai_assistant", "yearly")).toEqual(cycleAmount(399, "yearly"));
  });

  it("an override changes only that add-on; an invalid entry is ignored", () => {
    const o = normaliseAddonPrices({
      ai_assistant: { monthlyPriceInr: 449, yearlyPriceInr: null },
      ai_plus: { monthlyPriceInr: -5, yearlyPriceInr: 1 },
      payroll: "free",
      unknown_addon: { monthlyPriceInr: 1 },
      ai_pack: { priceInr: 249 },
    });
    expect(effectiveAddonPrice("ai_assistant", o).monthlyPriceInr).toBe(449);
    expect(effectiveAddonPrice("ai_plus", o).monthlyPriceInr).toBe(999);
    expect(effectiveAddonPrice("payroll", o).monthlyPriceInr).toBe(ADDONS.find((a) => a.id === "payroll")!.monthlyPriceInr);
    expect(o.aiPackPriceInr).toBe(249);
    expect(normaliseAddonPrices(null)).toEqual(NO_ADDON_PRICE_OVERRIDES);
    expect(normaliseAddonPrices({ ai_pack: { priceInr: 0 } }).aiPackPriceInr).toBeNull();
  });
});

describe("AI pack amounts", () => {
  it("one pack is 199 ex-GST for 100 questions: 234.82 with GST", () => {
    expect(AI_PACK_PRICE_INR).toBe(199);
    expect(AI_PACK_QUESTIONS).toBe(100);
    expect(aiPackAmount(1)).toEqual({ packs: 1, credits: 100, basePaise: 19_900, gstPaise: 3_582, totalPaise: 23_482 });
  });

  it("scales by the number of packs and takes GST on the total", () => {
    expect(aiPackAmount(3)).toEqual({ packs: 3, credits: 300, basePaise: 59_700, gstPaise: 10_746, totalPaise: 70_446 });
    const max = aiPackAmount(AI_PACK_MAX_PER_ORDER);
    expect(max.credits).toBe(5_000);
    expect(max.totalPaise).toBe(max.basePaise + max.gstPaise);
  });

  it("uses the admin's pack price", () => {
    expect(aiPackAmount(2, 250)).toMatchObject({ basePaise: 50_000, gstPaise: 9_000, totalPaise: 59_000, credits: 200 });
  });

  it("refuses 0, a fraction, a negative, and more than the cap", () => {
    for (const bad of [0, -1, 1.5, AI_PACK_MAX_PER_ORDER + 1, Number.NaN]) expect(() => aiPackAmount(bad)).toThrow(RangeError);
    expect(() => aiPackAmount(1, 0)).toThrow(RangeError);
  });
});

describe("tier direction and reset", () => {
  it("Plus over Assistant is an upgrade, the reverse a downgrade", () => {
    expect(aiTierDirection("ai_assistant", "ai_plus")).toBe(1);
    expect(aiTierDirection("ai_plus", "ai_assistant")).toBe(-1);
    expect(aiTierDirection("ai_plus", "ai_plus")).toBe(0);
  });

  it("the allowance resets at midnight IST on the 1st", () => {
    expect(aiQuotaResetsAt(new Date("2026-10-15T10:00:00Z")).toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(aiQuotaResetsAt(new Date("2026-12-15T20:00:00Z")).toISOString()).toBe("2026-12-31T18:30:00.000Z");
    // 31 Oct 20:00 UTC is already 1 Nov in India, so the next reset is 1 Dec.
    expect(aiQuotaResetsAt(new Date("2026-10-31T20:00:00Z")).toISOString()).toBe("2026-11-30T18:30:00.000Z");
  });
});

describe("availability of the AI add-ons and packs", () => {
  const backup = { a: ADDON_FEATURES.ai_assistant.implemented, p: ADDON_FEATURES.ai_plus.implemented };
  afterEach(() => {
    ADDON_FEATURES.ai_assistant.implemented = backup.a;
    ADDON_FEATURES.ai_plus.implemented = backup.p;
  });

  it("ships off: nothing about AI can be bought", () => {
    expect(backup).toEqual({ a: false, p: false });
    expect(isAddonAvailable("ai_assistant")).toBe(false);
    expect(isAddonAvailable("ai_plus")).toBe(false);
    expect(isAiPackAvailable()).toBe(false);
  });

  it("one flag per tier turns the pack on", () => {
    ADDON_FEATURES.ai_plus.implemented = true;
    expect(isAiPackAvailable()).toBe(true);
    ADDON_FEATURES.ai_plus.implemented = false;
    ADDON_FEATURES.ai_assistant.implemented = true;
    expect(isAiPackAvailable()).toBe(true);
  });
});
