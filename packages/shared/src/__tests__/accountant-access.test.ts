import { describe, it, expect } from "vitest";
import {
  CA_ACCESS_CHOICES, CA_ROLES, CA_ROLE_DESCRIPTIONS, CA_ROLE_LABELS, MAX_CA_MEMBERS_PER_ORG, caRoleDescription, isCaRole, memberRoleLabel,
} from "../accountant-access.js";

describe("accountant access", () => {
  it("isCaRole is true for auditor and ca_filing only", () => {
    expect(isCaRole("auditor")).toBe(true);
    expect(isCaRole("ca_filing")).toBe(true);
    for (const r of ["accountant", "admin", "owner", "superadmin", "seller", "viewer", "", null, undefined]) {
      expect(isCaRole(r as string)).toBe(false);
    }
  });

  it("describes both roles in plain language", () => {
    expect(CA_ROLE_DESCRIPTIONS.auditor).toBe("Can view everything and download reports. Cannot change anything.");
    expect(CA_ROLE_DESCRIPTIONS.ca_filing).toContain("file GST returns");
    expect(CA_ROLE_DESCRIPTIONS.ca_filing).toContain("Cannot create or edit sales, purchases, payments or other records.");
    expect(caRoleDescription("auditor")).toBe(CA_ROLE_DESCRIPTIONS.auditor);
    expect(caRoleDescription("seller")).toBeNull();
  });

  it("has a label and a choice for every CA role", () => {
    expect(CA_ROLES.map((r) => CA_ROLE_LABELS[r])).toEqual(["Accountant (read-only)", "Accountant (filing)"]);
    expect(CA_ACCESS_CHOICES.map((c) => c.role)).toEqual([...CA_ROLES]);
    expect(CA_ACCESS_CHOICES.map((c) => c.title)).toEqual(["View only", "View and file returns"]);
  });

  it("caps CA members per organisation at 3", () => {
    expect(MAX_CA_MEMBERS_PER_ORG).toBe(3);
  });

  it("labels every member role", () => {
    expect(memberRoleLabel("auditor")).toBe("Accountant (read-only)");
    expect(memberRoleLabel("ca_filing")).toBe("Accountant (filing)");
    expect(memberRoleLabel("accountant")).toBe("Accountant (bookkeeping)");
    expect(memberRoleLabel("seller_manager")).toBe("Sales Manager");
    expect(memberRoleLabel("weird_role")).toBe("Weird role");
  });
});
