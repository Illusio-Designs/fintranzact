import { describe, it, expect } from "vitest";
import {
  approverAllowed, buildPostingTotals, canTransitionRun, checkWageRule, computePayrollLine, computeSalaryBreakdown, expenseGroupOf,
  isRunEditable, paiseToRupees, percentOf, PAYROLL_RUN_STATUSES, PayrollRuleError, roundDiv, rupeesToPaise, sumRunTotals,
  type AssignedComponent, type SalaryLineDef,
} from "../payroll-calc.js";

const line = (over: Partial<SalaryLineDef> & Pick<SalaryLineDef, "code" | "category" | "calcType" | "value">): SalaryLineDef => ({
  name: over.code,
  type: "earning",
  isWage: false,
  prorate: true,
  ...over,
});

const BASIC40 = line({ code: "BASIC", category: "basic", calcType: "percent_of_ctc", value: 40, isWage: true });
const HRA = line({ code: "HRA", category: "hra", calcType: "percent_of_basic", value: 50 });
const SPECIAL = line({ code: "SPL", category: "special_allowance", calcType: "balance", value: 0 });

describe("paise helpers and rounding", () => {
  it("converts rupees and paise without float noise", () => {
    expect(rupeesToPaise("1234.50")).toBe(123450);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
    expect(rupeesToPaise("1.005")).toBe(101); // half up
    expect(paiseToRupees(123450)).toBe("1234.50");
    expect(paiseToRupees(5)).toBe("0.05");
    expect(paiseToRupees(-12345)).toBe("-123.45");
    expect(() => rupeesToPaise("abc")).toThrow(PayrollRuleError);
  });
  it("rounds half up, once", () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(4, 2)).toBe(2);
    expect(roundDiv(7, 3)).toBe(2);
    expect(roundDiv(10, 3)).toBe(3);
    expect(roundDiv(0, 7)).toBe(0);
    expect(percentOf(100_000, 12.5)).toBe(12_500);
    expect(percentOf(333, 50)).toBe(167);
  });
});

describe("computeSalaryBreakdown: annual CTC to monthly amounts", () => {
  it("splits a 6,00,000 CTC into Basic 40%, HRA 50% of Basic and the balance", () => {
    const b = computeSalaryBreakdown({ annualCtcPaise: 600_000_00, lines: [BASIC40, HRA, SPECIAL] });
    expect(b.monthlyCtcPaise).toBe(50_000_00);
    const by = Object.fromEntries(b.lines.map((l) => [l.code, l.monthlyPaise]));
    expect(by.BASIC).toBe(20_000_00);
    expect(by.HRA).toBe(10_000_00);
    expect(by.SPL).toBe(20_000_00);
    expect(b.grossPaise).toBe(50_000_00);
    expect(b.unallocatedPaise).toBe(0);
    expect(b.wagesPaise).toBe(20_000_00);
    expect(b.wagePercent).toBe(40);
    // 40% wages: the Labour Code warning (a warning, never an error).
    expect(b.warnings.map((w) => w.code)).toEqual(["wages_below_50_percent"]);
  });

  it("no warning when wages are at least half of the remuneration", () => {
    const basic50 = line({ code: "BASIC", category: "basic", calcType: "percent_of_ctc", value: 50, isWage: true });
    const b = computeSalaryBreakdown({ annualCtcPaise: 600_000_00, lines: [basic50, SPECIAL] });
    expect(b.wagePercent).toBe(50);
    expect(b.warnings).toEqual([]);
    expect(checkWageRule(49, 100).ok).toBe(false);
    expect(checkWageRule(50, 100).ok).toBe(true);
    expect(checkWageRule(0, 0)).toEqual({ ok: true, percent: null });
  });

  it("DA and retaining allowance count as wages", () => {
    const da = line({ code: "DA", category: "da", calcType: "fixed", value: 10_000, isWage: true });
    const basic = line({ code: "BASIC", category: "basic", calcType: "fixed", value: 20_000, isWage: true });
    const b = computeSalaryBreakdown({ annualCtcPaise: 480_000_00, lines: [basic, da, SPECIAL] });
    expect(b.wagesPaise).toBe(30_000_00);
    expect(b.warnings).toEqual([]);
  });

  it("employer contributions are part of CTC, deductions are not", () => {
    const employer = line({ code: "EC", category: "other_employer", type: "employer_contribution", calcType: "fixed", value: 2_000 });
    const ded = line({ code: "DED", category: "manual_deduction", type: "deduction", calcType: "fixed", value: 500 });
    const basic = line({ code: "BASIC", category: "basic", calcType: "percent_of_ctc", value: 60, isWage: true });
    const b = computeSalaryBreakdown({ annualCtcPaise: 600_000_00, lines: [basic, employer, ded, SPECIAL] });
    expect(b.monthlyCtcPaise).toBe(50_000_00);
    expect(b.employerPaise).toBe(2_000_00);
    expect(b.deductionsPaise).toBe(500_00);
    expect(b.grossPaise).toBe(48_000_00); // CTC - employer contribution
    expect(b.takeHomePaise).toBe(47_500_00);
    expect(b.unallocatedPaise).toBe(0);
  });

  it("warns when part of the CTC is not given to a component", () => {
    const basic = line({ code: "BASIC", category: "basic", calcType: "fixed", value: 20_000, isWage: true });
    const b = computeSalaryBreakdown({ annualCtcPaise: 600_000_00, lines: [basic] });
    expect(b.unallocatedPaise).toBe(30_000_00);
    expect(b.warnings.some((w) => w.code === "ctc_mismatch")).toBe(true);
  });

  it("rounds a CTC that does not divide by 12 once, half up", () => {
    // 1,00,001 / 12 = 8333.4166... -> 8333.42
    const b = computeSalaryBreakdown({ annualCtcPaise: 100_001_00, lines: [line({ code: "BASIC", category: "basic", calcType: "balance", value: 0, isWage: true })] });
    expect(b.monthlyCtcPaise).toBe(833_342);
    expect(b.grossPaise).toBe(833_342);
  });

  it("refuses an impossible structure", () => {
    const fixed = line({ code: "BASIC", category: "basic", calcType: "fixed", value: 60_000, isWage: true });
    expect(() => computeSalaryBreakdown({ annualCtcPaise: 600_000_00, lines: [fixed, SPECIAL] })).toThrow(/more than the monthly CTC/);
    expect(() => computeSalaryBreakdown({ annualCtcPaise: 600_000_00, lines: [SPECIAL, { ...SPECIAL, code: "SPL2" }] })).toThrow(/Only one component/);
    expect(() => computeSalaryBreakdown({ annualCtcPaise: 600_000_00, lines: [HRA] })).toThrow(/Add a Basic/);
    expect(() => computeSalaryBreakdown({ annualCtcPaise: 600_000_00, lines: [line({ code: "BASIC", category: "basic", calcType: "percent_of_basic", value: 10 }), HRA] })).toThrow();
    expect(() => computeSalaryBreakdown({ annualCtcPaise: 600_000_00, lines: [BASIC40, line({ code: "X", category: "hra", calcType: "percent_of_ctc", value: 120 })] })).toThrow(/between 0 and 100/);
    expect(() => computeSalaryBreakdown({ annualCtcPaise: -1, lines: [BASIC40] })).toThrow(/zero or more/);
    expect(() => computeSalaryBreakdown({ annualCtcPaise: 100, lines: [line({ code: "D", category: "manual_deduction", type: "deduction", calcType: "balance", value: 0 })] })).toThrow(/Only an earning/);
  });
});

const comp = (over: Partial<AssignedComponent> & Pick<AssignedComponent, "code" | "category" | "monthlyPaise">): AssignedComponent => ({
  name: over.code, type: "earning", isWage: false, prorate: true, ...over,
});

const STAFF: AssignedComponent[] = [
  comp({ code: "BASIC", category: "basic", monthlyPaise: 20_000_00, isWage: true }),
  comp({ code: "HRA", category: "hra", monthlyPaise: 10_000_00 }),
  comp({ code: "SPL", category: "special_allowance", monthlyPaise: 20_000_00 }),
];

function pay(over: Partial<Parameters<typeof computePayrollLine>[0]> = {}) {
  return computePayrollLine({ components: STAFF, daysInMonth: 30, employedDays: 30, paidDays: 30, lopDays: 0, ...over });
}

describe("computePayrollLine: earnings - LOP - deductions = net pay", () => {
  it("a full month pays the full amounts", () => {
    const r = pay();
    expect(r.grossPaise).toBe(50_000_00);
    expect(r.netPaise).toBe(50_000_00);
    expect(r.components.map((c) => c.amountPaise)).toEqual([20_000_00, 10_000_00, 20_000_00]);
  });

  it("loss of pay prorates each earning by paid days / days in month and rounds each once", () => {
    // 27 of 30 paid days.
    const r = pay({ paidDays: 27, lopDays: 3 });
    expect(r.components.map((c) => c.amountPaise)).toEqual([18_000_00, 9_000_00, 18_000_00]);
    expect(r.grossPaise).toBe(45_000_00);
  });

  it("rounds to the paisa, half up, and totals are the sum of the rounded parts", () => {
    // 20,000.00 x 17 / 31 = 10967.7419... ; 10,000 x 17 / 31 = 5483.8709...
    const r = computePayrollLine({ components: STAFF, daysInMonth: 31, employedDays: 31, paidDays: 17, lopDays: 14 });
    expect(r.components.map((c) => c.amountPaise)).toEqual([1_096_774, 548_387, 1_096_774]);
    expect(r.grossPaise).toBe(1_096_774 + 548_387 + 1_096_774);
  });

  it("half days: 28.5 paid days", () => {
    const r = pay({ paidDays: 28.5, lopDays: 1.5 });
    expect(r.components[0]!.amountPaise).toBe(19_000_00);
  });

  it("works in 28, 29, 30 and 31 day months", () => {
    for (const dim of [28, 29, 30, 31]) {
      const full = computePayrollLine({ components: STAFF, daysInMonth: dim, employedDays: dim, paidDays: dim, lopDays: 0 });
      expect(full.grossPaise).toBe(50_000_00);
      const one = computePayrollLine({ components: STAFF, daysInMonth: dim, employedDays: dim, paidDays: dim - 1, lopDays: 1 });
      expect(one.components[0]!.amountPaise).toBe(roundDiv(20_000_00 * (dim - 1), dim));
    }
  });

  it("joining mid-month: 16 of 31 days employed and paid", () => {
    const r = computePayrollLine({ components: STAFF, daysInMonth: 31, employedDays: 16, paidDays: 16, lopDays: 0 });
    expect(r.components[0]!.amountPaise).toBe(roundDiv(20_000_00 * 16, 31));
  });

  it("zero paid days pays nothing, even a component that is not prorated", () => {
    const withBonus = [...STAFF, comp({ code: "BON", category: "bonus", monthlyPaise: 5_000_00, prorate: false })];
    const r = computePayrollLine({ components: withBonus, daysInMonth: 31, employedDays: 31, paidDays: 0, lopDays: 31 });
    expect(r.grossPaise).toBe(0);
    expect(r.netPaise).toBe(0);
    const some = computePayrollLine({ components: withBonus, daysInMonth: 31, employedDays: 31, paidDays: 1, lopDays: 30 });
    expect(some.components.find((c) => c.code === "BON")!.amountPaise).toBe(5_000_00);
  });

  it("manual deductions and adjustments change the net pay; employer contributions do not", () => {
    const withDed = [
      ...STAFF,
      comp({ code: "EC", category: "other_employer", type: "employer_contribution", monthlyPaise: 1_000_00 }),
      comp({ code: "DED", category: "manual_deduction", type: "deduction", monthlyPaise: 500_00, prorate: false }),
    ];
    const r = computePayrollLine({
      components: withDed, daysInMonth: 30, employedDays: 30, paidDays: 30, lopDays: 0,
      adjustments: [
        { name: "Advance recovery", type: "deduction", category: "advance_recovery", amountPaise: 2_000_00 },
        { name: "Spot award", type: "earning", amountPaise: 1_500_00 },
      ],
    });
    expect(r.grossPaise).toBe(51_500_00);
    expect(r.deductionsPaise).toBe(2_500_00);
    expect(r.employerPaise).toBe(1_000_00);
    expect(r.netPaise).toBe(49_000_00);
  });

  it("flags a negative net pay", () => {
    const r = computePayrollLine({
      components: STAFF, daysInMonth: 30, employedDays: 30, paidDays: 30, lopDays: 0,
      adjustments: [{ name: "Recovery", type: "deduction", amountPaise: 60_000_00 }],
    });
    expect(r.netPaise).toBe(-10_000_00);
    expect(r.warnings.map((w) => w.code)).toContain("negative_net");
  });

  it("overtime = hours x hourly wage x multiplier (wages / days / standard hours)", () => {
    // wages 20,000 / 30 days / 8 hours = 83.3333/h ; x 2 x 10h = 1666.67
    const r = pay({ overtimeHours: 10 });
    expect(r.overtimePaise).toBe(166_667);
    expect(r.components.at(-1)).toMatchObject({ code: "OT", category: "overtime", amountPaise: 166_667, source: "overtime" });
    expect(r.grossPaise).toBe(50_000_00 + 166_667);
    // A different multiplier and day length.
    expect(pay({ overtimeHours: 10, overtimeMultiplier: 1.5, standardHoursPerDay: 9 }).overtimePaise).toBe(roundDiv(20_000_00 * 1000 * 150, 30 * 9 * 100 * 100));
    expect(pay({ overtimeHours: 0 }).overtimePaise).toBe(0);
  });

  it("warns (does not block) when wages are under 50% of the remuneration", () => {
    expect(pay().warnings.map((w) => w.code)).toContain("wages_below_50_percent"); // 20k of 50k = 40%
  });

  it("rejects impossible inputs", () => {
    expect(() => pay({ paidDays: 31 })).toThrow(/between 0/);
    expect(() => pay({ paidDays: 10.3 })).toThrow(/whole or half/);
    expect(() => computePayrollLine({ components: STAFF, daysInMonth: 32, employedDays: 30, paidDays: 30, lopDays: 0 })).toThrow(/28 to 31/);
  });

  it("is deterministic: the same input always gives the same output", () => {
    const a = pay({ paidDays: 23.5, lopDays: 6.5, overtimeHours: 3.25 });
    const b = pay({ paidDays: 23.5, lopDays: 6.5, overtimeHours: 3.25 });
    expect(a).toEqual(b);
  });
});

describe("run totals and posting", () => {
  it("sums lines", () => {
    const l1 = pay();
    const l2 = pay({ paidDays: 27, lopDays: 3 });
    const t = sumRunTotals([l1, l2]);
    expect(t.employees).toBe(2);
    expect(t.grossPaise).toBe(l1.grossPaise + l2.grossPaise);
    expect(t.netPaise).toBe(l1.netPaise + l2.netPaise);
  });

  it("groups salary expense and the journal balances: expense = net + deductions + employer", () => {
    const comps = [
      ...STAFF,
      comp({ code: "BON", category: "bonus", monthlyPaise: 3_000_00, prorate: false }),
      comp({ code: "EC", category: "other_employer", type: "employer_contribution", monthlyPaise: 1_200_00 }),
      comp({ code: "DED", category: "manual_deduction", type: "deduction", monthlyPaise: 700_00, prorate: false }),
    ];
    const lines = [
      computePayrollLine({ components: comps, daysInMonth: 31, employedDays: 31, paidDays: 31, lopDays: 0, overtimeHours: 4 }),
      computePayrollLine({ components: comps, daysInMonth: 31, employedDays: 31, paidDays: 19.5, lopDays: 11.5 }),
      computePayrollLine({ components: comps, daysInMonth: 31, employedDays: 5, paidDays: 5, lopDays: 0, adjustments: [{ name: "Recovery", type: "deduction", amountPaise: 123_45 }] }),
    ];
    const posting = buildPostingTotals(lines);
    const debit = Object.values(posting.expense).reduce((s, n) => s + n, 0);
    const credit = posting.netPayablePaise + posting.deductionsPayablePaise + posting.employerPayablePaise;
    expect(debit).toBe(credit);
    expect(posting.expense.wages).toBeGreaterThan(0);
    expect(posting.expense.overtime).toBeGreaterThan(0);
    expect(posting.expense.bonus_incentives).toBeGreaterThan(0);
    expect(posting.expense.employer_contributions).toBeGreaterThan(0);
    expect(posting.netPayablePaise).toBe(lines.reduce((s, l) => s + l.netPaise, 0));
  });

  it("expense groups", () => {
    expect(expenseGroupOf({ type: "earning", category: "basic" })).toBe("wages");
    expect(expenseGroupOf({ type: "earning", category: "hra" })).toBe("allowances");
    expect(expenseGroupOf({ type: "earning", category: "incentive" })).toBe("bonus_incentives");
    expect(expenseGroupOf({ type: "employer_contribution", category: "other_employer" })).toBe("employer_contributions");
    expect(expenseGroupOf({ type: "deduction", category: "manual_deduction" })).toBeNull();
  });
});

describe("status machine and maker-checker", () => {
  it("moves forward one step at a time", () => {
    expect(canTransitionRun("draft", "attendance_locked")).toBe(true);
    expect(canTransitionRun("draft", "calculated")).toBe(false);
    expect(canTransitionRun("calculated", "calculated")).toBe(true); // recalculate
    expect(canTransitionRun("pending_approval", "approved")).toBe(true);
    expect(canTransitionRun("approved", "posted")).toBe(true);
    expect(canTransitionRun("posted", "paid")).toBe(true);
  });
  it("can be reopened only before approval", () => {
    for (const s of PAYROLL_RUN_STATUSES) {
      const reopen = canTransitionRun(s, "draft");
      expect(reopen).toBe(["attendance_locked", "calculated", "pending_approval"].includes(s));
    }
    expect(isRunEditable("pending_approval")).toBe(true);
    expect(isRunEditable("approved")).toBe(false);
    expect(isRunEditable("paid")).toBe(false);
  });
  it("the person who calculated cannot approve, unless the business has a single user", () => {
    expect(approverAllowed({ approverUserId: "a", calculatedByUserId: "a", businessMemberCount: 3 })).toBe(false);
    expect(approverAllowed({ approverUserId: "b", calculatedByUserId: "a", businessMemberCount: 3 })).toBe(true);
    expect(approverAllowed({ approverUserId: "a", calculatedByUserId: "a", businessMemberCount: 1 })).toBe(true);
    expect(approverAllowed({ approverUserId: "a", calculatedByUserId: null, businessMemberCount: 2 })).toBe(true);
  });
});
