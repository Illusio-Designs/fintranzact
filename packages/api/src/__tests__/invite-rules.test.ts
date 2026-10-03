import { describe, it, expect } from "vitest";
import { MAX_CA_MEMBERS_PER_ORG } from "@fintranzact/shared";
import {
  CA_CAP_MESSAGE, CA_INVITE_OWNER_ONLY_MESSAGE, CA_ROLE_OWNER_ONLY_MESSAGE,
  checkInviteRules, checkRoleChangeRules, countsTowardTeamLimit, normalizeInviteEmail,
} from "../lib/invite-rules.js";

const STAFF = ["admin", "seller_manager", "seller", "accountant"];
const CA = ["auditor", "ca_filing"];
const none = { memberCaCount: 0, pendingCaCount: 0 };

describe("countsTowardTeamLimit", () => {
  it("excludes only the CA roles", () => {
    for (const r of STAFF) expect(countsTowardTeamLimit(r), r).toBe(true);
    for (const r of CA) expect(countsTowardTeamLimit(r), r).toBe(false);
  });
});

describe("normalizeInviteEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeInviteEmail("  Anita.Shah@Firm.IN ")).toBe("anita.shah@firm.in");
  });
});

describe("checkInviteRules", () => {
  it("lets owner, superadmin and admin invite staff roles", () => {
    for (const inviter of ["owner", "superadmin", "admin"]) {
      for (const target of STAFF) {
        expect(checkInviteRules({ inviterRole: inviter, targetRole: target, ...none }), `${inviter}->${target}`).toEqual({ ok: true });
      }
    }
  });

  it("refuses everyone else, whatever the target", () => {
    for (const inviter of ["seller", "seller_manager", "accountant", "auditor", "ca_filing", null, undefined]) {
      for (const target of [...STAFF, ...CA]) {
        const r = checkInviteRules({ inviterRole: inviter, targetRole: target, ...none });
        expect(r.ok, `${inviter}->${target}`).toBe(false);
      }
    }
  });

  it("lets owner and superadmin invite CA roles, refuses admin", () => {
    for (const target of CA) {
      expect(checkInviteRules({ inviterRole: "owner", targetRole: target, ...none })).toEqual({ ok: true });
      expect(checkInviteRules({ inviterRole: "superadmin", targetRole: target, ...none })).toEqual({ ok: true });
      expect(checkInviteRules({ inviterRole: "admin", targetRole: target, ...none })).toEqual({
        ok: false, code: "FORBIDDEN", message: CA_INVITE_OWNER_ONLY_MESSAGE,
      });
    }
  });

  it("caps CA members plus pending CA invites at MAX_CA_MEMBERS_PER_ORG", () => {
    expect(MAX_CA_MEMBERS_PER_ORG).toBe(3);
    const ok = (m: number, p: number) => checkInviteRules({ inviterRole: "owner", targetRole: "auditor", memberCaCount: m, pendingCaCount: p }).ok;
    expect(ok(0, 0)).toBe(true);
    expect(ok(1, 1)).toBe(true);
    expect(ok(2, 0)).toBe(true);
    expect(ok(3, 0)).toBe(false);
    expect(ok(0, 3)).toBe(false);
    expect(ok(2, 1)).toBe(false);
    expect(checkInviteRules({ inviterRole: "owner", targetRole: "ca_filing", memberCaCount: 3, pendingCaCount: 0 })).toEqual({
      ok: false, code: "CONFLICT", message: CA_CAP_MESSAGE,
    });
  });

  it("does not apply the CA cap to staff invites", () => {
    expect(checkInviteRules({ inviterRole: "owner", targetRole: "seller", memberCaCount: 3, pendingCaCount: 3 })).toEqual({ ok: true });
  });
});

describe("checkRoleChangeRules", () => {
  const change = (actorRole: string | null, currentRole: string | null, newRole: string, m = 0, p = 0) =>
    checkRoleChangeRules({ actorRole, currentRole, newRole, memberCaCount: m, pendingCaCount: p });

  it("admin may change staff roles but not to or from a CA role", () => {
    expect(change("admin", "seller", "seller_manager")).toEqual({ ok: true });
    for (const ca of CA) {
      expect(change("admin", "seller", ca)).toEqual({ ok: false, code: "FORBIDDEN", message: CA_ROLE_OWNER_ONLY_MESSAGE });
      expect(change("admin", ca, "seller")).toEqual({ ok: false, code: "FORBIDDEN", message: CA_ROLE_OWNER_ONLY_MESSAGE });
      expect(change("admin", ca, ca === "auditor" ? "ca_filing" : "auditor").ok).toBe(false);
    }
  });

  it("owner and superadmin may move members to and from CA roles", () => {
    for (const actor of ["owner", "superadmin"]) {
      expect(change(actor, "seller", "auditor")).toEqual({ ok: true });
      expect(change(actor, "ca_filing", "accountant")).toEqual({ ok: true });
    }
  });

  it("caps a new CA but lets a CA switch level at the cap", () => {
    expect(change("owner", "seller", "auditor", 3, 0).ok).toBe(false);
    expect(change("owner", "seller", "ca_filing", 2, 1).ok).toBe(false);
    expect(change("owner", "seller", "ca_filing", 2, 0).ok).toBe(true);
    expect(change("owner", "auditor", "ca_filing", 3, 0)).toEqual({ ok: true });
    expect(change("owner", "ca_filing", "seller", 3, 0)).toEqual({ ok: true });
  });

  it("refuses non-admins", () => {
    for (const actor of ["seller", "accountant", "auditor", "ca_filing", null]) expect(change(actor, "seller", "admin").ok).toBe(false);
  });
});
