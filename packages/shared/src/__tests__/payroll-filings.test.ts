import { describe, it, expect } from "vitest";
import {
  build24q, buildAttendanceRegister, buildBonusRegister, buildEcr, buildEsicCsv, buildForm16Data, buildGratuityRegister, buildStateSheets, buildWageRegister,
  computeBonusBasis, computeGratuity, ddmmyyyy, ecrName, form16Csv, serviceBetween, ECR_COLUMNS, ESIC_COLUMNS, FORM16_LABEL,
} from "../payroll-filings.js";
import { defaultStatutoryRates, EMPTY_DECLARATION } from "../payroll-statutory.js";
import { rupeesToPaise } from "../payroll-calc.js";

const R = (n: number) => rupeesToPaise(n);
const rates = defaultStatutoryRates();

describe("PF ECR file", () => {
  const member = {
    uan: "100200300400", name: "Asha  Verma", employeeCode: "E1", grossWagesPaise: R(28000), epfWagesPaise: R(15000), epsWagesPaise: R(15000), edliWagesPaise: R(15000),
    epfEmployeePaise: R(1800), epsPaise: R(1250), epfDiffPaise: R(550), lopDays: 0,
  };
  it("writes one #~# separated line per member in the ECR 2.0 column order, in whole rupees", () => {
    const e = buildEcr([member]);
    expect(e.text).toBe("100200300400#~#ASHA VERMA#~#28000#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#0#~#0\n");
    expect(e.count).toBe(1);
    expect(e.totals).toEqual({ epfEe: 1800, eps: 1250, epfEr: 550 });
    expect(ECR_COLUMNS).toHaveLength(11);
    expect(e.text.trim().split("#~#")).toHaveLength(ECR_COLUMNS.length);
  });
  it("a member without EPS has zero pension wages and contribution, the whole 12% in the EPF difference", () => {
    const e = buildEcr([{ ...member, epsWagesPaise: 0, epsPaise: 0, epfDiffPaise: R(1800) }]);
    expect(e.text).toContain("#~#0#~#15000#~#1800#~#0#~#1800#~#");
  });
  it("leaves out a member with no UAN (reported) and one with no contribution", () => {
    const e = buildEcr([{ ...member, uan: null }, { ...member, employeeCode: "E2", epfEmployeePaise: 0, epsPaise: 0, epfDiffPaise: 0 }]);
    expect(e.count).toBe(0);
    expect(e.skipped).toEqual([{ employeeCode: "E1", reason: "No UAN" }]);
    expect(e.text).toBe("");
  });
  it("counts half days of loss of pay as a whole non-contributory day and cleans names", () => {
    expect(buildEcr([{ ...member, lopDays: 2.5 }]).text.trim().split("#~#")[9]).toBe("3");
    expect(ecrName("a#~#b\nc")).toBe("A B C");
  });
});

describe("ESIC contribution file", () => {
  it("has the six bulk-upload columns and a row per covered employee with an IP number", () => {
    const f = buildEsicCsv([
      { ipNumber: "1234567890", name: "Asha Verma", employeeCode: "E1", paidDays: 28, wagesPaise: R(18000), lastWorkingDay: null },
      { ipNumber: null, name: "Ravi", employeeCode: "E2", paidDays: 30, wagesPaise: R(15000), lastWorkingDay: null },
      { ipNumber: "9876543210", name: "Meena", employeeCode: "E3", paidDays: 10, wagesPaise: 1234550, lastWorkingDay: "2026-10-10" },
    ]);
    const lines = f.csv.trim().split("\r\n");
    expect(lines[0]!.split(",")).toHaveLength(ESIC_COLUMNS.length);
    expect(lines[1]).toBe("1234567890,Asha Verma,28,18000,0,");
    expect(lines[2]).toBe("9876543210,Meena,10,12345.50,0,10/10/2026");
    expect(f.skipped).toEqual([{ employeeCode: "E2", reason: "No ESIC insurance (IP) number" }]);
  });
});

describe("PT and LWF sheets", () => {
  const rows = [
    { state: "27", employeeCode: "E1", name: "A", grossPaise: R(30000), employeePaise: R(200), employerPaise: 0 },
    { state: "27", employeeCode: "E2", name: "B", grossPaise: R(9000), employeePaise: R(175), employerPaise: 0 },
    { state: "29", employeeCode: "E3", name: "C", grossPaise: R(9000), employeePaise: 0, employerPaise: 0 },
  ];
  it("one sheet per state with a total row; states with nothing are left out", () => {
    const s = buildStateSheets("pt", "2026-10", rows);
    expect(s.map((x) => x.state)).toEqual(["27"]);
    expect(s[0]!.count).toBe(2);
    expect(s[0]!.totalEmployeePaise).toBe(R(375));
    expect(s[0]!.csv.trim().split("\r\n").pop()).toBe("27,2026-10,,Total,39000.00,375.00");
  });
  it("LWF carries both shares", () => {
    const s = buildStateSheets("lwf", "2026-12", [{ state: "27", employeeCode: "E1", name: "A", grossPaise: R(30000), employeePaise: R(12), employerPaise: R(36) }]);
    expect(s[0]!.csv).toContain("Employer Contribution");
    expect(s[0]!.csv.trim().split("\r\n").pop()).toBe("27,2026-12,,Total,30000.00,12.00,36.00");
  });
});

describe("Form 24Q working data", () => {
  it("deductee rows, challans and totals; neutralises formula text", () => {
    const q = build24q({
      fyStartYear: 2026,
      quarter: 3,
      tan: "MUMA12345B",
      deductees: [{ employeeCode: "E1", name: "=Asha", pan: null, months: [{ month: "2026-10", grossPaise: R(110000), tdsPaise: R(3900), deductedOn: "2026-10-31" }, { month: "2026-11", grossPaise: 0, tdsPaise: 0, deductedOn: "2026-11-30" }] }],
      challans: [{ month: "2026-10", amountPaise: R(3900), challanNumber: "00123", challanDate: "2026-11-05", paidOn: "2026-11-05" }],
    });
    expect(q.rows).toBe(1);
    expect(q.totalTdsPaise).toBe(R(3900));
    expect(q.totalChallanPaise).toBe(R(3900));
    expect(q.deducteeCsv).toContain("PANNOTAVBL");
    expect(q.deducteeCsv).toContain("'=Asha");
    expect(q.deducteeCsv).toContain("Q3 FY 2026-27");
    expect(q.challanCsv).toContain("05/11/2026");
  });
});

describe("Form 16 working copy", () => {
  const NEW = { ...rates.tds.newRegime, slabs: [
    { fromRupees: 0, toRupees: 400000, ratePercent: 0 }, { fromRupees: 400000, toRupees: 800000, ratePercent: 5 }, { fromRupees: 800000, toRupees: 1200000, ratePercent: 10 },
    { fromRupees: 1200000, toRupees: 1600000, ratePercent: 15 }, { fromRupees: 1600000, toRupees: null, ratePercent: 20 },
  ], rebateThresholdRupees: 1200000, rebateMaxRupees: 60000, marginalRelief: true };
  const r2 = { ...rates, tds: { ...rates.tds, newRegime: NEW } };
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${i < 9 ? 2026 : 2027}-${String(((3 + i) % 12) + 1).padStart(2, "0")}`, grossPaise: R(110000), tdsPaise: R(3900), professionalTaxPaise: R(200), pfEmployeePaise: R(1800) }));
  it("recomputes the year's tax on the actual income and compares it with the tax deducted", () => {
    const d = buildForm16Data({ fyStartYear: 2026, regime: "new", employee: { code: "E1", name: "Asha", pan: "ABCDE1234F" }, months, declaration: EMPTY_DECLARATION, rates: r2 });
    expect(d.grossSalaryPaise).toBe(R(1320000));
    expect(d.standardDeductionPaise).toBe(R(75000));
    expect(d.taxableIncomePaise).toBe(R(1245000));
    expect(d.tax.totalPaise).toBe(R(46800));
    expect(d.tdsDeductedPaise).toBe(R(46800));
    expect(d.differencePaise).toBe(0);
    expect(d.quarters.map((q) => q.tdsPaise)).toEqual([R(11700), R(11700), R(11700), R(11700)]);
    expect(d.professionalTaxPaise).toBe(0); // not deductible under the new regime
    expect(d.label).toBe(FORM16_LABEL);
    expect(form16Csv(d)).toContain("Working copy for CA review");
  });
  it("old regime deducts the declared amounts, within limits, and PT", () => {
    const d = buildForm16Data({
      fyStartYear: 2026, regime: "old", employee: { code: "E1", name: "Asha", pan: null }, months,
      declaration: { ...EMPTY_DECLARATION, sec80C: 200000 }, rates: { ...r2, tds: { ...r2.tds, oldRegime: { ...rates.tds.oldRegime, slabs: [{ fromRupees: 0, toRupees: null, ratePercent: 10 }] } } },
    });
    expect(d.declaredDeductions.find((x) => x.label === "Section 80C")!.paise).toBe(R(150000));
    expect(d.professionalTaxPaise).toBe(R(2400));
  });
  it("short deduction shows as a positive difference", () => {
    const d = buildForm16Data({ fyStartYear: 2026, regime: "new", employee: { code: "E1", name: "A", pan: null }, months: months.map((m) => ({ ...m, tdsPaise: 0 })), declaration: EMPTY_DECLARATION, rates: r2 });
    expect(d.differencePaise).toBe(R(46800));
  });
});

describe("registers", () => {
  it("wage register: a column per earning and deduction", () => {
    const csv = buildWageRegister("2026-10", [
      { employeeCode: "E1", name: "A", paidDays: "31.0", lopDays: "0.0", overtimeHours: "0.00", components: [{ name: "Basic", type: "earning", amountPaise: R(20000) }, { name: "Provident fund (employee)", type: "deduction", amountPaise: R(1800) }], grossPaise: R(20000), deductionsPaise: R(1800), netPaise: R(18200) },
      { employeeCode: "E2", name: "B", paidDays: "31.0", lopDays: "0.0", overtimeHours: "0.00", components: [{ name: "Basic", type: "earning", amountPaise: R(10000) }], grossPaise: R(10000), deductionsPaise: 0, netPaise: R(10000) },
    ]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("Provident fund (employee)");
    expect(lines[2]).toContain("0.00,10000.00,10000.00");
  });
  it("attendance register: one column per day with codes", () => {
    const csv = buildAttendanceRegister("2026-10", ["2026-10-01", "2026-10-02"], [{ employeeCode: "E1", name: "A", byDate: { "2026-10-01": "present", "2026-10-02": "half_day" }, paidDays: "1.5", lopDays: "0.5" }]);
    expect(csv.trim().split("\r\n")[1]).toBe("2026-10,E1,A,P,HD,1.5,0.5");
  });
});

describe("gratuity (computed register, not a payment)", () => {
  const rules = rates.gratuity;
  it("service between dates, inclusive", () => {
    expect(serviceBetween("2020-01-15", "2025-01-14")).toEqual({ months: 60, days: 0 });
    expect(serviceBetween("2020-01-15", "2025-01-13")).toEqual({ months: 59, days: 30 });
    expect(serviceBetween("2026-10-01", "2026-10-31")).toEqual({ months: 1, days: 0 });
  });
  it("not eligible before the minimum years", () => {
    expect(computeGratuity({ joinedOn: "2022-04-01", asOf: "2026-10-07", lastDrawnWagesPaise: R(30000), rules })).toMatchObject({ completedYears: 4, eligible: false, amountPaise: 0 });
  });
  it("eligible at exactly five years: 15/26 of last wages per year", () => {
    const g = computeGratuity({ joinedOn: "2021-10-08", asOf: "2026-10-07", lastDrawnWagesPaise: R(26000), rules });
    expect(g).toMatchObject({ completedYears: 5, yearsForFormula: 5, eligible: true, amountPaise: R(26000 * 15 * 5 / 26) });
  });
  it("more than six months of a part year counts as a full year; exactly six does not", () => {
    expect(computeGratuity({ joinedOn: "2019-04-01", asOf: "2026-10-31", lastDrawnWagesPaise: R(26000), rules }).yearsForFormula).toBe(8); // 7 years 7 months
    expect(computeGratuity({ joinedOn: "2019-04-01", asOf: "2026-09-30", lastDrawnWagesPaise: R(26000), rules }).yearsForFormula).toBe(7); // 7 years 6 months exactly
    expect(computeGratuity({ joinedOn: "2019-04-01", asOf: "2026-10-01", lastDrawnWagesPaise: R(26000), rules }).yearsForFormula).toBe(8); // 7y 6m 1d
  });
  it("applies the cap", () => {
    const g = computeGratuity({ joinedOn: "1990-04-01", asOf: "2026-10-07", lastDrawnWagesPaise: R(500000), rules });
    expect(g.capped).toBe(true);
    expect(g.amountPaise).toBe(R(2000000));
  });
  it("register rows", () => {
    const result = computeGratuity({ joinedOn: "2020-01-01", asOf: "2026-10-07", lastDrawnWagesPaise: R(26000), rules });
    expect(buildGratuityRegister("2026-10-07", [{ employeeCode: "E1", name: "A", joinedOn: "2020-01-01", lastDrawnWagesPaise: R(26000), result }])).toContain("07/10/2026");
  });
});

describe("bonus register basis", () => {
  it("with no ceiling and no percentage configured it shows the wages and no bonus", () => {
    const b = computeBonusBasis([R(10000), R(10000)], rates.bonus);
    expect(b).toEqual({ wagesPaise: R(20000), cappedWagesPaise: R(20000), bonusPaise: null });
    expect(buildBonusRegister(2026, [{ employeeCode: "E1", name: "A", monthsWorked: 2, basis: b }])).toContain("Bonus percentage not configured");
  });
  it("caps each month's wages at the configured ceiling and applies the percentage", () => {
    const b = computeBonusBasis([R(10000), R(5000)], { wageCeilingRupees: 7000, percent: 8.33 });
    expect(b.cappedWagesPaise).toBe(R(12000));
    expect(b.bonusPaise).toBe(R(999.6));
  });
});

describe("misc", () => {
  it("formats a date for the portals", () => {
    expect(ddmmyyyy("2026-10-07")).toBe("07/10/2026");
    expect(ddmmyyyy(null)).toBe("");
  });
});
