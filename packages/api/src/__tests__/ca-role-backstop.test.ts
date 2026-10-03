/**
 * The mutation backstop for the accountant access roles (auditor, ca_filing):
 *  - caRoleMutationAllowed is a pure decision, tested exhaustively;
 *  - typo guard: every allowlisted path is a real mutation of the real router;
 *  - canMarkGstFiled lets ca_filing mark a return filed without PeriodLock.
 * No database needed: it only enumerates procedure definitions.
 */
import { describe, it, expect } from "vitest";
import { listProcedures } from "./helpers/sweep-procs.js";
import {
  CA_FILING_MUTATIONS, caRoleMutationAllowed, canMarkGstFiled, defineAbilityFor,
  caRoleRefusalMessage, CA_READ_ONLY_MESSAGE, CA_FILING_ONLY_MESSAGE,
} from "../lib/permissions.js";

const procs = listProcedures();
const byPath = new Map(procs.map((p) => [p.path, p]));
const mutations = procs.filter((p) => p.type === "mutation");

describe("CA_FILING_MUTATIONS (typo guard)", () => {
  it("names only real mutations on the CASL base", () => {
    for (const path of CA_FILING_MUTATIONS) {
      const p = byPath.get(path);
      expect(p, path).toBeDefined();
      expect(p!.type, path).toBe("mutation");
      expect(p!.base, path).toBe("authorized");
    }
  });

  it("covers every gstReturns mutation and the gstr2b filing writes", () => {
    const gstReturns = mutations.filter((p) => p.router === "gstReturns").map((p) => p.path).sort();
    expect(gstReturns.length).toBe(7);
    for (const path of gstReturns) expect(CA_FILING_MUTATIONS, path).toContain(path);
    for (const path of ["gstr2b.upload", "gstr2b.linkInvoice", "gstr2b.ignoreRecord", "period.lockGstMonth"]) {
      expect(CA_FILING_MUTATIONS).toContain(path);
    }
    expect(CA_FILING_MUTATIONS.length).toBe(11);
  });

  it("never allowlists books, year close, unlocking, sharing or stock", () => {
    for (const path of ["period.lockBooks", "period.closeYear", "period.unlockGstMonth", "period.unlockBooks", "period.reopenYear", "share.create", "share.revoke", "stock.setup", "invoice.create", "tds.createChallan"]) {
      expect(CA_FILING_MUTATIONS, path).not.toContain(path);
    }
  });
});

describe("caRoleMutationAllowed", () => {
  it("auditor may call no mutation at all", () => {
    for (const p of mutations) expect(caRoleMutationAllowed("auditor", p.path), p.path).toBe(false);
  });

  it("ca_filing may call exactly the allowlist", () => {
    for (const p of mutations) {
      expect(caRoleMutationAllowed("ca_filing", p.path), p.path).toBe(CA_FILING_MUTATIONS.includes(p.path));
    }
  });

  it("every other role is untouched by the backstop", () => {
    for (const role of ["superadmin", "admin", "seller_manager", "seller", "accountant", ""]) {
      for (const p of mutations) expect(caRoleMutationAllowed(role, p.path), `${role} ${p.path}`).toBe(true);
    }
  });

  it("closes the mutations gated only by a read check", () => {
    for (const path of ["share.create", "share.revoke", "stock.setup"]) {
      expect(caRoleMutationAllowed("auditor", path)).toBe(false);
      expect(caRoleMutationAllowed("ca_filing", path)).toBe(false);
    }
  });
});

describe("canMarkGstFiled", () => {
  const can = (role: string) => canMarkGstFiled(defineAbilityFor({ userId: "u", role }));
  it("is true for lockers and for the filing accountant", () => {
    for (const role of ["superadmin", "admin", "accountant", "ca_filing"]) expect(can(role), role).toBe(true);
  });
  it("is false for everyone else", () => {
    for (const role of ["auditor", "seller", "seller_manager", ""]) expect(can(role), role).toBe(false);
  });
});

describe("tenant-base mutations a CA role could reach", () => {
  it("business.ensureWalkInParty is not allowlisted, so both CA roles are refused by its inline check", () => {
    expect(CA_FILING_MUTATIONS).not.toContain("business.ensureWalkInParty");
    expect(caRoleMutationAllowed("auditor", "business.ensureWalkInParty")).toBe(false);
    expect(caRoleMutationAllowed("ca_filing", "business.ensureWalkInParty")).toBe(false);
    expect(caRoleMutationAllowed("accountant", "business.ensureWalkInParty")).toBe(true);
    expect(byPath.get("business.ensureWalkInParty")?.base).toBe("tenant");
  });

  it("caRoleRefusalMessage names the right restriction", () => {
    expect(caRoleRefusalMessage("auditor")).toBe(CA_READ_ONLY_MESSAGE);
    expect(caRoleRefusalMessage("ca_filing")).toBe(CA_FILING_ONLY_MESSAGE);
  });
});
