import { describe, it, expect } from "vitest";
import { formatRole, roleLabels } from "../roles";

describe("formatRole", () => {
  it("returns human-readable labels for all known roles", () => {
    expect(formatRole("owner")).toBe("Owner");
    expect(formatRole("superadmin")).toBe("Super Admin");
    expect(formatRole("admin")).toBe("Admin");
    expect(formatRole("seller_manager")).toBe("Sales Manager");
    expect(formatRole("seller")).toBe("Seller");
    expect(formatRole("accountant")).toBe("Accountant (bookkeeping)");
    expect(formatRole("auditor")).toBe("Accountant (read-only)");
    expect(formatRole("ca_filing")).toBe("Accountant (filing)");
    expect(formatRole("member")).toBe("Member");
  });

  it("formats unknown roles with capitalization and underscore replacement", () => {
    expect(formatRole("custom_role")).toBe("Custom role");
    expect(formatRole("viewer")).toBe("Viewer");
  });

  it("roleLabels covers every role used in the CASL permissions system", () => {
    const expectedRoles = ["owner", "superadmin", "admin", "seller_manager", "seller", "accountant", "hr", "employee", "auditor", "ca_filing", "member"];
    for (const role of expectedRoles) {
      expect(roleLabels[role]).toBeDefined();
    }
  });
});
