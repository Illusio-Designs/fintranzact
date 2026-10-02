import { STAFF_INVITE_ROLES, CA_INVITE_CHOICES, canChangeMemberRole, canManageCa, changeRoleOptions, roleLabel } from "../team-roles";

describe("mobile team roles", () => {
  it("the normal invite list has no CA roles", () => {
    expect(STAFF_INVITE_ROLES.map((r) => r.key)).toEqual(["admin", "seller_manager", "seller", "accountant"]);
  });
  it("Invite my CA offers view only and view-and-file with the shared descriptions", () => {
    expect(CA_INVITE_CHOICES.map((c) => [c.key, c.title])).toEqual([["auditor", "View only"], ["ca_filing", "View and file returns"]]);
    expect(CA_INVITE_CHOICES[0].description).toBe("Can view everything and download reports. Cannot change anything.");
  });
  it("only the owner manages CA access", () => {
    expect(canManageCa("owner")).toBe(true);
    expect(canManageCa("superadmin")).toBe(true);
    expect(canManageCa("admin")).toBe(false);
    expect(canManageCa(undefined)).toBe(false);
  });
  it("change-role sheet shows CA roles to the owner only", () => {
    expect(changeRoleOptions("owner").map((r) => r.key)).toEqual(["admin", "seller_manager", "seller", "accountant", "auditor", "ca_filing"]);
    expect(changeRoleOptions("admin").map((r) => r.key)).toEqual(["admin", "seller_manager", "seller", "accountant"]);
  });
  it("an admin cannot change a CA member's role", () => {
    expect(canChangeMemberRole("admin", "auditor")).toBe(false);
    expect(canChangeMemberRole("admin", "seller")).toBe(true);
    expect(canChangeMemberRole("owner", "ca_filing")).toBe(true);
    expect(canChangeMemberRole("owner", "owner")).toBe(false);
  });
  it("labels", () => {
    expect(roleLabel("auditor")).toBe("Accountant (read-only)");
    expect(roleLabel("ca_filing")).toBe("Accountant (filing)");
  });
});
