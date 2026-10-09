import { describe, it, expect } from "vitest";
import {
  PayrollRuleError,
  addMonths,
  applyLoanRecoveryToLine,
  bonusCalculationCapPaise,
  buildPostingTotals,
  computePayrollLine,
  bonusRulesGaps,
  buildRepaymentSchedule,
  canTransitionBonusRun,
  canTransitionFnf,
  fnfReverseSchema,
  computeEmiPaise,
  computeEmployeeBonus,
  computeFnf,
  computeGratuityFull,
  computeLeaveEncashment,
  computeNoticeRecovery,
  defaultStatutoryRates,
  encashableDays,
  gratuityLiability,
  letterTemplateSchema,
  loanCreateSchema,
  planLoanRecovery,
  renderLetterBody,
  unknownPlaceholders,
  validateBonusPercent,
  DEFAULT_RELIEVING_LETTER_BODY,
  type BonusMonthInput,
  type BonusRules,
  type FnfLine,
} from "../index.js";

const rules: BonusRules = { ...defaultStatutoryRates().bonus, eligibilityCeilingRupees: 21000, wageCeilingRupees: 7000, minimumWageRupees: 0 };
const gRules = defaultStatutoryRates().gratuity;

/** Twelve months from April 2025; wages in rupees. */
function year(fullRupees: number, earnedRupees = fullRupees, paidDays = 30, dim = 30): BonusMonthInput[] {
  return Array.from({ length: 12 }, (_, i) => ({
    month: addMonths("2025-04", i),
    daysInMonth: dim,
    paidDays,
    earnedWagePaise: earnedRupees * 100,
    fullWagePaise: fullRupees * 100,
  }));
}

describe("bonus rules shipped data", () => {
  it("seeds the statutory percentage range and 30 days, and leaves the ceilings empty", () => {
    const b = defaultStatutoryRates().bonus;
    expect(b).toMatchObject({ minPercent: 8.33, maxPercent: 20, minWorkingDays: 30, eligibilityCeilingRupees: 0, wageCeilingRupees: 0, minimumWageRupees: 0 });
    expect(bonusRulesGaps(b)).toHaveLength(2);
    expect(bonusRulesGaps(rules)).toEqual([]);
  });
  it("the calculation cap is the higher of the ceiling and the minimum wage", () => {
    expect(bonusCalculationCapPaise(rules)).toBe(700_000);
    expect(bonusCalculationCapPaise({ ...rules, minimumWageRupees: 9000 })).toBe(900_000);
    expect(bonusCalculationCapPaise({ ...rules, wageCeilingRupees: 0, minimumWageRupees: 9000 })).toBe(900_000);
  });
  it("validates the percentage range at its boundaries", () => {
    expect(validateBonusPercent(8.33, rules)).toBeNull();
    expect(validateBonusPercent(20, rules)).toBeNull();
    expect(validateBonusPercent(8.32, rules)).toMatch(/below 8.33/);
    expect(validateBonusPercent(20.01, rules)).toMatch(/above 20/);
    expect(validateBonusPercent(0, rules)).toMatch(/Enter/);
  });
});

describe("computeEmployeeBonus", () => {
  it("caps each month at the ceiling and applies the percentage once", () => {
    const r = computeEmployeeBonus({ months: year(10000) }, rules, 8.33);
    expect(r.eligible).toBe(true);
    expect(r.calculationWagesPaise).toBe(12 * 700_000);
    expect(r.bonusPaise).toBe(699_720); // 84,000 x 8.33% = 6,997.20
  });
  it("uses the actual wage when it is below the cap", () => {
    const r = computeEmployeeBonus({ months: year(5000) }, rules, 20);
    expect(r.calculationWagesPaise).toBe(12 * 500_000);
    expect(r.bonusPaise).toBe(1_200_000);
  });
  it("a minimum wage above the ceiling raises the cap", () => {
    const r = computeEmployeeBonus({ months: year(10000) }, { ...rules, minimumWageRupees: 9000 }, 10);
    expect(r.calculationWagesPaise).toBe(12 * 900_000);
  });
  it("eligibility ceiling: exactly the ceiling is eligible", () => {
    expect(computeEmployeeBonus({ months: year(21000) }, rules, 8.33).eligible).toBe(true);
  });
  it("one paisa above the eligibility ceiling is not eligible", () => {
    const months = year(0).map((m) => ({ ...m, fullWagePaise: 2_100_001, earnedWagePaise: 2_100_001 }));
    const r = computeEmployeeBonus({ months }, rules, 8.33);
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("wage_above_ceiling");
    expect(r.bonusPaise).toBe(0);
  });
  it("tests eligibility on the last paid month", () => {
    const months = year(25000).map((m, i) => (i === 11 ? { ...m, fullWagePaise: 2_000_000 } : m));
    expect(computeEmployeeBonus({ months }, rules, 8.33).eligible).toBe(true);
  });
  it("minimum working days: 30 is enough, 29.5 is not", () => {
    const one = (paid: number): BonusMonthInput[] => [{ month: "2025-04", daysInMonth: 30, paidDays: paid, earnedWagePaise: 500_000, fullWagePaise: 500_000 }];
    expect(computeEmployeeBonus({ months: one(30) }, rules, 8.33).eligible).toBe(true);
    const short = computeEmployeeBonus({ months: one(29.5) }, rules, 8.33);
    expect(short.eligible).toBe(false);
    expect(short.reason).toBe("too_few_days");
  });
  it("prorates the cap by days worked in a part month", () => {
    const months: BonusMonthInput[] = [
      { month: "2025-04", daysInMonth: 30, paidDays: 30, earnedWagePaise: 1_000_000, fullWagePaise: 1_000_000 },
      // 15 of 31 days: earned 5,000, cap 7,000 x 30 / 62 = 3,387.10
      { month: "2025-05", daysInMonth: 31, paidDays: 15, earnedWagePaise: 500_000, fullWagePaise: 1_000_000 },
    ];
    const r = computeEmployeeBonus({ months }, rules, 10);
    expect(r.calculationWagesPaise).toBe(700_000 + 338_710);
    expect(r.bonusPaise).toBe(103_871);
  });
  it("a manual exclusion wins and carries its reason", () => {
    const r = computeEmployeeBonus({ months: year(10000), manualReason: "Dismissed for misconduct" }, rules, 8.33);
    expect(r).toMatchObject({ eligible: false, reason: "manual", bonusPaise: 0 });
    expect(r.reasonText).toContain("misconduct");
  });
  it("no pay at all is not eligible", () => {
    expect(computeEmployeeBonus({ months: [] }, rules, 8.33).reason).toBe("no_pay");
  });
  it("refuses to calculate with empty ceilings or a percentage out of range", () => {
    expect(() => computeEmployeeBonus({ months: year(10000) }, defaultStatutoryRates().bonus, 8.33)).toThrow(PayrollRuleError);
    expect(() => computeEmployeeBonus({ months: year(10000) }, rules, 8.32)).toThrow(/below/);
    expect(() => computeEmployeeBonus({ months: year(10000) }, rules, 20.5)).toThrow(/above/);
  });
});

describe("gratuity", () => {
  const base = { lastDrawnWagesPaise: 5_000_000, employmentType: "permanent", rules: gRules };
  it("15/26 x wages x years, exactly five completed years is eligible", () => {
    const g = computeGratuityFull({ ...base, joinedOn: "2020-01-01", endOn: "2024-12-31" });
    expect(g).toMatchObject({ completedYears: 5, yearsForFormula: 5, eligible: true, rule: "standard", minYearsRequired: 5 });
    expect(g.amountPaise).toBe(14_423_077); // 50,000 x 15 x 5 / 26 = 144,230.77
  });
  it("one day short of five years is not eligible even though it rounds up to five", () => {
    const g = computeGratuityFull({ ...base, joinedOn: "2020-01-01", endOn: "2024-12-30" });
    expect(g.completedYears).toBe(4);
    expect(g.yearsForFormula).toBe(5);
    expect(g.eligible).toBe(false);
    expect(g.amountPaise).toBe(0);
    expect(g.ifEligiblePaise).toBe(14_423_077);
  });
  it("exactly six months of the part year does not round up; one day more does", () => {
    expect(computeGratuityFull({ ...base, joinedOn: "2020-01-01", endOn: "2025-06-30" }).yearsForFormula).toBe(5);
    expect(computeGratuityFull({ ...base, joinedOn: "2020-01-01", endOn: "2025-07-01" }).yearsForFormula).toBe(6);
  });
  it("fixed-term staff need one year", () => {
    const ft = { ...base, employmentType: "contract" };
    expect(computeGratuityFull({ ...ft, joinedOn: "2023-01-01", endOn: "2023-12-31" })).toMatchObject({ eligible: true, rule: "fixed_term", minYearsRequired: 1 });
    expect(computeGratuityFull({ ...ft, joinedOn: "2023-01-01", endOn: "2023-12-30" }).eligible).toBe(false);
  });
  it("death and disablement have no minimum service", () => {
    const g = computeGratuityFull({ ...base, joinedOn: "2024-01-01", endOn: "2024-08-15", exitReason: "death" });
    expect(g).toMatchObject({ eligible: true, rule: "exempt", minYearsRequired: 0, completedYears: 0, yearsForFormula: 1 });
    expect(g.amountPaise).toBe(2_884_615); // 50,000 x 15 / 26 = 28,846.15
    expect(computeGratuityFull({ ...base, joinedOn: "2024-01-01", endOn: "2024-08-15", exitReason: "resignation" }).eligible).toBe(false);
  });
  it("less than six months of service gives nothing even when exempt", () => {
    expect(computeGratuityFull({ ...base, joinedOn: "2024-01-01", endOn: "2024-03-15", exitReason: "disablement" }).amountPaise).toBe(0);
  });
  it("applies the limit", () => {
    const g = computeGratuityFull({ ...base, lastDrawnWagesPaise: 50_000_000, joinedOn: "2000-01-01", endOn: "2024-12-31" });
    expect(g.capped).toBe(true);
    expect(g.amountPaise).toBe(200_000_000);
    expect(g.rawPaise).toBeGreaterThan(200_000_000);
  });
  it("no cap when the limit is 0", () => {
    const g = computeGratuityFull({ ...base, lastDrawnWagesPaise: 50_000_000, rules: { ...gRules, capRupees: 0 }, joinedOn: "2000-01-01", endOn: "2024-12-31" });
    expect(g.capped).toBe(false);
  });
  it("liability sums what is payable today and what would be if eligible", () => {
    const mk = (end: string) => ({ employeeId: "x", employeeCode: "E", name: "N", joinedOn: "2020-01-01", employmentType: "permanent", lastDrawnWagesPaise: 5_000_000, detail: computeGratuityFull({ ...base, joinedOn: "2020-01-01", endOn: end }) });
    const l = gratuityLiability([mk("2024-12-31"), mk("2023-12-31")]);
    expect(l.eligibleCount).toBe(1);
    expect(l.payableTodayPaise).toBe(14_423_077);
    expect(l.ifEligiblePaise).toBeGreaterThan(l.payableTodayPaise);
  });
});

describe("loan EMI and schedule", () => {
  it("12% over 12 months on 1,00,000 gives the textbook EMI and ends at zero", () => {
    expect(computeEmiPaise(10_000_000, 12, 12)).toBe(888_488);
    const s = buildRepaymentSchedule({ principalPaise: 10_000_000, annualRatePct: 12, count: 12, firstMonth: "2026-11" });
    expect(s).toHaveLength(12);
    expect(s[0]).toMatchObject({ month: "2026-11", openingPaise: 10_000_000, interestPaise: 100_000, principalPaise: 788_488 });
    expect(s[11]!.closingPaise).toBe(0);
    expect(s[11]!.month).toBe("2027-10");
    expect(s.reduce((n, r) => n + r.principalPaise, 0)).toBe(10_000_000);
    // the last instalment absorbs the rounding
    expect(Math.abs(s[11]!.emiPaise - s[0]!.emiPaise)).toBeLessThan(20);
  });
  it("interest free: equal instalments, the last one takes the remainder", () => {
    const s = buildRepaymentSchedule({ principalPaise: 1_000_000, annualRatePct: 0, count: 3, firstMonth: "2026-10" });
    expect(s.map((r) => r.emiPaise)).toEqual([333_333, 333_333, 333_334]);
    expect(s.every((r) => r.interestPaise === 0)).toBe(true);
  });
  it("a single instalment clears the loan with its interest", () => {
    const s = buildRepaymentSchedule({ principalPaise: 1_000_000, annualRatePct: 12, count: 1, firstMonth: "2026-10" });
    expect(s).toEqual([{ seq: 1, month: "2026-10", openingPaise: 1_000_000, principalPaise: 1_000_000, interestPaise: 10_000, emiPaise: 1_010_000, closingPaise: 0 }]);
  });
  it("an EMI given instead of a count sets the number of instalments", () => {
    const s = buildRepaymentSchedule({ principalPaise: 1_200_000, annualRatePct: 0, emiPaise: 500_000, firstMonth: "2026-10" });
    expect(s.map((r) => r.emiPaise)).toEqual([500_000, 500_000, 200_000]);
  });
  it("refuses an EMI that does not cover the interest", () => {
    expect(() => buildRepaymentSchedule({ principalPaise: 10_000_000, annualRatePct: 12, emiPaise: 50_000, firstMonth: "2026-10" })).toThrow(/too small/);
  });
  it("prepayment: re-scheduling the balance at the same EMI shortens the loan", () => {
    const orig = buildRepaymentSchedule({ principalPaise: 10_000_000, annualRatePct: 12, count: 12, firstMonth: "2026-11" });
    const prepaid = orig[2]!.closingPaise - 2_000_000;
    const rest = buildRepaymentSchedule({ principalPaise: prepaid, annualRatePct: 12, emiPaise: orig[0]!.emiPaise, firstMonth: "2027-02", startSeq: 4 });
    expect(rest.length).toBeLessThan(9);
    expect(rest[0]!.seq).toBe(4);
    expect(rest[rest.length - 1]!.closingPaise).toBe(0);
  });
  it("validates inputs", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect(() => computeEmiPaise(0, 0, 3)).toThrow(PayrollRuleError);
    expect(() => computeEmiPaise(1000, 0, 0)).toThrow(PayrollRuleError);
    expect(loanCreateSchema.safeParse({ employeeId: id, amount: 1000, startMonth: "2026-11", issueDate: "2026-10-01" }).success).toBe(false);
    expect(loanCreateSchema.safeParse({ employeeId: id, amount: 1000, installments: 4, startMonth: "2026-11", issueDate: "2026-10-01" }).success).toBe(true);
    expect(loanCreateSchema.safeParse({ employeeId: id, amount: 1000, installments: 4, emi: 300, startMonth: "2026-11", issueDate: "2026-10-01" }).success).toBe(false);
  });
});

describe("planLoanRecovery", () => {
  const loan = (id: string, insts: Array<[number, number, number]>) => ({
    loanId: id,
    loanNumber: `LN-${id}`,
    installments: insts.map(([seq, p, i]) => ({ installmentId: `${id}-${seq}`, seq, dueMonth: "2026-11", principalDuePaise: p, interestDuePaise: i })),
  });
  it("recovers everything due when the net pay allows", () => {
    const p = planLoanRecovery({ netPaise: 5_000_000, maxSharePercent: 50, loans: [loan("a", [[1, 800_000, 100_000]])] });
    expect(p.recoveredPaise).toBe(900_000);
    expect(p.shortfallPaise).toBe(0);
    expect(p.lines[0]).toMatchObject({ principalPaise: 800_000, interestPaise: 100_000, arrearsPaise: 0 });
  });
  it("caps at the share of net pay, interest before principal, and carries the rest as arrears", () => {
    const p = planLoanRecovery({ netPaise: 1_000_000, maxSharePercent: 50, loans: [loan("a", [[1, 800_000, 100_000]])] });
    expect(p.allowedPaise).toBe(500_000);
    expect(p.lines[0]).toMatchObject({ interestPaise: 100_000, principalPaise: 400_000, arrearsPaise: 400_000 });
    expect(p.shortfallPaise).toBe(400_000);
  });
  it("takes the oldest instalment first across loans", () => {
    const p = planLoanRecovery({ netPaise: 1_000_000, maxSharePercent: 100, loans: [loan("a", [[1, 600_000, 0], [2, 600_000, 0]]), loan("b", [[1, 300_000, 0]])] });
    expect(p.lines[0]!.principalPaise).toBe(1_000_000);
    expect(p.lines[1]!.principalPaise).toBe(0);
    expect(p.lines[0]!.allocations.map((a) => a.principalPaise)).toEqual([600_000, 400_000]);
  });
  it("recovers nothing from zero or negative net pay", () => {
    expect(planLoanRecovery({ netPaise: 0, maxSharePercent: 50, loans: [loan("a", [[1, 100, 0]])] }).recoveredPaise).toBe(0);
    expect(planLoanRecovery({ netPaise: -5, maxSharePercent: 50, loans: [loan("a", [[1, 100, 0]])] }).recoveredPaise).toBe(0);
  });
  it("floors the allowed share to the paisa", () => {
    expect(planLoanRecovery({ netPaise: 1001, maxSharePercent: 50, loans: [] }).allowedPaise).toBe(500);
  });
});

describe("full and final", () => {
  const e = (kind: FnfLine["kind"], amountPaise: number): FnfLine => ({ kind, label: kind, amountPaise });
  it("adds earnings, takes recoveries, then loans last", () => {
    const r = computeFnf({
      earnings: [e("gratuity", 1_000_000), e("leave_encashment", 200_000)],
      deductions: [e("notice_recovery", 100_000), e("tds", 50_000)],
      loans: [{ loanId: "l1", loanNumber: "LN-0001", outstandingPrincipalPaise: 300_000 }],
    });
    expect(r.grossPaise).toBe(1_200_000);
    expect(r.loanRecoveredPaise).toBe(300_000);
    expect(r.netPayablePaise).toBe(750_000);
    expect(r.deductions.map((d) => d.kind)).toEqual(["notice_recovery", "tds", "loan_recovery"]);
    expect(r.warnings).toEqual([]);
  });
  it("never takes the net below zero for a loan: the rest stays outstanding", () => {
    const r = computeFnf({ earnings: [e("leave_encashment", 100_000)], deductions: [], loans: [{ loanId: "l1", loanNumber: "LN-0001", outstandingPrincipalPaise: 300_000 }] });
    expect(r.loanRecoveredPaise).toBe(100_000);
    expect(r.loanShortfallPaise).toBe(200_000);
    expect(r.netPayablePaise).toBe(0);
    expect(r.warnings[0]!.code).toBe("loan_not_fully_recovered");
  });
  it("flags a negative net from manual recoveries", () => {
    const r = computeFnf({ earnings: [e("arrears", 10_000)], deductions: [e("notice_recovery", 20_000)], loans: [{ loanId: "l1", loanNumber: "LN", outstandingPrincipalPaise: 5_000 }] });
    expect(r.netPayablePaise).toBe(-10_000);
    expect(r.loanRecoveredPaise).toBe(0);
    expect(r.warnings.map((w) => w.code)).toContain("negative_net");
  });
  it("skips zero lines", () => {
    expect(computeFnf({ earnings: [e("bonus", 0)], deductions: [], loans: [] }).earnings).toEqual([]);
  });
  it("leave encashment on each basis, rounded once", () => {
    expect(computeLeaveEncashment({ days: 10, basicDaPaise: 3_000_000, grossPaise: 6_000_000, basis: "basic_da_26" })).toEqual({ ratePerDayPaise: 115_385, amountPaise: 1_153_846 });
    expect(computeLeaveEncashment({ days: 10, basicDaPaise: 3_000_000, grossPaise: 6_000_000, basis: "basic_da_30" }).amountPaise).toBe(1_000_000);
    expect(computeLeaveEncashment({ days: 2.5, basicDaPaise: 3_000_000, grossPaise: 6_000_000, basis: "gross_30" }).amountPaise).toBe(500_000);
  });
  it("encashable days respect the type's rules", () => {
    expect(encashableDays(12, { encashable: false, carryForward: true, carryForwardMax: 30 })).toBe(0);
    expect(encashableDays(12, { encashable: true, carryForward: false, carryForwardMax: 0 })).toBe(12);
    expect(encashableDays(40, { encashable: true, carryForward: true, carryForwardMax: 30 })).toBe(30);
    expect(encashableDays(-3, { encashable: true, carryForward: false, carryForwardMax: 0 })).toBe(0);
  });
  it("notice recovery is a day rate of gross / 30", () => {
    expect(computeNoticeRecovery(5, 6_000_000)).toBe(1_000_000);
    expect(computeNoticeRecovery(0.5, 6_000_000)).toBe(100_000);
    expect(computeNoticeRecovery(0, 6_000_000)).toBe(0);
  });
  it("state machines", () => {
    expect(canTransitionFnf("draft", "pending_approval")).toBe(true);
    expect(canTransitionFnf("approved", "draft")).toBe(false);
    expect(canTransitionFnf("posted", "paid")).toBe(true);
    // Reversal: only a posted settlement is reversed (terminal); a paid one goes back to posted when its payment is reversed.
    expect(canTransitionFnf("posted", "reversed")).toBe(true);
    expect(canTransitionFnf("paid", "reversed")).toBe(false);
    expect(canTransitionFnf("paid", "posted")).toBe(true);
    expect(canTransitionFnf("reversed", "posted")).toBe(false);
    expect(fnfReverseSchema.safeParse({ id: "0b3f2d9e-6c1a-4c3e-9a55-0d6a2f8c1e11", reason: "abc" }).success).toBe(false);
    expect(fnfReverseSchema.safeParse({ id: "0b3f2d9e-6c1a-4c3e-9a55-0d6a2f8c1e11", reason: "  Wrong employee  " })).toMatchObject({ success: true, data: { reason: "Wrong employee" } });
    expect(canTransitionBonusRun("approved", "posted")).toBe(true);
    expect(canTransitionBonusRun("posted", "calculated")).toBe(false);
  });
});

describe("letters and months", () => {
  it("renders placeholders and prints a dash for a missing value", () => {
    const body = renderLetterBody("Hello {{employee_name}} of {{ department }}", { employee_name: "Asha", department: "" });
    expect(body).toBe("Hello Asha of -");
  });
  it("rejects unknown placeholders", () => {
    expect(unknownPlaceholders("{{employee_name}} {{salary}}")).toEqual(["salary"]);
    expect(letterTemplateSchema.safeParse({ body: "Dear {{employee_name}}, your {{salary}} is fine.", title: "Letter" }).success).toBe(false);
    expect(letterTemplateSchema.safeParse({ body: DEFAULT_RELIEVING_LETTER_BODY }).success).toBe(true);
  });
  it("adds months across a year end", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});

describe("loan recovery on a pay line", () => {
  it("adds principal and interest deductions, lowers the net and posts to loans receivable and interest income", () => {
    const line = computePayrollLine({
      components: [{ code: "BASIC", name: "Basic", type: "earning", category: "basic", isWage: true, prorate: true, monthlyPaise: 3_000_000 }],
      daysInMonth: 30,
      employedDays: 30,
      paidDays: 30,
      lopDays: 0,
    });
    const plan = planLoanRecovery({
      netPaise: line.netPaise,
      maxSharePercent: 50,
      loans: [{ loanId: "l1", loanNumber: "LN-0001", installments: [{ installmentId: "i1", seq: 1, dueMonth: "2026-11", principalDuePaise: 788_488, interestDuePaise: 100_000 }] }],
    });
    const out = applyLoanRecoveryToLine(line, plan);
    expect(out.deductionsPaise).toBe(888_488);
    expect(out.netPaise).toBe(3_000_000 - 888_488);
    expect(out.components.filter((c) => c.source === "loan").map((c) => c.loanPart)).toEqual(["principal", "interest"]);
    const posting = buildPostingTotals([{ netPaise: out.netPaise, components: out.components }]);
    expect(posting).toMatchObject({ loanPrincipalPaise: 788_488, loanInterestPaise: 100_000, deductionsPayablePaise: 0 });
    const credits = posting.netPayablePaise + posting.loanPrincipalPaise + posting.loanInterestPaise + posting.deductionsPayablePaise + posting.employerPayablePaise;
    expect(credits).toBe(Object.values(posting.expense).reduce((a, b) => a + b, 0));
  });
  it("returns the line untouched when nothing is recovered", () => {
    const line = computePayrollLine({ components: [], daysInMonth: 30, employedDays: 30, paidDays: 30, lopDays: 0 });
    expect(applyLoanRecoveryToLine(line, planLoanRecovery({ netPaise: 0, maxSharePercent: 50, loans: [] }))).toBe(line);
  });
});
