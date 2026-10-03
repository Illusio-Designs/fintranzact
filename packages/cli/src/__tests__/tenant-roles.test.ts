import { describe, it, expect } from "vitest";
import { CA_ROLES, ROLE_HELP, VALID_ROLES, inviteLinkOf, inviteSuccessLine, isCaRole } from "../commands/tenant/roles.js";

describe("tenant invite roles", () => {
  it("accepts staff and CA roles", () => {
    expect([...VALID_ROLES]).toEqual(["admin", "seller_manager", "seller", "accountant", "auditor", "ca_filing"]);
    expect([...CA_ROLES]).toEqual(["auditor", "ca_filing"]);
    expect(isCaRole("auditor")).toBe(true);
    expect(isCaRole("ca_filing")).toBe(true);
    expect(isCaRole("accountant")).toBe(false);
  });

  it("help explains the CA roles, owner-only, the cap and the plan limit", () => {
    for (const needle of ["auditor", "ca_filing", "Only the organisation owner", "at most 3", "team-member limit", "logged"]) {
      expect(ROLE_HELP).toContain(needle);
    }
  });

  it("success line names the access level for a CA and stays plain for staff", () => {
    expect(inviteSuccessLine("ca@firm.in", "auditor")).toContain("read-only");
    expect(inviteSuccessLine("ca@firm.in", "ca_filing")).toContain("filing");
    expect(inviteSuccessLine("a@b.in", "seller")).toBe("Invited a@b.in as seller");
  });

  it("reads the invite link from the API's inviteUrl", () => {
    expect(inviteLinkOf({ inviteUrl: "https://x/invite/t", token: "t" })).toBe("https://x/invite/t");
    expect(inviteLinkOf({ token: "t" })).toBeUndefined();
  });
});
