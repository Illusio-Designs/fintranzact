import { describe, it, expect } from "vitest";
import { buildAttendanceRegister, buildEmploymentRegister, buildFnfRegister, buildWageRegister, csvCell } from "@fintranzact/shared";
import { generateRegisterPDF, parseCsvTable, REGISTER_PDF_LABEL, type PdfBusiness } from "../lib/payroll/phase4-pdf.js";
import { readPdf } from "./helpers/pdf-text.js";

const business: PdfBusiness = { name: "Phase Four Co", legalName: "Phase Four Co Pvt Ltd", address: "12 MG Road", city: "Pune", state: "Maharashtra", pincode: "411001", phone: null, email: null };
const NOW = "2026-06-20T05:00:00.000Z";

describe("parseCsvTable", () => {
  it("reads quotes, doubled quotes, commas, CRLF and newlines inside a cell, and strips the formula guard", () => {
    const text = ["A,B,C", `1,"x, y","say ""hi"""`, `${csvCell("-5.00")},${csvCell("=SUM(A1)")},"two\nlines"`].join("\r\n") + "\r\n";
    expect(parseCsvTable(text)).toEqual([
      ["A", "B", "C"],
      ["1", "x, y", 'say "hi"'],
      ["-5.00", "=SUM(A1)", "two\nlines"],
    ]);
    expect(parseCsvTable("")).toEqual([]);
    expect(parseCsvTable("a,b")).toEqual([["a", "b"]]);
  });
});

describe("generateRegisterPDF", () => {
  const employment = (n: number) =>
    buildEmploymentRegister(
      Array.from({ length: n }, (_, i) => ({
        employeeCode: `E${String(i + 1).padStart(4, "0")}`,
        name: `Employee Number ${i + 1}`,
        fatherOrSpouse: "",
        gender: i % 2 ? "female" : "male",
        dateOfBirth: "1990-01-15",
        designation: "Executive",
        department: "Operations",
        employmentType: "permanent",
        joinedOn: "2020-04-01",
        status: i % 7 === 0 ? "exited" : "active",
        lastWorkingDay: i % 7 === 0 ? "2026-03-31" : null,
        exitReason: i % 7 === 0 ? "resignation" : null,
      })) as never,
    );

  it("produces a landscape PDF that parses: header row, label, business, period and page numbers on every page, many pages for many rows", async () => {
    const [header = [], ...rows] = parseCsvTable(employment(300));
    expect(rows).toHaveLength(300);
    const started = Date.now();
    const buf = await generateRegisterPDF({ business, title: "Employment register", period: "all employees", header, rows, generatedAt: NOW });
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    const pdf = await readPdf(buf);
    expect(pdf.size[0]).toBeGreaterThan(pdf.size[1]); // landscape
    expect(pdf.pages).toBeGreaterThan(5);
    pdf.text.forEach((t, i) => {
      expect(t, `page ${i + 1}`).toContain("Phase Four Co Pvt Ltd");
      expect(t).toContain("Employment register");
      expect(t).toContain("Working copy for CA / legal review. Formats vary by state.");
      expect(t).toContain(`Page ${i + 1} of ${pdf.pages}`);
      expect(t, `header row repeated on page ${i + 1}`).toContain("Employee Code");
    });
    // Every row is somewhere in the document, in order.
    const all = pdf.text.join(" ");
    expect(all).toContain("E0001");
    expect(all).toContain("E0300");
    expect(all).toContain("Employee Number 150");
    expect(all.indexOf("E0001")).toBeLessThan(all.indexOf("E0300"));
  }, 60_000);

  it("a large register (3,000 rows) is paginated without blowing time or memory", async () => {
    const [header = [], ...rows] = parseCsvTable(employment(3000));
    const before = process.memoryUsage().heapUsed;
    const started = Date.now();
    const buf = await generateRegisterPDF({ business, title: "Employment register", period: "all employees", header, rows, generatedAt: NOW });
    const ms = Date.now() - started;
    expect(ms).toBeLessThan(30_000);
    expect(buf.length).toBeLessThan(15 * 1024 * 1024);
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(400 * 1024 * 1024);
    const pdf = await readPdf(buf);
    expect(pdf.pages).toBeGreaterThan(50);
    expect(pdf.text[pdf.pages - 1]).toContain(`Page ${pdf.pages} of ${pdf.pages}`);
  }, 120_000);

  it("a register wider than the page is printed in column groups that repeat the employee columns; every figure is whole", async () => {
    const days = Array.from({ length: 31 }, (_, i) => `2026-05-${String(i + 1).padStart(2, "0")}`);
    const csv = buildAttendanceRegister(
      "2026-05",
      days,
      Array.from({ length: 5 }, (_, i) => ({ employeeCode: `A${i + 1}`, name: `Person ${i + 1}`, byDate: Object.fromEntries(days.map((d) => [d, "present"])), paidDays: "31.0", lopDays: "0.0" })),
    );
    const [header = [], ...rows] = parseCsvTable(csv);
    expect(header).toHaveLength(36);
    const wageCsv = buildWageRegister(
      "2026-05",
      Array.from({ length: 4 }, (_, i) => ({
        employeeCode: `W${i + 1}`,
        name: `Worker ${i + 1}`,
        paidDays: "31",
        lopDays: "0",
        overtimeHours: "0",
        components: Array.from({ length: 14 }, (_, k) => ({ name: `Allowance number ${k + 1}`, type: "earning", amountPaise: 123456789 + k })),
        grossPaise: 987654321,
        deductionsPaise: 12345,
        netPaise: 987641976,
      })),
    );
    const wide = parseCsvTable(wageCsv);
    const att = await readPdf(await generateRegisterPDF({ business, title: "Attendance register", period: "May 2026", header, rows, generatedAt: NOW }));
    const wages = await readPdf(await generateRegisterPDF({ business, title: "Wages register", period: "May 2026", header: wide[0]!, rows: wide.slice(1), generatedAt: NOW }));
    expect(wages.pages).toBeGreaterThanOrEqual(2);
    expect(wages.text.join(" ")).toMatch(/Columns part 1 of \d/);
    // The employee columns are on every page of every group and the big amounts are printed whole (no "...").
    for (const t of wages.text) expect(t).toContain("Employee Code");
    expect(wages.text.join(" ")).toContain("1,234,567.89".replace(/,/g, "")); // csv amounts are plain, printed as is
    expect(wages.text.join(" ")).not.toMatch(/\d\.\.\./);
    // Attendance: 36 narrow columns, fits or splits, never cut.
    expect(att.text.join(" ")).toContain("Person 5");
  });

  it("a very long value is cut with an ellipsis and the page says so; an empty register still says so", async () => {
    const long = "x".repeat(400);
    const csv = buildFnfRegister([{ number: "FF-0001", employeeCode: "E1", name: long, lastWorkingDay: "2026-05-20", status: "posted", grossPaise: 100000, deductionsPaise: 0, netPaise: 100000, paidOn: null }]);
    const [header = [], ...rows] = parseCsvTable(csv);
    const pdf = await readPdf(await generateRegisterPDF({ business, title: "Full and final settlements register", period: "FY 2026-27", header, rows, generatedAt: NOW }));
    expect(pdf.pages).toBe(1);
    expect(pdf.text[0]).toContain("...");
    expect(pdf.text[0]).toContain("shortened");
    const none = await readPdf(await generateRegisterPDF({ business, title: "Full and final settlements register", period: "FY 2026-27", header, rows: [], generatedAt: NOW }));
    expect(none.text[0]).toContain("No entries for this period");
    expect(none.text[0]).toContain(REGISTER_PDF_LABEL);
  });

  it("a negative amount (a put-back recovery) is printed with its sign", async () => {
    const pdf = await readPdf(await generateRegisterPDF({ business, title: "Deductions and advances register", period: "FY 2026-27", header: ["Period", "Employee Code", "Employee Name", "Type", "Description", "Amount"], rows: [["2026-06-20", "E1", "Asha", "Advance / loan recovered", "Loan LN-0001 (fnf reversed)", "-25000.00"]], generatedAt: NOW }));
    expect(pdf.text[0]).toContain("-25000.00");
  });
});
