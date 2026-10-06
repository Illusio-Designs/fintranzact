import { describe, expect, it } from "vitest";
import { canAccess, ROLE_ABILITIES } from "@/lib/permissions";
import { formatRole } from "@/lib/roles";

// Regression: the invoices page offered "+ New Invoice" to every role, so an
// accountant (read-only on invoices) could fill in the whole form only for
// the API to refuse it. The page now asks canAccess("Invoice", "create").
describe("canAccess", () => {
  it("lets owners, admins and the sales roles create invoices", () => {
    for (const role of ["owner", "admin", "seller_manager", "seller"]) {
      expect(canAccess(role, "Invoice", "create"), role).toBe(true);
    }
  });

  it("keeps accountants read-only on invoices", () => {
    expect(canAccess("accountant", "Invoice", "read")).toBe(true);
    expect(canAccess("accountant", "Invoice", "create")).toBe(false);
  });

  it("hides the books from sellers", () => {
    expect(canAccess("seller", "Report", "read")).toBe(false);
    expect(canAccess("seller", "Expense", "read")).toBe(false);
    expect(canAccess("seller", "Party", "read")).toBe(true);
  });
});

describe("Payroll (add-on) permissions mirror the API", () => {
  it("owners and admins may do everything, including approving (manage)", () => {
    for (const role of ["owner", "admin"]) for (const a of ["read", "create", "update", "delete", "manage"]) expect(canAccess(role, "Payroll", a), `${role} ${a}`).toBe(true);
  });
  it("an accountant prepares payroll but cannot approve or delete", () => {
    for (const a of ["read", "create", "update"]) expect(canAccess("accountant", "Payroll", a), a).toBe(true);
    for (const a of ["delete", "manage"]) expect(canAccess("accountant", "Payroll", a), a).toBe(false);
  });
  it("no other role sees salary data", () => {
    for (const role of ["seller", "seller_manager", "auditor", "ca_filing"]) {
      for (const a of ["read", "create", "update", "delete", "manage"]) expect(canAccess(role, "Payroll", a), `${role} ${a}`).toBe(false);
    }
  });
});

describe("accountant access roles (auditor, ca_filing)", () => {
  const READS = [
    "Invoice", "Payment", "Party", "Item", "Expense", "BankAccount", "BankTransaction",
    "BankReconciliation", "Account", "Report", "GstReport", "ITC", "Tds", "EInvoice",
    "EWayBill", "Business", "Store", "RecurringInvoice",
  ];
  const WRITES = ["create", "update", "delete", "manage"];
  const RESOURCES = [...READS, "Team", "Import", "PeriodLock", "SalesTarget"];

  it("knows both roles (an unknown role would show everything)", () => {
    for (const role of ["auditor", "ca_filing"]) expect(ROLE_ABILITIES[role], role).toBeDefined();
  });

  it("auditor reads every book and can create or change nothing", () => {
    for (const r of READS) expect(canAccess("auditor", r, "read"), r).toBe(true);
    for (const r of RESOURCES) for (const a of WRITES) expect(canAccess("auditor", r, a), `${a} ${r}`).toBe(false);
    expect(canAccess("auditor", "Team", "read")).toBe(false);
  });

  it("ca_filing is the same plus creating GST returns, and nothing else", () => {
    for (const r of READS) expect(canAccess("ca_filing", r, "read"), r).toBe(true);
    for (const r of RESOURCES) {
      for (const a of WRITES) expect(canAccess("ca_filing", r, a), `${a} ${r}`).toBe(a === "create" && r === "GstReport");
    }
  });

  it("labels the three accountant roles distinctly", () => {
    expect(formatRole("accountant")).toBe("Accountant (bookkeeping)");
    expect(formatRole("auditor")).toBe("Accountant (read-only)");
    expect(formatRole("ca_filing")).toBe("Accountant (filing)");
  });
});
