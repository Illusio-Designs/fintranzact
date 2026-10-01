import { describe, expect, it } from "vitest";
import { canAccess } from "@/lib/permissions";

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
