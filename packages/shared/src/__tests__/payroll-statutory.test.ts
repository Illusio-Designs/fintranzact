import { describe, it, expect } from "vitest";
import {
  ageOn, applyStatutoryToLine, computeAnnualTax, computeEsi, computeLwf, computePf, computePt, computeStatutoryLine, defaultStatutoryRates, effectiveEps,
  esiContributionPeriod, fyStartYearOfMonth, fyLabel, looksLikeManualStatutory, monthsOfFy, projectSalaryTds, ratesGaps, remainingMonthsAfter, roundPaise,
  roundToRupeeStep, statutoryRatesSchema, suggestEpsEligibility, tdsQuarterOfMonth, validatePtRule, EMPTY_DECLARATION,
  type PtStateRule, type RegimeConfig, type StatutoryContext, type StatutoryEmployee, type StatutoryHistory, type StatutoryRates,
} from "../payroll-statutory.js";
import { buildPostingTotals, computePayrollLine, rupeesToPaise, statutoryPayableGroup, type AssignedComponent } from "../payroll-calc.js";

const R = (n: number) => rupeesToPaise(n);
const rates = defaultStatutoryRates();

// Test fixtures (NOT product defaults): income-tax slabs the product ships empty.
const NEW_FIXTURE: RegimeConfig = {
  slabs: [
    { fromRupees: 0, toRupees: 400000, ratePercent: 0 },
    { fromRupees: 400000, toRupees: 800000, ratePercent: 5 },
    { fromRupees: 800000, toRupees: 1200000, ratePercent: 10 },
    { fromRupees: 1200000, toRupees: 1600000, ratePercent: 15 },
    { fromRupees: 1600000, toRupees: 2000000, ratePercent: 20 },
    { fromRupees: 2000000, toRupees: 2400000, ratePercent: 25 },
    { fromRupees: 2400000, toRupees: null, ratePercent: 30 },
  ],
  standardDeductionRupees: 75000,
  rebateThresholdRupees: 1200000,
  rebateMaxRupees: 60000,
  marginalRelief: true,
};
const OLD_FIXTURE: RegimeConfig = {
  slabs: [
    { fromRupees: 0, toRupees: 250000, ratePercent: 0 },
    { fromRupees: 250000, toRupees: 500000, ratePercent: 5 },
    { fromRupees: 500000, toRupees: 1000000, ratePercent: 20 },
    { fromRupees: 1000000, toRupees: null, ratePercent: 30 },
  ],
  standardDeductionRupees: 50000,
  rebateThresholdRupees: 500000,
  rebateMaxRupees: 12500,
  marginalRelief: false,
};
const tdsFixture = { ...rates.tds, newRegime: NEW_FIXTURE, oldRegime: OLD_FIXTURE };
const withTax = (): StatutoryRates => ({ ...rates, tds: tdsFixture });

describe("defaults (what ships)", () => {
  it("validates against its own schema", () => {
    expect(statutoryRatesSchema.safeParse(rates).success).toBe(true);
  });
  it("seeds only the stated figures", () => {
    expect(rates.pf).toMatchObject({ employeePercent: 12, employerPercent: 12, epsPercent: 8.33, wageCeilingRupees: 15000 });
    expect(rates.esi).toMatchObject({ employeePercent: 0.75, employerPercent: 3.25, wageCeilingRupees: 21000 });
    expect(rates.tds.newRegime.standardDeductionRupees).toBe(75000);
    expect(rates.pt["27"]?.annualMaxRupees).toBe(2500);
  });
  it("leaves state slabs, LWF and income-tax slabs EMPTY on purpose", () => {
    expect(Object.keys(rates.pt)).toEqual(["27"]);
    expect(rates.pt["29"]).toBeUndefined(); // Karnataka
    expect(rates.pt["24"]).toBeUndefined(); // Gujarat
    expect(rates.lwf).toEqual({});
    expect(rates.tds.newRegime.slabs).toEqual([]);
    expect(rates.tds.oldRegime.slabs).toEqual([]);
    expect(rates.tds.newRegime.rebateThresholdRupees).toBe(0);
  });
  it("ratesGaps says what is not configured", () => {
    const gaps = ratesGaps(rates, { ptStates: ["29", "27"], lwfState: "29" });
    expect(gaps.join(" ")).toContain("state 29");
    expect(gaps.join(" ")).not.toContain("state 27");
    expect(gaps.join(" ")).toContain("Labour welfare fund");
    expect(gaps.join(" ")).toContain("New-regime");
    expect(gaps.join(" ")).toContain("Old-regime");
  });
  it("the Maharashtra seed has no overlapping slabs", () => {
    expect(validatePtRule(rates.pt["27"]!)).toEqual([]);
  });
});

describe("rounding", () => {
  it("rounds to the paisa, nearest rupee (half up) and up to the next rupee", () => {
    expect(roundPaise(12350, "paisa")).toBe(12350);
    expect(roundPaise(12349, "nearest_rupee")).toBe(12300);
    expect(roundPaise(12350, "nearest_rupee")).toBe(12400);
    expect(roundPaise(12301, "ceil_rupee")).toBe(12400);
    expect(roundPaise(12300, "ceil_rupee")).toBe(12300);
    expect(roundPaise(0, "ceil_rupee")).toBe(0);
  });
  it("rounds to a multiple of ten rupees", () => {
    expect(roundToRupeeStep(R(1234), 10)).toBe(R(1230));
    expect(roundToRupeeStep(R(1235), 10)).toBe(R(1240));
    expect(roundToRupeeStep(R(1234), 1)).toBe(R(1234));
  });
});

describe("financial year and calendar helpers", () => {
  it("finds the FY of a month", () => {
    expect(fyStartYearOfMonth("2026-04")).toBe(2026);
    expect(fyStartYearOfMonth("2027-03")).toBe(2026);
    expect(fyStartYearOfMonth("2026-03")).toBe(2025);
    expect(fyLabel(2026)).toBe("2026-27");
    expect(monthsOfFy(2026)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
  });
  it("quarters", () => {
    expect([4, 6, 7, 9, 10, 12, 1, 3].map((m) => tdsQuarterOfMonth(`2026-${String(m).padStart(2, "0")}`))).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it("remaining months after a month, with and without an exit", () => {
    expect(remainingMonthsAfter("2026-04", null)).toBe(11);
    expect(remainingMonthsAfter("2027-03", null)).toBe(0);
    expect(remainingMonthsAfter("2027-02", null)).toBe(1);
    expect(remainingMonthsAfter("2026-10", "2026-12-31")).toBe(2);
    expect(remainingMonthsAfter("2026-10", "2026-10-15")).toBe(0);
    expect(remainingMonthsAfter("2026-10", "2026-08-01")).toBe(0);
    expect(remainingMonthsAfter("2026-10", "2028-01-01")).toBe(5);
  });
  it("ESI contribution periods", () => {
    expect(esiContributionPeriod("2026-04").months[0]).toBe("2026-04");
    expect(esiContributionPeriod("2026-09").months[5]).toBe("2026-09");
    expect(esiContributionPeriod("2026-10").months[0]).toBe("2026-10");
    expect(esiContributionPeriod("2027-03").months[5]).toBe("2027-03");
    expect(esiContributionPeriod("2026-09").key).toBe(esiContributionPeriod("2026-04").key);
    expect(esiContributionPeriod("2026-10").key).not.toBe(esiContributionPeriod("2026-09").key);
  });
  it("age in whole years", () => {
    expect(ageOn("1968-10-15", "2026-10-14")).toBe(57);
    expect(ageOn("1968-10-15", "2026-10-15")).toBe(58);
    expect(ageOn(null, "2026-10-15")).toBeNull();
  });
});

describe("EPS eligibility suggestion", () => {
  const base = { dateOfBirth: "1990-01-01", pfJoinDate: "2020-01-01", wagesAtJoiningPaise: R(12000), internationalWorker: false, asOf: "2026-10-01", rates: rates.pf };
  it("eligible in the ordinary case", () => {
    expect(suggestEpsEligibility(base).status).toBe("eligible");
  });
  it("joined on or after 1 Sep 2014 with wages above 15,000: not eligible", () => {
    expect(suggestEpsEligibility({ ...base, pfJoinDate: "2014-09-01", wagesAtJoiningPaise: R(15001) }).status).toBe("not_eligible");
    expect(suggestEpsEligibility({ ...base, pfJoinDate: "2020-01-01", wagesAtJoiningPaise: R(15001) }).status).toBe("not_eligible");
  });
  it("exactly 15,000 at joining is still eligible", () => {
    expect(suggestEpsEligibility({ ...base, pfJoinDate: "2020-01-01", wagesAtJoiningPaise: R(15000) }).status).toBe("eligible");
  });
  it("joined before the cut-off with high wages: eligible", () => {
    expect(suggestEpsEligibility({ ...base, pfJoinDate: "2014-08-31", wagesAtJoiningPaise: R(40000) }).status).toBe("eligible");
  });
  it("unknown wages at joining after the cut-off: review", () => {
    expect(suggestEpsEligibility({ ...base, wagesAtJoiningPaise: null, pfJoinDate: "2019-01-01" }).status).toBe("review");
  });
  it("age 58 or more: not eligible; 57 is", () => {
    expect(suggestEpsEligibility({ ...base, dateOfBirth: "1968-10-01", asOf: "2026-10-01" }).status).toBe("not_eligible");
    expect(suggestEpsEligibility({ ...base, dateOfBirth: "1968-10-02", asOf: "2026-10-01" }).status).toBe("eligible");
  });
  it("an international worker is a special case to review", () => {
    expect(suggestEpsEligibility({ ...base, internationalWorker: true }).status).toBe("review");
  });
  it("no date of birth: review with a reason", () => {
    const s = suggestEpsEligibility({ ...base, dateOfBirth: null });
    expect(s.status).toBe("review");
    expect(s.reasons.join(" ")).toContain("date of birth");
  });
  it("the EPS flag payroll uses stops at the stop age", () => {
    const x = { epsFlag: true, dateOfBirth: "1968-11-01", stopAge: 58 };
    expect(effectiveEps({ ...x, month: "2026-10" })).toBe(true); // 57 on 1 Oct 2026
    expect(effectiveEps({ ...x, month: "2026-11" })).toBe(false); // 58 on 1 Nov 2026
    expect(effectiveEps({ ...x, epsFlag: false, month: "2020-01" })).toBe(false);
    expect(effectiveEps({ epsFlag: true, dateOfBirth: null, month: "2026-10", stopAge: 58 })).toBe(true);
  });
});

describe("PF", () => {
  const pf = (over: Partial<Parameters<typeof computePf>[0]> = {}) =>
    computePf({ wagesPaise: R(20000), applicable: true, excluded: false, onActualWages: false, internationalWorker: false, vpfPercent: 0, epsEligible: true, rates: rates.pf, ...over });

  it("capped wages: 12% + 12% of 15,000, EPS 8.33% (1,249.50 rounds to 1,250), rest to EPF", () => {
    const r = pf();
    expect(r).toMatchObject({ contributionWagesPaise: R(15000), employeePaise: R(1800), employerTotalPaise: R(1800), employerEpsPaise: R(1250), employerEpfPaise: R(550), epsWagesPaise: R(15000), edliWagesPaise: R(15000) });
    expect(r.employerEpsPaise + r.employerEpfPaise).toBe(r.employerTotalPaise);
  });
  it("on actual wages the 12% is on the whole wage but EPS stays capped", () => {
    const r = pf({ onActualWages: true });
    expect(r).toMatchObject({ contributionWagesPaise: R(20000), employeePaise: R(2400), employerTotalPaise: R(2400), employerEpsPaise: R(1250), employerEpfPaise: R(1150), edliWagesPaise: R(15000) });
  });
  it("exactly 15,000 and just over", () => {
    expect(pf({ wagesPaise: R(15000) })).toMatchObject({ employeePaise: R(1800), employerEpsPaise: R(1250) });
    expect(pf({ wagesPaise: R(15000) + 1 })).toMatchObject({ contributionWagesPaise: R(15000) });
  });
  it("wages below the ceiling are contributed in full", () => {
    expect(pf({ wagesPaise: R(10000) })).toMatchObject({ employeePaise: R(1200), employerTotalPaise: R(1200), employerEpsPaise: R(833), employerEpfPaise: R(367) });
  });
  it("without EPS the full employer 12% goes to EPF and EPS wages are zero", () => {
    const r = pf({ epsEligible: false });
    expect(r).toMatchObject({ employerEpsPaise: 0, employerEpfPaise: R(1800), epsWagesPaise: 0, employeePaise: R(1800) });
  });
  it("VPF is a percentage of the actual wages, on top of the 12%", () => {
    expect(pf({ vpfPercent: 5 })).toMatchObject({ employeePaise: R(1800), vpfPaise: R(1000) });
    expect(pf({ vpfPercent: 0 }).vpfPaise).toBe(0);
  });
  it("an excluded employee and one with PF off have no PF at all", () => {
    for (const over of [{ excluded: true }, { applicable: false }]) {
      expect(pf(over)).toMatchObject({ employeePaise: 0, vpfPaise: 0, employerTotalPaise: 0, employerEpfPaise: 0, employerEpsPaise: 0, contributionWagesPaise: 0 });
    }
    expect(pf({ excluded: true }).member).toBe(false);
    expect(pf({ applicable: false }).member).toBe(false);
  });
  it("an international worker has no wage ceiling", () => {
    expect(pf({ internationalWorker: true })).toMatchObject({ contributionWagesPaise: R(20000), employeePaise: R(2400) });
  });
  it("zero wages: a member with zero amounts", () => {
    expect(pf({ wagesPaise: 0 })).toMatchObject({ employeePaise: 0, employerTotalPaise: 0 });
  });
  it("rounding mode is a setting", () => {
    expect(pf({ rates: { ...rates.pf, rounding: "paisa" } }).employerEpsPaise).toBe(124950);
  });
});

describe("ESI", () => {
  const esi = (over: Partial<Parameters<typeof computeEsi>[0]> = {}) =>
    computeEsi({ wagesPaise: R(20000), fullMonthWagesPaise: R(20000), applicable: true, coveredEarlierInPeriod: false, rates: rates.esi, ...over });

  it("0.75% employee and 3.25% employer within the ceiling", () => {
    expect(esi()).toMatchObject({ covered: true, reason: "within_ceiling", employeePaise: R(150), employerPaise: R(650) });
  });
  it("exactly 21,000 is covered (157.50 and 682.50 round up to 158 and 683)", () => {
    expect(esi({ wagesPaise: R(21000), fullMonthWagesPaise: R(21000) })).toMatchObject({ covered: true, employeePaise: R(158), employerPaise: R(683) });
  });
  it("just above 21,000 is not covered", () => {
    expect(esi({ wagesPaise: R(21000) + 1, fullMonthWagesPaise: R(21000) + 1 })).toMatchObject({ covered: false, reason: "above_ceiling", employeePaise: 0, employerPaise: 0 });
  });
  it("contribution-period rule: stays covered above the ceiling if covered earlier in the period", () => {
    expect(esi({ fullMonthWagesPaise: R(25000), wagesPaise: R(25000), coveredEarlierInPeriod: true })).toMatchObject({ covered: true, reason: "kept_for_period", employeePaise: R(188) });
    expect(esi({ fullMonthWagesPaise: R(25000), wagesPaise: R(25000), coveredEarlierInPeriod: false }).covered).toBe(false);
  });
  it("not applicable means nothing, whatever the wages", () => {
    expect(esi({ applicable: false })).toMatchObject({ covered: false, reason: "not_applicable", employeePaise: 0 });
  });
  it("contribution is on the earned wages, the test on the full-month wages", () => {
    expect(esi({ wagesPaise: R(10000), fullMonthWagesPaise: R(20000) })).toMatchObject({ employeePaise: R(75), employerPaise: R(325) });
  });
  it("zero earned wages: covered but nothing", () => {
    expect(esi({ wagesPaise: 0 })).toMatchObject({ covered: true, reason: "no_wages", employeePaise: 0 });
  });
});

describe("professional tax", () => {
  const mh = rates.pt["27"]!;
  const pt = (gross: number, month: string, gender: string | null, paid = 0, rule: PtStateRule | undefined = mh) =>
    computePt({ grossPaise: R(gross), month, gender, rule, paidThisFyPaise: R(paid) });

  it("men: slab edges", () => {
    expect(pt(7500, "2026-10", "male").paise).toBe(0);
    expect(computePt({ grossPaise: R(7500) + 1, month: "2026-10", gender: "male", rule: mh, paidThisFyPaise: 0 }).paise).toBe(R(175));
    expect(pt(10000, "2026-10", "male").paise).toBe(R(175));
    expect(computePt({ grossPaise: R(10000) + 1, month: "2026-10", gender: "male", rule: mh, paidThisFyPaise: 0 }).paise).toBe(R(200));
    expect(pt(60000, "2026-10", "male").paise).toBe(R(200));
  });
  it("women: nothing up to 25,000, then 200", () => {
    expect(pt(25000, "2026-10", "female").paise).toBe(0);
    expect(pt(25001, "2026-10", "female").paise).toBe(R(200));
    expect(pt(9000, "2026-10", "female").paise).toBe(0);
  });
  it("February uses the configured February amount", () => {
    expect(pt(60000, "2027-02", "male").paise).toBe(R(300));
    expect(pt(9000, "2027-02", "male").paise).toBe(R(175)); // that slab has no February amount
    expect(pt(30000, "2027-02", "female").paise).toBe(R(300));
  });
  it("a year of 200s plus a February 300 totals the 2,500 maximum", () => {
    let paid = 0;
    for (const m of monthsOfFy(2026)) paid += pt(60000, m, "male", paid / 100).paise;
    expect(paid).toBe(R(2500));
  });
  it("the yearly cap cuts a deduction that would pass it", () => {
    expect(pt(60000, "2027-02", "male", 2300).paise).toBe(R(200));
    expect(pt(60000, "2027-03", "male", 2500).paise).toBe(0);
  });
  it("no gender: male slabs and a flag", () => {
    expect(pt(60000, "2026-10", null)).toMatchObject({ paise: R(200), status: "gender_missing" });
  });
  it("state with no slabs: 0 and not_configured", () => {
    expect(computePt({ grossPaise: R(60000), month: "2026-10", gender: "male", rule: undefined, paidThisFyPaise: 0 })).toMatchObject({ paise: 0, status: "not_configured" });
    expect(pt(60000, "2026-10", "male", 0, { annualMaxRupees: 2500, slabs: [] })).toMatchObject({ paise: 0, status: "not_configured" });
  });
  it("a flat state rule with 'any' slabs ignores gender", () => {
    const flat: PtStateRule = { annualMaxRupees: 2500, slabs: [{ fromRupees: 15000, toRupees: null, monthlyRupees: 200, februaryRupees: null, gender: "any" }] };
    expect(pt(20000, "2026-10", "female", 0, flat)).toMatchObject({ paise: R(200), status: "ok" });
    expect(pt(15000, "2026-10", "male", 0, flat).paise).toBe(0);
  });
  it("detects overlapping slabs", () => {
    expect(validatePtRule({ annualMaxRupees: 2500, slabs: [{ fromRupees: 0, toRupees: 10000, monthlyRupees: 100, gender: "any" }, { fromRupees: 9000, toRupees: null, monthlyRupees: 200, gender: "any" }] })).not.toEqual([]);
  });
});

describe("labour welfare fund", () => {
  const half = { frequency: "half_yearly" as const, deductionMonths: [6, 12], employeeRupees: 6, employerRupees: 18 };
  it("half-yearly: only in the configured months", () => {
    expect(computeLwf({ month: "2026-06", rule: half })).toMatchObject({ due: true, employeePaise: R(6), employerPaise: R(18) });
    expect(computeLwf({ month: "2026-12", rule: half }).due).toBe(true);
    expect(computeLwf({ month: "2026-07", rule: half })).toMatchObject({ due: false, employeePaise: 0 });
  });
  it("yearly and monthly", () => {
    const yearly = { ...half, frequency: "yearly" as const, deductionMonths: [12] };
    expect(computeLwf({ month: "2026-12", rule: yearly }).due).toBe(true);
    expect(computeLwf({ month: "2026-06", rule: yearly }).due).toBe(false);
    expect(computeLwf({ month: "2026-09", rule: { ...half, frequency: "monthly" } }).due).toBe(true);
  });
  it("no rule: nothing", () => {
    expect(computeLwf({ month: "2026-06", rule: undefined })).toEqual({ due: false, employeePaise: 0, employerPaise: 0 });
  });
});

describe("annual tax: slabs, rebate, relief, cess", () => {
  const tax = (income: number, regime: RegimeConfig, rounding = 10) => computeAnnualTax({ taxableIncomePaise: R(income), regime, cessPercent: 4, roundingRupees: rounding });

  it("new regime: income within the 87A threshold pays nothing", () => {
    expect(tax(925000, NEW_FIXTURE)).toMatchObject({ slabTaxPaise: R(32500), rebatePaise: R(32500), totalPaise: 0 });
    expect(tax(1200000, NEW_FIXTURE).totalPaise).toBe(0);
  });
  it("new regime: marginal relief just above the threshold limits tax to the excess income", () => {
    const t = tax(1225000, NEW_FIXTURE);
    expect(t.slabTaxPaise).toBe(R(63750));
    expect(t.taxAfterRebatePaise).toBe(R(25000));
    expect(t.cessPaise).toBe(R(1000));
    expect(t.totalPaise).toBe(R(26000));
  });
  it("new regime: well above the threshold no relief applies", () => {
    expect(tax(1325000, NEW_FIXTURE).totalPaise).toBe(R(81900));
    expect(tax(1800000, NEW_FIXTURE).totalPaise).toBe(R(166400));
  });
  it("old regime: 5,00,000 gets the 12,500 rebate; just above does not", () => {
    expect(tax(500000, OLD_FIXTURE).totalPaise).toBe(0);
    expect(tax(600000, OLD_FIXTURE).totalPaise).toBe(R(33800)); // 12,500 + 20,000 = 32,500 + 4% cess
  });
  it("rounds income and tax to the nearest ten", () => {
    // taxable 600,004 rounds to 600,000
    expect(computeAnnualTax({ taxableIncomePaise: R(600004), regime: OLD_FIXTURE, cessPercent: 4, roundingRupees: 10 }).totalPaise).toBe(R(33800));
    expect(computeAnnualTax({ taxableIncomePaise: R(600004), regime: OLD_FIXTURE, cessPercent: 4, roundingRupees: 1 }).slabTaxPaise).toBe(R(32500) + 80);
  });
  it("no slabs: no tax", () => {
    expect(tax(5000000, { ...NEW_FIXTURE, slabs: [] }).totalPaise).toBe(0);
  });
  it("zero or negative income", () => {
    expect(tax(0, NEW_FIXTURE).totalPaise).toBe(0);
    expect(computeAnnualTax({ taxableIncomePaise: -100, regime: NEW_FIXTURE, cessPercent: 4, roundingRupees: 10 }).totalPaise).toBe(0);
  });
});

describe("TDS on salary: projection and spreading", () => {
  const base = {
    regime: "new" as const,
    tds: tdsFixture,
    grossToDatePaise: 0,
    grossThisMonthPaise: R(110000),
    projectedMonthlyGrossPaise: R(110000),
    remainingMonths: 11,
    tdsToDatePaise: 0,
    ptToDatePaise: 0,
    ptThisMonthPaise: 0,
    declaration: EMPTY_DECLARATION,
  };

  it("April: projects 12 months, takes the standard deduction, rebate relief and cess, spreads over 12", () => {
    const p = projectSalaryTds(base);
    expect(p.annualGrossPaise).toBe(R(1320000));
    expect(p.taxableIncomePaise).toBe(R(1245000));
    expect(p.tax.totalPaise).toBe(R(46800));
    expect(p.thisMonthPaise).toBe(R(3900));
    expect(p.monthsLeftIncludingThis).toBe(12);
  });
  it("October with the tax already deducted: the same 3,900", () => {
    const p = projectSalaryTds({ ...base, grossToDatePaise: R(110000 * 6), tdsToDatePaise: R(3900 * 6), remainingMonths: 5 });
    expect(p.remainingTaxPaise).toBe(R(23400));
    expect(p.thisMonthPaise).toBe(R(3900));
  });
  it("a mid-year raise spreads the extra tax over the remaining months", () => {
    // six months at 110,000, then 140,000 for the rest (7 months including October)
    const p = projectSalaryTds({ ...base, grossToDatePaise: R(110000 * 6), tdsToDatePaise: R(3900 * 6), grossThisMonthPaise: R(140000), projectedMonthlyGrossPaise: R(140000), remainingMonths: 5 });
    expect(p.annualGrossPaise).toBe(R(660000 + 140000 * 6));
    expect(p.thisMonthPaise).toBeGreaterThan(R(3900));
    // what is left is spread exactly: this month x 6 is within 6 rupees of the remaining tax
    expect(Math.abs(p.thisMonthPaise * 6 - p.remainingTaxPaise)).toBeLessThanOrEqual(R(3));
  });
  it("rounds the monthly amount to the nearest rupee and never beyond what is left", () => {
    const p = projectSalaryTds({ ...base, remainingMonths: 6, grossToDatePaise: R(110000 * 5), tdsToDatePaise: 0 });
    expect(p.thisMonthPaise % 100).toBe(0);
    const last = projectSalaryTds({ ...base, remainingMonths: 0, grossToDatePaise: R(110000 * 11), tdsToDatePaise: R(3900 * 11) });
    expect(last.thisMonthPaise).toBe(R(3900));
    const over = projectSalaryTds({ ...base, remainingMonths: 0, grossToDatePaise: R(110000 * 11), tdsToDatePaise: R(60000) });
    expect(over.thisMonthPaise).toBe(0); // already deducted more than the year's tax
  });
  it("income under the rebate pays no TDS", () => {
    const p = projectSalaryTds({ ...base, grossThisMonthPaise: R(60000), projectedMonthlyGrossPaise: R(60000) });
    expect(p.thisMonthPaise).toBe(0);
  });
  it("the remaining months stop at an exit", () => {
    const p = projectSalaryTds({ ...base, remainingMonths: remainingMonthsAfter("2026-10", "2026-12-31"), grossToDatePaise: R(110000 * 6), tdsToDatePaise: 0 });
    expect(p.annualGrossPaise).toBe(R(110000 * 9));
    expect(p.monthsLeftIncludingThis).toBe(3);
  });
  it("old regime: declarations within their limits, PT and HRA", () => {
    const p = projectSalaryTds({
      ...base,
      regime: "old",
      grossThisMonthPaise: R(100000),
      projectedMonthlyGrossPaise: R(100000),
      ptThisMonthPaise: R(200),
      declaration: { ...EMPTY_DECLARATION, sec80C: 200000, hraExemption: 60000, homeLoanInterest: 250000, sec80D: 25000 },
    });
    // 80C capped at 1,50,000; home-loan interest capped at 2,00,000; 80D has no limit in the defaults (0 = none)
    expect(p.declaredDeductionsPaise).toBe(R(150000 + 25000 + 200000 + 60000));
    expect(p.standardDeductionPaise).toBe(R(50000));
    expect(p.professionalTaxPaise).toBe(R(200 * 12));
    expect(p.taxableIncomePaise).toBe(R(1200000 - 50000 - 435000 - 2400));
  });
  it("new regime ignores declarations and PT", () => {
    const a = projectSalaryTds(base);
    const b = projectSalaryTds({ ...base, ptThisMonthPaise: R(200), declaration: { ...EMPTY_DECLARATION, sec80C: 150000 } });
    expect(b.taxableIncomePaise).toBe(a.taxableIncomePaise);
  });
  it("a previous employer's income and tax count", () => {
    const p = projectSalaryTds({ ...base, declaration: { ...EMPTY_DECLARATION, previousEmployerIncome: 300000, previousEmployerTds: 5000 } });
    expect(p.annualGrossPaise).toBe(R(1320000 + 300000));
    expect(p.remainingTaxPaise).toBe(p.tax.totalPaise - R(5000));
  });
  it("missing slabs: 0 and a warning, never a guess", () => {
    const p = projectSalaryTds({ ...base, tds: rates.tds });
    expect(p.thisMonthPaise).toBe(0);
    expect(p.slabsMissing).toBe(true);
    expect(p.warnings.map((w) => w.code)).toContain("tax_slabs_missing");
  });
  it("a very high projected income warns that surcharge is not computed", () => {
    const p = projectSalaryTds({ ...base, grossThisMonthPaise: R(600000), projectedMonthlyGrossPaise: R(600000) });
    expect(p.warnings.map((w) => w.code)).toContain("tds_surcharge");
  });
});

// ── One employee-month ───────────────────────────────────────────────────────

const comps: AssignedComponent[] = [
  { code: "BASIC", name: "Basic", type: "earning", category: "basic", isWage: true, prorate: true, monthlyPaise: R(20000) },
  { code: "HRA", name: "HRA", type: "earning", category: "hra", isWage: false, prorate: true, monthlyPaise: R(8000) },
  { code: "SPL", name: "Special", type: "earning", category: "special_allowance", isWage: false, prorate: true, monthlyPaise: R(2000) },
];
const payLine = (paidDays = 31) => computePayrollLine({ components: comps, daysInMonth: 31, employedDays: 31, paidDays, lopDays: 31 - paidDays });
const fullMonth = comps.map((c) => ({ type: c.type, category: c.category, isWage: c.isWage, monthlyPaise: c.monthlyPaise }));

const emp: StatutoryEmployee = {
  pfApplicable: true, pfExcluded: false, epsEligible: true, pfOnActualWages: false, internationalWorker: false, vpfPercent: 0, esiApplicable: true,
  dateOfBirth: "1990-05-05", gender: "male", workState: "27", lastWorkingDay: null, hasPan: true, hasUan: true, hasEsicNumber: true, taxRegime: "new", declaration: EMPTY_DECLARATION,
};
const hist: StatutoryHistory = { esiCoveredEarlierInPeriod: false, ptPaidThisFyPaise: 0, grossToDatePaise: 0, tdsToDatePaise: 0, missingMonths: 0 };
const ctxAll = (over: Partial<StatutoryContext["business"]> = {}): StatutoryContext => ({
  month: "2026-10",
  rates: withTax(),
  business: { pfRegistered: true, esiRegistered: true, ptStates: ["27"], lwfState: null, tdsEnabled: true, ...over },
});

describe("computeStatutoryLine", () => {
  const kinds = (r: ReturnType<typeof computeStatutoryLine>) => r.components.map((c) => c.statutoryKind);

  it("full set: PF on Basic only, ESI off (30,000 > 21,000), PT, no TDS under the rebate", () => {
    const r = computeStatutoryLine({ ctx: ctxAll(), employee: emp, line: payLine(), fullMonthEarnings: fullMonth, history: hist });
    expect(kinds(r)).toEqual(["pf_employee", "pf_employer", "eps_employer", "professional_tax"]);
    const get = (k: string) => r.components.find((c) => c.statutoryKind === k)!.amountPaise;
    // PF wages 20,000 capped at 15,000
    expect(get("pf_employee")).toBe(R(1800));
    expect(get("eps_employer")).toBe(R(1250));
    expect(get("pf_employer")).toBe(R(550));
    expect(get("professional_tax")).toBe(R(200));
    expect(r.details.esi).toMatchObject({ covered: false, reason: "above_ceiling" });
    expect(r.components.every((c) => c.source === "statutory")).toBe(true);
  });

  it("PF off: no PF, VPF or EPS anywhere (components, details)", () => {
    const r = computeStatutoryLine({ ctx: ctxAll({ pfRegistered: false }), employee: { ...emp, vpfPercent: 10 }, line: payLine(), fullMonthEarnings: fullMonth, history: hist });
    expect(kinds(r).filter((k) => ["pf_employee", "vpf", "pf_employer", "eps_employer"].includes(k!))).toEqual([]);
    expect(r.details.pf).toBeNull();
    expect(JSON.stringify(r).toLowerCase()).not.toContain("provident");
    expect(JSON.stringify(r)).not.toContain("EPS");
  });

  it("an employee with PF off in a PF business has no PF lines but the business still does for others", () => {
    const r = computeStatutoryLine({ ctx: ctxAll(), employee: { ...emp, pfApplicable: false }, line: payLine(), fullMonthEarnings: fullMonth, history: hist });
    expect(kinds(r)).not.toContain("pf_employee");
    expect(r.details.pf).toMatchObject({ member: false });
  });

  it("an excluded employee has no PF lines", () => {
    const r = computeStatutoryLine({ ctx: ctxAll(), employee: { ...emp, pfExcluded: true }, line: payLine(), fullMonthEarnings: fullMonth, history: hist });
    expect(kinds(r)).not.toContain("pf_employee");
    expect(r.warnings.map((w) => w.code)).not.toContain("pf_excluded_review");
  });

  it("PF is on EARNED wages: a half month of loss of pay halves the wages", () => {
    const r = computeStatutoryLine({ ctx: ctxAll(), employee: { ...emp, pfOnActualWages: true }, line: payLine(15.5), fullMonthEarnings: fullMonth, history: hist });
    expect(r.components.find((c) => c.statutoryKind === "pf_employee")!.amountPaise).toBe(R(1200)); // 10,000 x 12%
  });

  it("ESI: low earner covered, no PT at that gross, and both shares appear", () => {
    const low: AssignedComponent[] = [{ code: "BASIC", name: "Basic", type: "earning", category: "basic", isWage: true, prorate: true, monthlyPaise: R(12000) }];
    const line = computePayrollLine({ components: low, daysInMonth: 31, employedDays: 31, paidDays: 31, lopDays: 0 });
    const r = computeStatutoryLine({ ctx: ctxAll(), employee: emp, line, fullMonthEarnings: [{ type: "earning", category: "basic", isWage: true, monthlyPaise: R(12000) }], history: hist });
    expect(kinds(r)).toContain("esi_employee");
    expect(r.components.find((c) => c.statutoryKind === "esi_employee")!.amountPaise).toBe(R(90));
    expect(r.components.find((c) => c.statutoryKind === "esi_employer")!.amountPaise).toBe(R(390));
    expect(kinds(r)).toContain("professional_tax");
  });

  it("ESI off for the business: none", () => {
    const r = computeStatutoryLine({ ctx: ctxAll({ esiRegistered: false }), employee: emp, line: payLine(), fullMonthEarnings: fullMonth, history: hist });
    expect(r.details.esi).toBeNull();
  });

  it("PT: a state with no slabs gives 0 and a warning; two states without a work state warn", () => {
    const a = computeStatutoryLine({ ctx: ctxAll({ ptStates: ["29"] }), employee: { ...emp, workState: "29" }, line: payLine(), fullMonthEarnings: fullMonth, history: hist });
    expect(kinds(a)).not.toContain("professional_tax");
    expect(a.warnings.map((w) => w.code)).toContain("pt_slabs_missing");
    const b = computeStatutoryLine({ ctx: ctxAll({ ptStates: ["27", "29"] }), employee: { ...emp, workState: null }, line: payLine(), fullMonthEarnings: fullMonth, history: hist });
    expect(b.warnings.map((w) => w.code)).toContain("pt_state_missing");
    const c = computeStatutoryLine({ ctx: ctxAll({ ptStates: ["27"] }), employee: { ...emp, workState: "07" }, line: payLine(), fullMonthEarnings: fullMonth, history: hist });
    expect(kinds(c)).not.toContain("professional_tax"); // works where the business has no PT registration
    expect(c.warnings).toEqual([]);
  });

  it("LWF: warns when the state is not configured; deducts both shares when configured and due", () => {
    const warn = computeStatutoryLine({ ctx: ctxAll({ lwfState: "27" }), employee: emp, line: payLine(), fullMonthEarnings: fullMonth, history: hist });
    expect(warn.warnings.map((w) => w.code)).toContain("lwf_not_configured");
    const ctx = ctxAll({ lwfState: "27" });
    ctx.rates = { ...ctx.rates, lwf: { "27": { frequency: "half_yearly", deductionMonths: [10, 4], employeeRupees: 12, employerRupees: 36 } } };
    const r = computeStatutoryLine({ ctx, employee: emp, line: payLine(), fullMonthEarnings: fullMonth, history: hist });
    expect(r.components.find((c) => c.statutoryKind === "lwf_employee")!.amountPaise).toBe(R(12));
    expect(r.components.find((c) => c.statutoryKind === "lwf_employer")!.amountPaise).toBe(R(36));
  });

  it("TDS off for the business: none and no warning", () => {
    const r = computeStatutoryLine({ ctx: ctxAll({ tdsEnabled: false }), employee: emp, line: payLine(), fullMonthEarnings: fullMonth, history: hist });
    expect(kinds(r)).not.toContain("income_tax_tds");
    expect(r.details.tds).toBeNull();
  });

  it("TDS: a high earner is deducted, capped to what is left after other deductions, with a warning", () => {
    const big: AssignedComponent[] = [{ code: "BASIC", name: "Basic", type: "earning", category: "basic", isWage: true, prorate: true, monthlyPaise: R(300000) }];
    const line = computePayrollLine({ components: big, daysInMonth: 31, employedDays: 31, paidDays: 31, lopDays: 0 });
    const r = computeStatutoryLine({ ctx: ctxAll(), employee: emp, line, fullMonthEarnings: [{ type: "earning", category: "basic", isWage: true, monthlyPaise: R(300000) }], history: hist });
    expect(kinds(r)).toContain("income_tax_tds");
    expect(r.details.tds!.thisMonthPaise).toBeGreaterThan(0);
    // Eleven months already paid but nothing deducted: the whole year's tax falls on one small month and is capped.
    const small = payLine();
    const capped = computeStatutoryLine({ ctx: ctxAll(), employee: { ...emp, hasPan: false }, line: small, fullMonthEarnings: fullMonth, history: { ...hist, grossToDatePaise: R(5000000) } });
    const tds = capped.components.find((c) => c.statutoryKind === "income_tax_tds")!;
    expect(tds.amountPaise).toBeGreaterThan(0);
    expect(tds.amountPaise).toBeLessThanOrEqual(small.grossPaise);
    expect(capped.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["tds_capped", "tds_pan_missing"]));
    expect(applyStatutoryToLine(small, capped.components).netPaise).toBeGreaterThanOrEqual(0);
  });

  it("missing UAN and ESIC numbers warn; missing PAN warns when TDS is due", () => {
    const r = computeStatutoryLine({ ctx: ctxAll(), employee: { ...emp, hasUan: false }, line: payLine(), fullMonthEarnings: fullMonth, history: hist });
    expect(r.warnings.map((w) => w.code)).toContain("pf_uan_missing");
  });

  it("a gap in the year's history warns", () => {
    const r = computeStatutoryLine({ ctx: ctxAll(), employee: emp, line: payLine(), fullMonthEarnings: fullMonth, history: { ...hist, missingMonths: 2 } });
    expect(r.warnings.map((w) => w.code)).toContain("tds_history_gap");
  });

  it("applyStatutoryToLine: totals, net and balance of the posting", () => {
    const base = payLine();
    const r = computeStatutoryLine({ ctx: ctxAll(), employee: emp, line: base, fullMonthEarnings: fullMonth, history: hist });
    const full = applyStatutoryToLine(base, r.components);
    expect(full.grossPaise).toBe(base.grossPaise);
    expect(full.deductionsPaise).toBe(R(1800) + R(200));
    expect(full.employerPaise).toBe(R(1800));
    expect(full.netPaise).toBe(base.grossPaise - R(2000));
    const posting = buildPostingTotals([{ netPaise: full.netPaise, components: full.components }]);
    const debit = Object.values(posting.expense).reduce((s, n) => s + n, 0);
    const credit = posting.netPayablePaise + posting.deductionsPayablePaise + posting.employerPayablePaise + Object.values(posting.statutoryPayable).reduce((s, n) => s + n, 0);
    expect(debit).toBe(credit);
    expect(posting.statutoryPayable).toEqual({ pf: R(1800) + R(1800), esi: 0, pt: R(200), lwf: 0, tds: 0 });
    expect(posting.deductionsPayablePaise).toBe(0);
    expect(posting.employerPayablePaise).toBe(0);
    expect(applyStatutoryToLine(base, [])).toBe(base);
  });

  it("applyStatutoryToLine re-raises a negative net", () => {
    const base = payLine();
    const r = applyStatutoryToLine(base, [{ code: "X", name: "x", type: "deduction", category: "other_deduction", isWage: false, statutoryKind: "income_tax_tds", fullPaise: 0, amountPaise: base.grossPaise + 1, source: "statutory" }]);
    expect(r.warnings.map((w) => w.code)).toContain("negative_net");
  });
});

describe("posting groups and the double-deduction check", () => {
  it("maps kinds to payable groups", () => {
    expect(statutoryPayableGroup("pf_employee")).toBe("pf");
    expect(statutoryPayableGroup("vpf")).toBe("pf");
    expect(statutoryPayableGroup("eps_employer")).toBe("pf");
    expect(statutoryPayableGroup("esi_employer")).toBe("esi");
    expect(statutoryPayableGroup("professional_tax")).toBe("pt");
    expect(statutoryPayableGroup("lwf_employee")).toBe("lwf");
    expect(statutoryPayableGroup("income_tax_tds")).toBe("tds");
    expect(statutoryPayableGroup("gratuity")).toBeNull();
    expect(statutoryPayableGroup(null)).toBeNull();
  });
  it("flags a Phase 1 manual PF/ESI/TDS/PT deduction by name", () => {
    expect(looksLikeManualStatutory({ name: "PF deduction", code: "X" })).toBe(true);
    expect(looksLikeManualStatutory({ name: "Income tax", code: "X" })).toBe(true);
    expect(looksLikeManualStatutory({ name: "Advance recovery", code: "ADV" })).toBe(false);
    expect(looksLikeManualStatutory({ name: "Provident fund", code: "PF_EE", statutoryKind: "pf_employee" })).toBe(false);
  });
});
