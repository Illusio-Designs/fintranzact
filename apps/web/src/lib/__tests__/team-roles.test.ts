import { describe, it, expect } from "vitest";
import { canEditMemberRole, isCaManager, memberRoleOptions, STAFF_ROLE_OPTIONS } from "../team-roles";

describe("team roles", () => {
  it("normal role list has no CA roles", () => {
    expect(STAFF_ROLE_OPTIONS.map((o) => o.value)).toEqual(["admin", "seller_manager", "seller", "accountant", "hr"]);
  });
  it("only owner and superadmin manage CA access", () => {
    expect(isCaManager("owner")).toBe(true);
    expect(isCaManager("superadmin")).toBe(true);
    for (const r of ["admin", "seller", "accountant", "auditor", "ca_filing", undefined, null]) expect(isCaManager(r)).toBe(false);
  });
  it("member role options add the CA roles for the owner only", () => {
    expect(memberRoleOptions("owner").map((o) => o.value)).toEqual(["admin", "seller_manager", "seller", "accountant", "hr", "auditor", "ca_filing"]);
    expect(memberRoleOptions("admin").map((o) => o.value)).toEqual(["admin", "seller_manager", "seller", "accountant", "hr"]);
  });
  it("an employee login is managed in Payroll, not from the Team page", () => {
    expect(canEditMemberRole("owner", "employee")).toBe(false);
    expect(canEditMemberRole("admin", "employee")).toBe(false);
    expect(STAFF_ROLE_OPTIONS.some((o) => o.value === "employee")).toBe(false);
  });
  it("an admin cannot edit a CA member; nobody edits an owner", () => {
    expect(canEditMemberRole("admin", "auditor")).toBe(false);
    expect(canEditMemberRole("admin", "ca_filing")).toBe(false);
    expect(canEditMemberRole("admin", "seller")).toBe(true);
    expect(canEditMemberRole("owner", "ca_filing")).toBe(true);
    expect(canEditMemberRole("owner", "owner")).toBe(false);
    expect(canEditMemberRole("owner", "superadmin")).toBe(false);
  });
});
