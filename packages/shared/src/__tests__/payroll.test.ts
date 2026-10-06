import { describe, it, expect } from "vitest";
import {
  attendanceBulkMarkSchema, buildBankPaymentCsv, csvCell, employeeFieldsSchema, holidaySchema, leaveApplySchema, maskSensitive,
  payslipNumber, salaryComponentSchema, salaryTemplateSchema, markPaidSchema,
} from "../payroll.js";

const UUID = "11111111-1111-4111-8111-111111111111";

const baseEmployee = { employeeCode: "E001", name: "Asha Verma", dateOfJoining: "2026-04-01" };

describe("employee fields", () => {
  it("accepts the minimum and applies defaults", () => {
    const r = employeeFieldsSchema.parse(baseEmployee);
    expect(r.employmentType).toBe("permanent");
    expect(r.taxRegime).toBe("new");
  });

  it("normalises and checks PAN, IFSC, Aadhaar, UAN, ESIC and bank account", () => {
    const r = employeeFieldsSchema.parse({
      ...baseEmployee,
      pan: " abcde1234f ",
      aadhaar: "1234 5678 9012",
      uan: "1000-2000-3000",
      esicNumber: "1234567890",
      bankAccountNumber: "0012 3456 7890",
      bankIfsc: "hdfc0001234",
      phone: "+91 98765 43210",
    });
    expect(r.pan).toBe("ABCDE1234F");
    expect(r.aadhaar).toBe("123456789012");
    expect(r.uan).toBe("100020003000");
    expect(r.bankAccountNumber).toBe("001234567890");
    expect(r.bankIfsc).toBe("HDFC0001234");
    expect(r.phone).toBe("9876543210");
  });

  it("refuses bad identity numbers with a readable message", () => {
    const bad = (extra: Record<string, unknown>) => employeeFieldsSchema.safeParse({ ...baseEmployee, ...extra });
    expect(bad({ pan: "ABCDE12345" }).success).toBe(false);
    expect(bad({ pan: "ABCD1234F" }).success).toBe(false);
    expect(bad({ aadhaar: "12345678901" }).success).toBe(false);
    expect(bad({ uan: "1234" }).success).toBe(false);
    expect(bad({ esicNumber: "12" }).success).toBe(false);
    expect(bad({ bankIfsc: "HDFC1001234" }).success).toBe(false); // the 5th character must be 0
    expect(bad({ bankAccountNumber: "12345" }).success).toBe(false);
    expect(bad({ phone: "12345" }).success).toBe(false);
    expect(bad({ email: "nope" }).success).toBe(false);
    expect(bad({ dateOfJoining: "2026-02-30" }).success).toBe(false);
    expect(bad({ workState: "99" }).success).toBe(false);
    expect(bad({ photoDataUrl: "http://x/y.png" }).success).toBe(false);
    const r = bad({ pan: "bad" });
    expect(r.success === false && r.error.issues[0]!.message).toBe("PAN must look like AAAAA9999A.");
  });

  it("allows blank optional fields (an empty form input)", () => {
    const r = employeeFieldsSchema.safeParse({ ...baseEmployee, pan: "", aadhaar: "", uan: "", bankIfsc: "", phone: "", email: "", photoDataUrl: "" });
    expect(r.success).toBe(true);
  });

  it("accepts a small PNG photo", () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    expect(employeeFieldsSchema.safeParse({ ...baseEmployee, photoDataUrl: png }).success).toBe(true);
  });
});

describe("masking", () => {
  it("shows only the last four characters", () => {
    expect(maskSensitive("123456789012")).toBe("XXXXXXXX9012");
    expect(maskSensitive("ABCDE1234F")).toBe("XXXXXX234F");
    expect(maskSensitive("1234")).toBe("XXXX");
    expect(maskSensitive("")).toBeNull();
    expect(maskSensitive(null)).toBeNull();
  });
});

describe("salary component and template schemas", () => {
  it("only lets a category sit under its own type", () => {
    expect(salaryComponentSchema.safeParse({ code: "bonus", name: "Bonus", type: "earning", category: "bonus" }).success).toBe(true);
    expect(salaryComponentSchema.safeParse({ code: "x", name: "X", type: "deduction", category: "bonus" }).success).toBe(false);
  });
  it("upper-cases the code and keeps the statutory kind empty in Phase 1", () => {
    const r = salaryComponentSchema.parse({ code: "hra", name: "HRA", type: "earning", category: "hra" });
    expect(r.code).toBe("HRA");
    expect(r.statutoryKind ?? null).toBeNull();
    expect(salaryComponentSchema.safeParse({ code: "PF", name: "PF", type: "deduction", category: "other_deduction", statutoryKind: "pf_employee" }).success).toBe(false);
  });
  it("needs at least one line in a template", () => {
    expect(salaryTemplateSchema.safeParse({ name: "Staff", lines: [] }).success).toBe(false);
    expect(salaryTemplateSchema.safeParse({ name: "Staff", lines: [{ componentId: UUID, calcType: "balance" }] }).success).toBe(true);
  });
});

describe("attendance, holidays, leave", () => {
  it("bulk marking is limited to a month of dates", () => {
    const ok = { employeeIds: [UUID], dates: ["2026-10-05"], status: "present" };
    expect(attendanceBulkMarkSchema.safeParse(ok).success).toBe(true);
    expect(attendanceBulkMarkSchema.safeParse({ ...ok, dates: [] }).success).toBe(false);
    expect(attendanceBulkMarkSchema.safeParse({ ...ok, status: "leave" }).success).toBe(false);
  });
  it("a state holiday needs a state and a branch holiday needs a branch", () => {
    expect(holidaySchema.safeParse({ date: "2026-10-02", name: "Gandhi Jayanti" }).success).toBe(true);
    expect(holidaySchema.safeParse({ date: "2026-10-02", name: "Local", scope: "state" }).success).toBe(false);
    expect(holidaySchema.safeParse({ date: "2026-10-02", name: "Local", scope: "state", stateCode: "27" }).success).toBe(true);
    expect(holidaySchema.safeParse({ date: "2026-10-02", name: "Local", scope: "branch" }).success).toBe(false);
  });
  it("a leave application cannot end before it starts", () => {
    const ok = { employeeId: UUID, leaveTypeId: UUID, fromDate: "2026-10-05", toDate: "2026-10-06" };
    expect(leaveApplySchema.safeParse(ok).success).toBe(true);
    expect(leaveApplySchema.safeParse({ ...ok, toDate: "2026-10-04" }).success).toBe(false);
  });
  it("marking paid needs an account and a date", () => {
    expect(markPaidSchema.safeParse({ runId: UUID, bankAccountId: UUID, paidOn: "2026-11-01" }).success).toBe(true);
    expect(markPaidSchema.safeParse({ runId: UUID, paidOn: "2026-11-01" }).success).toBe(false);
  });
});

describe("bank payment file", () => {
  const row = (over: Partial<Parameters<typeof buildBankPaymentCsv>[0][number]> = {}) => ({
    employeeCode: "E001", beneficiaryName: "Asha Verma", accountNumber: "001234567890", ifsc: "HDFC0001234", amountPaise: 45_000_50, narration: "Salary Oct 2026", ...over,
  });

  it("writes one row per employee with the amount in rupees", () => {
    const r = buildBankPaymentCsv([row(), row({ employeeCode: "E002", amountPaise: 250_000_00 })]);
    const lines = r.csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Sr No,Employee Code,Beneficiary Name,Account Number,IFSC,Amount (INR),Payment Mode,Narration");
    expect(lines[1]).toBe("1,E001,Asha Verma,001234567890,HDFC0001234,45000.50,NEFT,Salary Oct 2026");
    expect(lines[2]).toContain(",2500" + "00.00,RTGS,");
    expect(r.count).toBe(2);
    expect(r.totalPaise).toBe(45_000_50 + 250_000_00);
  });

  it("skips zero pay and lists employees with no bank details", () => {
    const r = buildBankPaymentCsv([row({ amountPaise: 0 }), row({ employeeCode: "E009", accountNumber: "" })]);
    expect(r.count).toBe(0);
    expect(r.skipped).toEqual(["E009"]);
  });

  it("quotes commas and quotes, and defuses spreadsheet formulas", () => {
    expect(csvCell('Verma, "Asha"')).toBe('"Verma, ""Asha"""');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+91 98765")).toBe("'+91 98765");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell(12)).toBe("12");
  });
});

describe("payslip number", () => {
  it("is the month and the employee code", () => {
    expect(payslipNumber("2026-10", "e-001")).toBe("PS-2026-10-E001");
  });
});
