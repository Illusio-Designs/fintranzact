import { describe, it, expect } from "vitest";
import {
  computeTds,
  defaultTdsSectionRules,
  tdsDepositDueDate,
  tdsFinancialYear,
  tdsRulesMetaFor,
  isIncomeTaxAct2025Year,
  tdsFinancialYearRange,
  tdsQuarter,
  tdsQuarterRange,
  tdsRateForSection,
  tdsReturnDueDate,
  type TdsSectionRule,
} from "../tds.js";
import { formatIstDate } from "../dates.js";

const rule = (code: string): TdsSectionRule => defaultTdsSectionRules("2026-27").find((s) => s.code === code)!;
const base = { hasPan: true, ytdBase: "0", ytdTaxedBase: "0" };

describe("defaultTdsSectionRules", () => {
  it("has a rule for every section with its limits", () => {
    expect(rule("194C")).toMatchObject({ singleThreshold: "30000", aggregateThreshold: "100000", rate: "2", individualRate: "1" });
    expect(rule("194J_PROF")).toMatchObject({ aggregateThreshold: "50000", rate: "10" });
    expect(rule("194H").aggregateThreshold).toBe("20000");
    expect(rule("194I_LB").aggregateThreshold).toBe("600000");
    expect(rule("194Q")).toMatchObject({ aggregateThreshold: "5000000", excessOnly: true, basis: "purchases", rate: "0.1" });
  });
});

describe("year-versioned defaults", () => {
  const rulesFor = (fy: string) => defaultTdsSectionRules(fy);

  it("keeps rates and limits the same across the Act change, for every section", () => {
    const strip = (r: TdsSectionRule[]) => r.map(({ actSection: _a, paymentCode: _p, note: _n, ...rest }) => rest);
    expect(strip(rulesFor("2026-27"))).toEqual(strip(rulesFor("2025-26")));
  });

  it("adds the Income-tax Act 2025 reference and payment code from 2026-27 only", () => {
    expect(rulesFor("2025-26").every((r) => r.actSection === undefined && r.paymentCode === undefined)).toBe(true);
    const next = Object.fromEntries(rulesFor("2026-27").map((r) => [r.code, r]));
    expect(next["194C"]).toMatchObject({ actSection: "393(1) Table 6(i)", paymentCode: "1023/1024" });
    expect(next["194J_PROF"]).toMatchObject({ paymentCode: "1027" });
    expect(next["194J_TECH"]).toMatchObject({ paymentCode: "1026" });
    expect(next["194I_LB"]).toMatchObject({ paymentCode: "1009" });
    expect(next["194Q"]).toMatchObject({ actSection: "393(1) Table 8(ii)", paymentCode: "1031" });
    expect(next["194H"].paymentCode).toBeUndefined(); // not confirmed
    expect(next["194C"].note).toMatch(/393\(1\) Table 6\(i\)/);
    expect(next["194C"].label).toBe(rulesFor("2025-26").find((r) => r.code === "194C")!.label);
  });

  it("knows which years fall under the 2025 Act", () => {
    expect(isIncomeTaxAct2025Year("2025-26")).toBe(false);
    expect(isIncomeTaxAct2025Year("2026-27")).toBe(true);
    expect(isIncomeTaxAct2025Year("")).toBe(false);
    expect(tdsRulesMetaFor("2026-27")).toMatchObject({ lastReviewed: "2026-10-02", verifyWithCA: true });
    expect(tdsRulesMetaFor("2026-27").actNote).toMatch(/393/);
  });

  it("computes 194C identically in both years", () => {
    const run = (fy: string) => computeTds({ ...base, section: rulesFor(fy).find((s) => s.code === "194C")!, amount: "50000" });
    expect(run("2025-26")).toEqual(run("2026-27"));
    expect(run("2026-27")).toMatchObject({ rate: "2", tds: "1000.00" });
  });
});

describe("tdsRateForSection (s.206AA)", () => {
  it("uses the no-PAN rate without a PAN", () => {
    expect(tdsRateForSection(rule("194C"), false)).toBe("20");
    expect(tdsRateForSection(rule("194Q"), false)).toBe("5");
  });
  it("uses the individual rate for proprietors/HUFs where one exists", () => {
    expect(tdsRateForSection(rule("194C"), true, true)).toBe("1");
    expect(tdsRateForSection(rule("194C"), true, false)).toBe("2");
    expect(tdsRateForSection(rule("194H"), true, true)).toBe("2"); // no individual rate
  });
});

describe("computeTds — 194C single and yearly limits", () => {
  it("deducts nothing below both limits", () => {
    const r = computeTds({ ...base, section: rule("194C"), amount: "25000" });
    expect(r).toMatchObject({ applicable: false, reason: "below_threshold", tds: "0.00" });
  });

  it("taxes a single payment over 30,000 on its own", () => {
    const r = computeTds({ ...base, section: rule("194C"), amount: "40000" });
    expect(r).toMatchObject({ applicable: true, reason: "single_payment_over_threshold", base: "40000.00", rate: "2", tds: "800.00" });
  });

  it("applies the individual rate", () => {
    const r = computeTds({ ...base, section: rule("194C"), amount: "40000", isIndividual: true });
    expect(r.tds).toBe("400.00");
  });

  it("catches up earlier untaxed payments when the yearly limit is crossed", () => {
    // Four payments of 25,000 stayed under both limits; the fifth takes the year to 125,000.
    const r = computeTds({ ...base, section: rule("194C"), amount: "25000", ytdBase: "100000", ytdTaxedBase: "0" });
    expect(r).toMatchObject({ applicable: true, reason: "aggregate_threshold_crossed", base: "125000.00", tds: "2500.00" });
  });

  it("does not tax money that was already taxed", () => {
    const r = computeTds({ ...base, section: rule("194C"), amount: "10000", ytdBase: "125000", ytdTaxedBase: "125000" });
    expect(r).toMatchObject({ applicable: true, base: "10000.00", tds: "200.00" });
  });
});

describe("computeTds — yearly-limit-only sections", () => {
  it("194J does not apply under 50,000 a year, then applies to everything", () => {
    expect(computeTds({ ...base, section: rule("194J_PROF"), amount: "30000" }).applicable).toBe(false);
    const r = computeTds({ ...base, section: rule("194J_PROF"), amount: "30000", ytdBase: "30000" });
    expect(r).toMatchObject({ applicable: true, base: "60000.00", tds: "6000.00" });
  });

  it("194I rent: nothing until 6 lakh a year", () => {
    expect(computeTds({ ...base, section: rule("194I_LB"), amount: "50000", ytdBase: "500000" }).applicable).toBe(false);
    const r = computeTds({ ...base, section: rule("194I_LB"), amount: "50000", ytdBase: "560000" });
    expect(r).toMatchObject({ applicable: true, base: "610000.00", tds: "61000.00" });
  });
});

describe("computeTds — 194Q", () => {
  it("deducts nothing under 50 lakh of purchases", () => {
    expect(computeTds({ ...base, section: rule("194Q"), amount: "4000000", ytdBase: "900000" }).applicable).toBe(false);
  });

  it("taxes only the part above 50 lakh", () => {
    const r = computeTds({ ...base, section: rule("194Q"), amount: "2000000", ytdBase: "4000000" });
    // cumulative 60 lakh, so 10 lakh over the limit, at 0.1% = 1,000
    expect(r).toMatchObject({ applicable: true, reason: "above_threshold", base: "1000000.00", rate: "0.1", tds: "1000.00" });
  });

  it("taxes only the new excess on the next purchase", () => {
    const r = computeTds({ ...base, section: rule("194Q"), amount: "500000", ytdBase: "6000000", ytdTaxedBase: "1000000" });
    expect(r).toMatchObject({ base: "500000.00", tds: "500.00" });
  });

  it("uses 5% when the seller has no PAN", () => {
    const r = computeTds({ ...base, hasPan: false, section: rule("194Q"), amount: "1000000", ytdBase: "5000000" });
    expect(r.tds).toBe("50000.00");
  });
});

describe("computeTds — rounding and edge cases", () => {
  it("rounds to the nearest rupee", () => {
    // 194H, 2% of 33,333.33 = 666.67, so 667. ytdBase puts it past the yearly limit.
    const r = computeTds({ ...base, section: rule("194H"), amount: "33333.33" });
    expect(r.tds).toBe("667.00");
  });

  it("returns nothing for a zero amount", () => {
    expect(computeTds({ ...base, section: rule("194H"), amount: "0" }).applicable).toBe(false);
  });

  it("deducts from the first rupee when a section has no limits", () => {
    const open: TdsSectionRule = { ...rule("194H"), singleThreshold: null, aggregateThreshold: null };
    const r = computeTds({ ...base, section: open, amount: "1000" });
    expect(r).toMatchObject({ applicable: true, reason: "no_threshold", tds: "20.00" });
  });
});

describe("TDS periods", () => {
  it("names the April–March year", () => {
    expect(tdsFinancialYear("2026-04-01T00:00:00+05:30")).toBe("2026-27");
    expect(tdsFinancialYear("2027-03-31T23:00:00+05:30")).toBe("2026-27");
    expect(tdsFinancialYear("2027-04-01T00:00:00+05:30")).toBe("2027-28");
  });

  it("splits the year into quarters by Indian date", () => {
    const q = (d: string) => tdsQuarter(`${d}T12:00:00+05:30`);
    expect([q("2026-04-01"), q("2026-06-30"), q("2026-07-01"), q("2026-09-30")]).toEqual([1, 1, 2, 2]);
    expect([q("2026-10-01"), q("2026-12-31"), q("2027-01-01"), q("2027-03-31")]).toEqual([3, 3, 4, 4]);
  });

  it("treats the first minute of 1 April IST as Q1 even though UTC is still March", () => {
    expect(tdsQuarter("2026-03-31T18:31:00Z")).toBe(1);
    expect(tdsFinancialYear("2026-03-31T18:31:00Z")).toBe("2026-27");
  });

  it("gives exact ranges", () => {
    expect(formatIstDate(tdsFinancialYearRange("2026-27").from)).toBe("01-04-2026");
    expect(formatIstDate(tdsFinancialYearRange("2026-27").to)).toBe("31-03-2027");
    expect(formatIstDate(tdsQuarterRange("2026-27", 3).from)).toBe("01-10-2026");
    expect(formatIstDate(tdsQuarterRange("2026-27", 3).to)).toBe("31-12-2026");
    expect(formatIstDate(tdsQuarterRange("2026-27", 4).from)).toBe("01-01-2027");
    expect(formatIstDate(tdsQuarterRange("2026-27", 4).to)).toBe("31-03-2027");
  });
});

describe("TDS due dates", () => {
  const due = (d: string) => formatIstDate(tdsDepositDueDate(`${d}T12:00:00+05:30`));
  it("deposit is due on the 7th of the next month", () => {
    expect(due("2026-10-15")).toBe("07-11-2026");
    expect(due("2026-04-01")).toBe("07-05-2026");
  });
  it("rolls December into January", () => {
    expect(due("2026-12-20")).toBe("07-01-2027");
  });
  it("March deductions are due 30 April", () => {
    expect(due("2027-03-10")).toBe("30-04-2027");
  });
  it("return due dates", () => {
    expect(formatIstDate(tdsReturnDueDate("2026-27", 1))).toBe("31-07-2026");
    expect(formatIstDate(tdsReturnDueDate("2026-27", 2))).toBe("31-10-2026");
    expect(formatIstDate(tdsReturnDueDate("2026-27", 3))).toBe("31-01-2027");
    expect(formatIstDate(tdsReturnDueDate("2026-27", 4))).toBe("31-05-2027");
  });
});
