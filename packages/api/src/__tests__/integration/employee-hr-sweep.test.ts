/**
 * employee-hr-sweep.test.ts — calls EVERY tRPC procedure as a Payroll self-service employee login and as the
 * HR / Payroll manager role (Payroll Phase 3), next to the main role sweep (role-sweep.test.ts), whose
 * columns it deliberately leaves alone.
 *
 * Employee: refused by every procedure except the explicit allowlist (shared EMPLOYEE_ALLOWED_PROCEDURES: the
 * payrollSelf.* procedures and tenant.current) and the account-level ones (EMPLOYEE_ACCOUNT_PROCEDURES and
 * auth.*: signing in, sessions, switching organisation). Every procedure is classified here by name, so a new
 * procedure is refused for employees by default and a new allowlist entry must be a real procedure.
 *
 * Phase 4 (bonus, gratuity, full and final, loans, letters) adds no employee procedure on purpose: every payrollBonus, payrollGratuity,
 * payrollFnf, payrollLoan and payrollLetter procedure is refused for the employee (they are not in EMPLOYEE_ALLOWED_PROCEDURES; the
 * test below fails if one is ever allowed without being classified) and the employee-side loan view was not built.
 *
 * HR: allowed exactly what its CASL permissions say. For every authorized procedure the Payroll checks
 * (recorded while the owner calls it) must be granted to HR, else HR is FORBIDDEN; the books, billing,
 * team, settings and AI are refused; approving and posting a run are refused.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { businessMembers, employeeLogins } from "@fintranzact/db";
import { EMPLOYEE_ACCOUNT_PROCEDURES, EMPLOYEE_ALLOWED_PROCEDURES, employeeMayCall } from "@fintranzact/shared";
import { defineAbilityFor, type Action, type Resource } from "../../lib/permissions.js";
import { buildSweepWorld, seedBusiness, idsForCall, callerAs, callPath, genInput, INPUT_OVERRIDES, type SweepWorld } from "../helpers/sweep-world.js";
import { createUser, addMember, type TestUser } from "../helpers/fixtures.js";
import { listProcedures, type ProcInfo } from "../helpers/sweep-procs.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

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

let world: SweepWorld;
let employeeUser: TestUser;
let hrUser: TestUser;
let employeeId: string;

const PROCS = listProcedures().sort((a, b) => (a.type === b.type ? 0 : a.type === "query" ? -1 : 1));

/** Tenant-level procedures HR must be refused: team, billing, exports, business setup. */
const HR_REFUSED_TENANT_LEVEL = [
  "tenant.inviteMember", "tenant.removeMember", "tenant.updateMemberRole", "tenant.revokeInvitation", "tenant.setSecurityPolicy",
  "tenant.accessLog", "tenant.updatePlan", "billing.subscribePlan", "billing.subscribeAddon", "billing.overview", "billing.changePlan",
  "billing.cancelSubscription", "selfExport.request", "selfImport.request", "business.create", "business.update", "business.addMember",
  "business.members", "business.updateMemberRole", "business.removeMember", "business.uploadLogo", "govUsage.summary", "ai.settings", "ai.updateSettings",
];

beforeAll(async () => {
  world = await buildSweepWorld();
  await seedBusiness(world.a1);
  const owner = callerAs(world.usersA.owner, world.tenantA.id, world.a1.id);
  employeeId = (await owner.payrollEmployee.create({ employeeCode: "SWEEP-E", name: "Sweep Employee", dateOfJoining: "2026-01-01" } as never) as { id: string }).id;
  const db = getTenantTestDb();
  employeeUser = await createUser({ email: `employee.${Date.now()}@sweep.in`, name: "Sweep Employee" });
  await addMember(world.tenantA.id, employeeUser.id, "employee");
  await db.insert(businessMembers).values({ businessId: world.a1.id, userId: employeeUser.id, role: "member" });
  await db.insert(employeeLogins).values({ businessId: world.a1.id, employeeId, userId: employeeUser.id });
  hrUser = await createUser({ email: `hr.${Date.now()}@sweep.in`, name: "Sweep HR" });
  await addMember(world.tenantA.id, hrUser.id, "hr");
  await db.insert(businessMembers).values({ businessId: world.a1.id, userId: hrUser.id, role: "member" });
}, 180_000);

afterAll(async () => {
  await db_cleanup();
});

async function db_cleanup() {
  await getTenantTestDb().delete(employeeLogins).where(eq(employeeLogins.employeeId, employeeId)).catch(() => undefined);
  await truncateAllTables();
  await closeTestDb();
}

async function buildInput(proc: ProcInfo): Promise<unknown> {
  const ids = await idsForCall(world.a1, proc);
  return genInput(proc.path, ids, INPUT_OVERRIDES[proc.path]?.(ids));
}

interface Outcome {
  code: string;
  message: string;
  checks: string[];
}

async function callAs(user: TestUser, proc: ProcInfo, tenantId = world.tenantA.id, businessId = world.a1.id): Promise<Outcome> {
  const input = await buildInput(proc);
  recorder.checks = [];
  let code = "OK";
  let message = "";
  try {
    await Promise.race([
      callPath(callerAs(user, tenantId, businessId), proc.path, input),
      new Promise((_, rej) => setTimeout(() => rej(new TRPCError({ code: "TIMEOUT", message: "sweep timeout" })), 10_000)),
    ]);
  } catch (e) {
    code = (e as { code?: string }).code ?? "THROWN";
    message = (e as Error).message;
  }
  return { code, message, checks: [...new Set(recorder.checks)] };
}

const rows: Array<{ proc: ProcInfo; owner: Outcome; hr: Outcome; employee: Outcome }> = [];

describe("employee and HR sweep over every tRPC procedure", () => {
  it("enumerates the whole appRouter", () => {
    expect(PROCS.length).toBeGreaterThan(400);
  });

  it("every allowlist entry is a real procedure", () => {
    const paths = new Set(PROCS.map((p) => p.path));
    expect([...EMPLOYEE_ALLOWED_PROCEDURES, ...EMPLOYEE_ACCOUNT_PROCEDURES].filter((p) => !paths.has(p))).toEqual([]);
    expect(EMPLOYEE_ALLOWED_PROCEDURES.filter((p) => p.startsWith("payrollSelf.")).sort()).toEqual(PROCS.filter((p) => p.router === "payrollSelf").map((p) => p.path).sort());
  });

  for (const proc of PROCS) {
    it(proc.path, async () => {
      const owner = await callAs(world.usersA.owner, proc);
      const hr = await callAs(hrUser, proc);
      const employee = await callAs(employeeUser, proc);
      rows.push({ proc, owner, hr, employee });
    }, 120_000);
  }

  it("the employee is refused by every procedure outside the allowlist (an organisation or business procedure, or a protected one)", () => {
    const bad: string[] = [];
    for (const { proc, employee } of rows) {
      if (proc.base === "public") continue; // no session involved: public by design (login, plans, contact...)
      const allowed = employeeMayCall(proc.path);
      if (!allowed && employee.code !== "FORBIDDEN") bad.push(`${proc.path}: employee got ${employee.code} ${employee.message}`.slice(0, 200));
      if (allowed && employee.code === "FORBIDDEN" && /self-service only/.test(employee.message)) bad.push(`${proc.path}: allowlisted but the backstop refused it`);
    }
    expect(bad).toEqual([]);
  });

  it("the self-service procedures work for the employee and for nobody else", () => {
    for (const { proc, owner, hr, employee } of rows.filter((r) => r.proc.router === "payrollSelf" && r.proc.name !== "workplaces")) {
      expect(employee.code, `${proc.path} as employee: ${employee.message}`).not.toBe("FORBIDDEN");
      expect(owner.code, `${proc.path} as owner`).toBe("FORBIDDEN");
      expect(hr.code, `${proc.path} as HR`).toBe("FORBIDDEN");
    }
  });

  it("an employee cannot cross into another business or organisation, with or without a guessed id", async () => {
    // workplaces is tenant-level and lists only the caller's own links, so it has no business to cross into.
    const withIds = PROCS.filter((p) => p.router === "payrollSelf" && p.name !== "workplaces");
    const b1 = world.b1;
    for (const proc of withIds) {
      for (const [tenantId, businessId] of [[world.tenantB.id, b1.id], [world.tenantA.id, world.a2.id]] as const) {
        const out = await callAs(employeeUser, proc, tenantId, businessId);
        expect(out.code, `${proc.path} -> ${businessId}`).toBe("FORBIDDEN");
      }
    }
  }, 120_000);

  it("HR is allowed exactly what its permissions grant on authorized procedures", () => {
    const ability = defineAbilityFor({ userId: "x", role: "hr" });
    const wrong: string[] = [];
    for (const { proc, owner, hr } of rows) {
      if (proc.base !== "authorized") continue;
      const denied = owner.checks.some((c) => {
        const [action, resource] = c.split(":") as [Action, Resource];
        return !ability.can(action, resource);
      });
      if (denied && hr.code !== "FORBIDDEN") wrong.push(`${proc.path}: HR should be refused (${owner.checks.join(", ")}) but got ${hr.code}`);
      if (!denied && hr.code === "FORBIDDEN" && !/Only HR|owner/i.test(hr.message) && owner.code !== "FORBIDDEN") wrong.push(`${proc.path}: HR was refused (${hr.message}) though its permissions allow ${owner.checks.join(", ")}`);
    }
    expect(wrong).toEqual([]);
  });

  it("HR runs payroll (employees, attendance, leave, runs, payslips, statutory, punches, imports, bonus, gratuity, full and final, loans, letters) except approving and posting", () => {
    const refused = new Set([
      "payrollSalary.templateDelete", "payrollRun.approve", "payrollRun.post", "payrollRun.markPaid", "payrollStatutory.recordPayment", "payrollStatutory.saveRates", "payrollStatutory.updateBusinessSettings",
      // Phase 4: approving needs Payroll "manage", posting and paying need PayrollPosting; HR prepares only.
      "payrollBonus.approve", "payrollBonus.post", "payrollBonus.markPaid",
      "payrollFnf.approve", "payrollFnf.post", "payrollFnf.markPaid", "payrollFnf.reverse", "payrollFnf.reversePayment",
      "payrollLoan.approve", "payrollLoan.reject", "payrollLoan.disburse", "payrollLoan.prepay", "payrollLoan.foreclose", "payrollLoan.updateSettings",
      "payrollGratuity.postProvision",
    ]);
    const payrollRows = rows.filter((r) => /^payroll(Employee|Salary|Attendance|Leave|Run|Statutory|Access|Punch|Import|Bonus|Gratuity|Fnf|Loan|Letter)\./.test(r.proc.path));
    expect(payrollRows.length).toBeGreaterThan(110);
    for (const { proc, hr } of payrollRows) {
      if (refused.has(proc.path)) expect(hr.code, proc.path).toBe("FORBIDDEN");
      else expect(hr.code, `${proc.path}: ${hr.message}`).not.toBe("FORBIDDEN");
    }
  });

  it("HR is refused the books, billing, team, business setup, exports and the AI assistant", () => {
    const wrong: string[] = [];
    for (const path of HR_REFUSED_TENANT_LEVEL) {
      const r = rows.find((x) => x.proc.path === path);
      if (!r) wrong.push(`${path} is not a procedure`);
      else if (r.hr.code !== "FORBIDDEN") wrong.push(`${path}: HR got ${r.hr.code}`);
    }
    for (const r of rows) {
      // period.status is the one read every member has (it explains why an entry was blocked).
      if (/^(invoice|expense|journal|account|bankAccount|bankRecon|itc|tds|period|stock|gst|gstReturns|reports|ai)\./.test(r.proc.path) && r.proc.base === "authorized" && r.proc.path !== "period.status" && r.hr.code !== "FORBIDDEN") {
        wrong.push(`${r.proc.path}: HR got ${r.hr.code}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
