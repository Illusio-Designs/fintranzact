/**
 * Exhaustive role × resource × action table for defineAbilityFor.
 *
 * The expected grants below are written out from the role comments in
 * lib/permissions.ts and the capability matrix in
 * docs/architecture/role-based-ui.md §3. Every cell is checked, so any grant
 * added or removed shows up here as a one-cell diff.
 *
 * Known difference from the doc (kept as the code has it): the doc lists
 * "GST Returns: read" for seller_manager, but seller_manager has no GstReport
 * grant — only admin/superadmin and accountant can read GST returns.
 */
import { describe, it, expect } from "vitest";
import { defineAbilityFor, mapDbRole, type Action, type Resource } from "../lib/permissions.js";

const ACTIONS: Action[] = ["create", "read", "update", "delete", "manage"];
const RESOURCES: Exclude<Resource, "all">[] = [
  "Invoice", "Payment", "Party", "Item", "Expense",
  "BankAccount", "BankTransaction",
  "Business", "Team", "Import", "Report", "GstReport",
  "Store", "SalesTarget", "RecurringInvoice",
  "Account", "ITC",
  "BankReconciliation", "EInvoice", "EWayBill",
];

type Grants = Partial<Record<Exclude<Resource, "all">, string>>;
/** c r u d m — "m" (manage) implies all the others. */
const ALL = "crudm";

const EXPECTED: Record<string, Grants> = {
  superadmin: Object.fromEntries(RESOURCES.map((r) => [r, ALL])),
  admin: Object.fromEntries(RESOURCES.map((r) => [r, ALL])),
  seller_manager: {
    Invoice: "crud",
    Party: "cru",
    Item: "cru",
    Payment: "cru",
    Expense: "r",
    BankAccount: "r",
    BankTransaction: "r",
    Account: "r",
    Business: "r",
    Report: "r",
    Store: "cru",
    SalesTarget: ALL,
    RecurringInvoice: "crud",
  },
  seller: {
    Invoice: "cru",
    Party: "cr",
    Item: "r",
    Payment: "cru",
    Business: "r",
    Store: "r",
    SalesTarget: "r",
    RecurringInvoice: "r",
    Report: "r",
  },
  accountant: {
    Payment: "cru",
    Expense: "crud",
    BankAccount: ALL,
    BankTransaction: ALL,
    Account: ALL,
    ITC: ALL,
    BankReconciliation: ALL,
    EInvoice: "r",
    EWayBill: "r",
    Report: "r",
    GstReport: "r",
    Invoice: "r",
    Party: "r",
    Item: "r",
    Business: "r",
    Store: "r",
    RecurringInvoice: "r",
  },
  "": {},
};

const LETTER: Record<Action, string> = { create: "c", read: "r", update: "u", delete: "d", manage: "m" };

const cells = Object.entries(EXPECTED).flatMap(([role, grants]) =>
  RESOURCES.flatMap((resource) =>
    ACTIONS.map((action) => ({
      role: role || "(unknown)",
      rawRole: role,
      resource,
      action,
      allowed: (grants[resource] ?? "").includes(LETTER[action]),
    })),
  ),
);

describe("permission matrix — every role × resource × action", () => {
  it(`covers ${cells.length} cells`, () => {
    expect(cells.length).toBe(Object.keys(EXPECTED).length * RESOURCES.length * ACTIONS.length);
  });

  it.each(cells)("$role $action $resource → $allowed", ({ rawRole, resource, action, allowed }) => {
    const ability = defineAbilityFor({ userId: "u", role: rawRole });
    expect(ability.can(action, resource)).toBe(allowed);
  });
});

describe("matrix invariants", () => {
  it("no role other than superadmin/admin can manage Team or run Import", () => {
    for (const role of ["seller_manager", "seller", "accountant", "viewer", "owner-typo"]) {
      const a = defineAbilityFor({ userId: "u", role });
      for (const act of ACTIONS) {
        expect(a.can(act, "Team")).toBe(false);
        expect(a.can(act, "Import")).toBe(false);
      }
    }
  });

  it("seller never gets delete on anything", () => {
    const a = defineAbilityFor({ userId: "u", role: "seller" });
    for (const r of RESOURCES) expect(a.can("delete", r)).toBe(false);
  });

  it("legacy DB roles map onto the same rows (owner → superadmin, member → seller, viewer → accountant)", () => {
    const pairs: Array<[string, string]> = [["owner", "superadmin"], ["member", "seller"], ["viewer", "accountant"]];
    for (const [db, canonical] of pairs) {
      const legacy = defineAbilityFor({ userId: "u", role: mapDbRole(db) });
      const direct = defineAbilityFor({ userId: "u", role: canonical });
      for (const r of RESOURCES) for (const act of ACTIONS) expect(legacy.can(act, r)).toBe(direct.can(act, r));
    }
  });

  it("an unmapped DB role gets nothing", () => {
    const a = defineAbilityFor({ userId: "u", role: mapDbRole("platform_admin") });
    for (const r of RESOURCES) for (const act of ACTIONS) expect(a.can(act, r)).toBe(false);
  });
});
