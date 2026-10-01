/**
 * role-sweep.test.ts — calls EVERY tRPC procedure as each organisation role
 * and checks the outcome against the permission matrix.
 *
 * Procedures are enumerated at runtime from appRouter._def.procedures, so a
 * new procedure is swept automatically. Inputs are generated from each
 * procedure's zod schema (helpers/sweep-input.ts) with id fields pointing at
 * records seeded in business A1; mutations get throwaway records for the
 * record they act on, so one role's delete never breaks the next call.
 *
 * Roles (org A, business A1):
 *   owner          tenant owner, business admin      → CASL "superadmin"
 *   admin          tenant admin, business admin      → CASL "admin"
 *   seller_manager business member                   → CASL "seller_manager"
 *   seller         business member                   → CASL "seller"
 *   accountant     legacy "viewer" tenant role       → CASL "accountant"
 *                  (a native "accountant" user is swept too and must match)
 *
 * The expected matrix:
 *   - authorizedProcedure: a role is denied iff one of the CASL checks the
 *     procedure performs (recorded from requireCan while the owner calls it)
 *     is not granted to that role by defineAbilityFor — unless the procedure
 *     is listed in NON_CASL_GATES with the roles it really allows and why.
 *   - every other procedure (tenant/protected/public): allowed for every role
 *     unless listed in NON_CASL_GATES.
 * Every authorized procedure must perform at least one CASL check, except the
 * ones listed in NO_CASL_CHECK (with a reason).
 *
 * The observed matrix is written to __snapshots__/role-matrix.md, so any
 * change to who can call what shows up in review.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { defineAbilityFor, type Action, type Resource } from "../../lib/permissions.js";
import {
  buildSweepWorld,
  seedBusiness,
  idsForCall,
  callerAs,
  callPath,
  genInput,
  INPUT_OVERRIDES,
  SWEEP_ROLES,
  type SweepRole,
  type SweepWorld,
} from "../helpers/sweep-world.js";
import { listProcedures, type ProcInfo } from "../helpers/sweep-procs.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";

// Record every requireCan(ability, action, resource) made while a call runs.
const recorder = vi.hoisted(() => ({ checks: [] as string[] }));
vi.mock("../../lib/permissions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/permissions.js")>();
  return {
    ...actual,
    requireCan: (ability: Parameters<typeof actual.requireCan>[0], action: Action, resource: Resource) => {
      recorder.checks.push(`${action}:${resource}`);
      return actual.requireCan(ability, action, resource);
    },
  };
});

type Column = SweepRole;
type Outcome = "allow" | "deny";

/** CASL role each sweep user ends up with inside business A1. */
const CASL_ROLE: Record<Column, string> = {
  owner: "superadmin",
  admin: "admin",
  seller_manager: "seller_manager",
  seller: "seller",
  accountant: "accountant",
};

const ALL: Column[] = [...SWEEP_ROLES];
const ADMINS: Column[] = ["owner", "admin"];

/**
 * Procedures whose access is decided by something other than (or on top of)
 * CASL. Each entry lists the roles that are ALLOWED.
 */
const NON_CASL_GATES: Record<string, { allow: Column[]; why: string }> = {
  // Org-level management checks the tenant role in the control DB.
  "tenant.inviteMember": { allow: ADMINS, why: "tenant owner/admin only" },
  "tenant.revokeInvitation": { allow: ADMINS, why: "tenant owner/admin only" },
  "tenant.removeMember": { allow: ADMINS, why: "tenant owner/admin only" },
  "tenant.updateMemberRole": { allow: ADMINS, why: "tenant owner/admin only" },
  "tenant.updatePlan": { allow: [], why: "plans are changed by the platform team only" },
  "business.members": { allow: ADMINS, why: "requireTenantAdmin" },
  "business.addMember": { allow: ADMINS, why: "requireTenantAdmin" },
  "business.updateMemberRole": { allow: ADMINS, why: "requireTenantAdmin" },
  "business.removeMember": { allow: ADMINS, why: "requireTenantAdmin" },
  "business.create": { allow: ADMINS, why: "requireTenantAdmin" },
  "business.update": { allow: ADMINS, why: "requireTenantAdmin" },
  "business.uploadLogo": { allow: ADMINS, why: "requireTenantAdmin" },
  "business.uploadSignature": { allow: ADMINS, why: "requireTenantAdmin" },
  "business.deleteSignature": { allow: ADMINS, why: "requireTenantAdmin" },
  "business.deleteLogo": { allow: ADMINS, why: "requireTenantAdmin" },
  "business.setPosEnabled": { allow: ADMINS, why: "requireTenantAdmin" },
  "business.updateSequenceNumber": { allow: ADMINS, why: "requireTenantAdmin" },
  // Stock movements: non-admins also need a per-warehouse grant, which the
  // sweep users don't have (see stock.ts assertWarehousePermission).
  "stock.transfer": { allow: ADMINS, why: "non-admins need a warehouse transfer grant" },
  "stock.adjust": { allow: ADMINS, why: "non-admins need a warehouse adjust grant" },
  "stock.verify": { allow: ADMINS, why: "non-admins need a warehouse adjust grant" },
  "stock.countPost": { allow: ADMINS, why: "non-admins need a warehouse adjust grant" },
  "manufacturing.cancel": { allow: ADMINS, why: "non-admins need a warehouse adjust grant" },
  // Owner decision: sellers create documents but never edit them.
  "invoice.update": { allow: ["owner", "admin", "seller_manager"], why: "sellers can't edit invoices" },
  "selfExport.request": { allow: ["owner"], why: "org owner only" },
  "selfImport.request": { allow: ["owner"], why: "org owner only" },
};
// Platform console: only platform admins (env-configured), never org roles.
for (const p of listProcedures()) {
  if (p.router === "platform" && p.name !== "me") NON_CASL_GATES[p.path] = { allow: [], why: "platform admins only" };
}

/**
 * Authorized procedures that intentionally make no CASL check: any member of
 * the business may call them.
 */
const NO_CASL_CHECK: Record<string, string> = {
  "target.myTargets": "self-scoped: returns only the caller's own sales targets",
};

// ── Sweep ────────────────────────────────────────────────────────────────────

let world: SweepWorld;

/**
 * Procedures whose generated input is rejected by input validation even for
 * the owner, so the sweep can't see past it. A new procedure landing here
 * needs an INPUT_OVERRIDES entry (or a reason why the input can't be built).
 */
const INPUT_UNREACHABLE: Record<string, string> = {};

async function buildInput(proc: ProcInfo): Promise<unknown> {
  const ids = await idsForCall(world.a1, proc);
  const over = INPUT_OVERRIDES[proc.path]?.(ids);
  return genInput(proc.path, ids, over);
}

interface CallResult {
  outcome: Outcome;
  /** The input failed zod validation (the call never reached the resolver). */
  invalidInput: boolean;
  code: string;
  message: string;
  checks: string[];
}

async function callAs(user: SweepWorld["usersA"][keyof SweepWorld["usersA"]], proc: ProcInfo): Promise<CallResult> {
  const input = await buildInput(proc);
  const caller = callerAs(user, world.tenantA.id, world.a1.id);
  recorder.checks = [];
  let code = "OK";
  let message = "";
  let invalidInput = false;
  try {
    await Promise.race([
      callPath(caller, proc.path, input),
      new Promise((_, rej) => setTimeout(() => rej(new TRPCError({ code: "TIMEOUT", message: "sweep timeout" })), 10_000)),
    ]);
  } catch (e) {
    code = (e as { code?: string }).code ?? "THROWN";
    message = (e as Error).message;
    invalidInput = (e as { cause?: unknown }).cause instanceof ZodError;
  }
  return { outcome: code === "FORBIDDEN" ? "deny" : "allow", invalidInput, code, message, checks: [...recorder.checks] };
}

interface Row {
  proc: ProcInfo;
  checks: string[];
  results: Record<Column, CallResult>;
  nativeAccountant: CallResult;
}

const rows: Row[] = [];

/** Queries first, so mutations can't change what a later query sees. */
const PROCS = listProcedures().sort((a, b) => (a.type === b.type ? 0 : a.type === "query" ? -1 : 1));

beforeAll(async () => {
  world = await buildSweepWorld();
  await seedBusiness(world.a1);
}, 120_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

function expectedFor(row: Row): Record<Column, Outcome> {
  const gate = NON_CASL_GATES[row.proc.path];
  const out = {} as Record<Column, Outcome>;
  for (const role of ALL) {
    if (gate) {
      out[role] = gate.allow.includes(role) ? "allow" : "deny";
    } else if (row.proc.base === "authorized") {
      const ability = defineAbilityFor({ userId: "x", role: CASL_ROLE[role] });
      const denied = row.checks.some((c) => {
        const [action, resource] = c.split(":") as [Action, Resource];
        return !ability.can(action, resource);
      });
      out[role] = denied ? "deny" : "allow";
    } else {
      out[role] = "allow";
    }
  }
  return out;
}

describe("role sweep over every tRPC procedure", () => {
  it("enumerates the whole appRouter", () => {
    expect(PROCS.length).toBeGreaterThan(400);
  });

  for (const proc of PROCS) {
    it(`${proc.path}`, async () => {
      // Least privileged first; the owner call (all CASL checks pass) is the
      // one whose recorded checks define the procedure's CASL requirements.
      const results = {} as Record<Column, CallResult>;
      results.accountant = await callAs(world.usersA.viewer, proc);
      const nativeAccountant = await callAs(world.usersA.accountant, proc);
      results.seller = await callAs(world.usersA.seller, proc);
      results.seller_manager = await callAs(world.usersA.seller_manager, proc);
      results.admin = await callAs(world.usersA.admin, proc);
      results.owner = await callAs(world.usersA.owner, proc);
      rows.push({ proc, checks: [...new Set(results.owner.checks)], results, nativeAccountant });
    }, 120_000);
  }

  it("matches the permission matrix", () => {
    const mismatches: string[] = [];
    for (const row of rows) {
      const expected = expectedFor(row);
      for (const role of ALL) {
        const r = row.results[role];
        if (r.outcome !== expected[role]) {
          mismatches.push(`${row.proc.path} as ${role}: expected ${expected[role]}, got ${r.code} ${r.message}`.slice(0, 300));
        }
      }
      if (row.nativeAccountant.outcome !== row.results.accountant.outcome) {
        mismatches.push(`${row.proc.path}: legacy viewer (${row.results.accountant.code}) differs from native accountant (${row.nativeAccountant.code})`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("reaches every procedure with a valid input", () => {
    const invalid = rows.filter((r) => r.results.owner.invalidInput).map((r) => r.proc.path);
    expect(invalid.filter((p) => !(p in INPUT_UNREACHABLE))).toEqual([]);
    expect(Object.keys(INPUT_UNREACHABLE).filter((p) => !invalid.includes(p))).toEqual([]);
  });

  it("every authorized procedure makes a CASL check (or is listed as open to all members)", () => {
    const unchecked = rows
      .filter((r) => r.proc.base === "authorized" && r.checks.length === 0)
      .map((r) => `${r.proc.path} (owner got ${r.results.owner.code} ${r.results.owner.message})`.slice(0, 200));
    const unexpected = unchecked.filter((u) => !(u.split(" ")[0]! in NO_CASL_CHECK));
    expect(unexpected).toEqual([]);
    // Keep the allow-list honest: everything on it really is unchecked.
    const stale = Object.keys(NO_CASL_CHECK).filter((p) => !unchecked.some((u) => u.startsWith(`${p} `)));
    expect(stale).toEqual([]);
  });

  it("no procedure is only reachable through a business-level base without CASL", () => {
    // businessProcedure skips withPermissions: every procedure must use
    // authorizedProcedure (or a tenant/protected/public base) instead.
    expect(rows.filter((r) => r.proc.base === "business").map((r) => r.proc.path)).toEqual([]);
  });

  it("writes the reviewed role matrix", async () => {
    const mark = (o: Outcome) => (o === "allow" ? "✓" : "✗");
    const lines = [
      "# Role matrix (generated by role-sweep.test.ts — review changes)",
      "",
      "✓ = allowed (anything but FORBIDDEN), ✗ = FORBIDDEN. `CASL` lists the requireCan checks the procedure makes.",
      "",
      "| procedure | type | base | CASL | owner | admin | seller_manager | seller | accountant |",
      "|---|---|---|---|---|---|---|---|---|",
      ...[...rows]
        .sort((a, b) => a.proc.path.localeCompare(b.proc.path))
        .map((r) => `| ${r.proc.path} | ${r.proc.type} | ${r.proc.base} | ${r.checks.join(", ") || "—"}${NON_CASL_GATES[r.proc.path] ? ` (+ ${NON_CASL_GATES[r.proc.path]!.why})` : ""} | ${ALL.map((role) => mark(r.results[role].outcome)).join(" | ")} |`),
      "",
    ];
    await expect(lines.join("\n")).toMatchFileSnapshot("./__snapshots__/role-matrix.md");
  });
});
