/**
 * payroll-self-service.test.ts — Payroll Phase 3 against a real Postgres (no camera, no GPS, no network:
 * the server clock is replaced, selfies are a 1-pixel PNG, locations are plain numbers).
 *
 * Invariants:
 *   1. An employee becomes a login only through a single-use, expiring invitation, as a seatless
 *      "employee" member of exactly one business, linked to exactly one employee. Leaving ends it.
 *   2. An employee reaches only payrollSelf; everything resolves from the membership; nobody else's
 *      payslip, leave, attendance or Form 16 is reachable; other businesses are out of reach.
 *   3. A punch is stamped with the SERVER's time, obeys the one-open-punch rule and the geofence policy,
 *      and rolls up into the daily attendance without ever beating HR's own marks or a locked month.
 *   4. HR prepares payroll but cannot approve or post it; accountants cannot see selfies or locations.
 *   5. Payslips only after approval; Form 16 only when released; leave goes through HR.
 *   6. Add-on, read-only and audit rules hold.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  attendanceRecords,
  auditLog,
  businessMembers,
  employeeLogins,
  employeePunchSelfies,
  employeePunches,
  invitations,
  tenantMembers,
} from "@fintranzact/db";
import { ATTENDANCE_CONSENT_VERSION } from "@fintranzact/shared";
import { createTenant, createUser, addMember, createBusiness, grantAddon, type TestUser, type TestTenant, type TestBusiness } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";
import { entitlementDataOf } from "../../lib/entitlement-error.js";
import { invalidateEntitlements } from "../../lib/entitlements.js";
import { emailService } from "../../lib/email.js";
import { enforceTeamMemberLimit } from "../../lib/plan-limits.js";
import { punchClock, purgeExpiredSelfies } from "../../lib/payroll/punches.js";
import { selfPunchLimiter } from "../../routers/payrollSelf.js";
import { hashInvitationToken } from "../../lib/payroll/employee-access.js";

const db = () => getTenantTestDb();
const cdb = () => getControlDb();

type Caller = ReturnType<typeof createTestCaller>;
const callerFor = (u: TestUser, t: TestTenant, b: TestBusiness): Caller =>
  createTestCaller({ userId: u.id, email: u.email, name: u.name ?? null, tenantId: t.id, businessId: b.id });

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let tenant: TestTenant;
let biz: TestBusiness;
let owner: TestUser;
let hr: TestUser;
let accountant: TestUser;
let seller: TestUser;
let ownerC: Caller;
let hrC: Caller;
let accountantC: Caller;
let sellerC: Caller;

// Employees: asha (E001) and ravi (E002) have logins; meena (E003) has none.
let asha: TestUser;
let ravi: TestUser;
let ashaC: Caller;
let raviC: Caller;
const ids: Record<string, string> = {};

// A second organisation with its own employee, to prove nothing crosses.
let tenantB: TestTenant;
let bizB: TestBusiness;
let ownerBC: Caller;
// A second business in the first organisation, which the employees are not given.
let biz2: TestBusiness;

const setNow = (iso: string) => {
  punchClock.now = () => new Date(iso);
};
const realNow = punchClock.now;

async function team(t: TestTenant, b: TestBusiness, email: string, role: "hr" | "accountant" | "seller" | "admin", bizRole: "admin" | "member" = "member") {
  const u = await createUser({ email, name: email.split("@")[0] });
  await addMember(t.id, u.id, role);
  await db().insert(businessMembers).values({ businessId: b.id, userId: u.id, role: bizRole });
  return u;
}

function tokenOf(inviteUrl: string): string {
  return inviteUrl.split("/invite/")[1]!;
}

/** HR invites, the person signs up with that email and accepts. */
async function giveLogin(by: Caller, t: TestTenant, b: TestBusiness, employeeId: string, email: string): Promise<TestUser> {
  const inv = await by.payrollAccess.invite({ employeeId, email });
  const u = await createUser({ email, name: email.split("@")[0] });
  await callerFor(u, t, b).tenant.acceptInvitation({ token: tokenOf(inv.inviteUrl) });
  return u;
}

async function punch(c: Caller, kind: "in" | "out", atIso: string, extra: Record<string, unknown> = {}) {
  setNow(atIso);
  return c.payrollSelf.punch({ kind, clientTime: new Date(atIso).getTime(), deviceId: "phone-1", consentVersion: ATTENDANCE_CONSENT_VERSION, selfie: PNG, ...extra } as never);
}

const recordOf = async (employeeId: string, date: string) =>
  (await db().select().from(attendanceRecords).where(and(eq(attendanceRecords.employeeId, employeeId), eq(attendanceRecords.date, date))))[0];

const settingsInput = (over: Record<string, unknown> = {}) => ({
  punchEnabled: true, geofencePolicy: "record", accuracyThresholdM: 100, selfieRequired: true, selfieRetentionDays: 90,
  lateGraceMinutes: 15, fullDayMinHours: null, halfDayMinHours: null, overtimeFromPunches: false, ...over,
}) as never;

beforeAll(async () => {
  tenant = await createTenant({ name: "People Co", plan: "growth" });
  await grantAddon(tenant.id, "payroll");
  owner = await createUser({ email: "owner@peopleco.in", name: "Ramesh Kumar" });
  await addMember(tenant.id, owner.id, "owner");
  biz = await createBusiness(db(), owner.id, { name: "People Co", legalName: "People Co Pvt Ltd" });
  await db().insert(businessMembers).values({ businessId: biz.id, userId: owner.id, role: "admin" });
  await seedChartOfAccounts(db(), biz.id);
  hr = await team(tenant, biz, "hema@peopleco.in", "hr");
  accountant = await team(tenant, biz, "anita@peopleco.in", "accountant");
  seller = await team(tenant, biz, "sunil@peopleco.in", "seller");
  ownerC = callerFor(owner, tenant, biz);
  hrC = callerFor(hr, tenant, biz);
  accountantC = callerFor(accountant, tenant, biz);
  sellerC = callerFor(seller, tenant, biz);

  biz2 = await createBusiness(db(), owner.id, { name: "People Co Two" });
  await db().insert(businessMembers).values({ businessId: biz2.id, userId: owner.id, role: "admin" });

  tenantB = await createTenant({ name: "Other Org" });
  await grantAddon(tenantB.id, "payroll");
  const ownerB = await createUser({ email: "owner@otherorg.in", name: "Kiran Mehta" });
  await addMember(tenantB.id, ownerB.id, "owner");
  bizB = await createBusiness(db(), ownerB.id, { name: "Other Org" });
  await db().insert(businessMembers).values({ businessId: bizB.id, userId: ownerB.id, role: "admin" });
  ownerBC = callerFor(ownerB, tenantB, bizB);

  // Payroll setup done by HR (HR can prepare everything but approve and post).
  await hrC.payrollSalary.componentSeedDefaults();
  await hrC.payrollLeave.typeSeedDefaults();
  for (const c of await hrC.payrollSalary.componentList()) ids[`c_${c.code}`] = c.id;
  for (const t of await hrC.payrollLeave.typeList()) ids[`l_${t.code}`] = t.id;
  const tpl = await hrC.payrollSalary.templateCreate({
    name: "Staff",
    sampleAnnualCtc: 600000,
    lines: [
      { componentId: ids.c_BASIC!, calcType: "percent_of_ctc", value: 50 },
      { componentId: ids.c_SPECIAL!, calcType: "balance", value: 0 },
    ],
  });
  ids.template = tpl.id;
  ids.day = (await hrC.payrollEmployee.shiftCreate({ name: "Day", startTime: "09:00", endTime: "18:00", weeklyOffDays: [0], standardHours: 8 })).id;
  ids.night = (await hrC.payrollEmployee.shiftCreate({ name: "Night", startTime: "22:00", endTime: "06:00", weeklyOffDays: [0], standardHours: 8 })).id;
  for (const [key, code, name, shiftId, email] of [
    ["asha", "E001", "Asha Verma", ids.day, "asha@example.in"],
    ["ravi", "E002", "Ravi Nair", ids.day, "ravi@example.in"],
    ["meena", "E003", "Meena Shah", ids.night, "meena@example.in"],
  ] as const) {
    const e = await hrC.payrollEmployee.create({ employeeCode: code, name, dateOfJoining: "2026-04-01", email, shiftId });
    ids[key] = e.id;
    await hrC.payrollSalary.assign({ employeeId: e.id, templateId: ids.template!, annualCtc: 600000, effectiveFrom: "2026-04-01" });
  }
}, 180_000);

afterAll(async () => {
  punchClock.now = realNow;
  await truncateAllTables();
  await closeTestDb();
});

beforeEach(() => {
  selfPunchLimiter.clear();
});
afterEach(() => {
  punchClock.now = realNow;
  vi.restoreAllMocks();
});

const reasonOf = (e: unknown) => entitlementDataOf(e)?.reason;

// ─────────────────────────────────────────────────────────────────────────────
describe("employee logins: the invitation lifecycle", () => {
  it("HR invites by email; the invitation is hashed, single-use, expires, and is seen as an employee invitation", async () => {
    const mail = vi.spyOn(emailService, "sendInvitation").mockResolvedValue();
    const inv = await hrC.payrollAccess.invite({ employeeId: ids.asha!, email: "Asha.Verma@Example.in" });
    expect(inv.replaced).toBe(false);
    expect(mail).toHaveBeenCalledWith("asha.verma@example.in", expect.stringContaining("/invite/"), expect.any(String), expect.any(String), "employee");
    const [row] = await cdb().select().from(invitations).where(eq(invitations.employeeId, ids.asha!));
    expect(row).toMatchObject({ role: "employee", email: "asha.verma@example.in", businessId: biz.id, acceptedAt: null });
    expect(row!.token).toBe(hashInvitationToken(tokenOf(inv.inviteUrl))); // only the hash is stored
    expect(row!.token).not.toContain(tokenOf(inv.inviteUrl));
    expect(row!.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);

    const list = await hrC.payrollAccess.loginList();
    expect(list.find((e) => e.employeeId === ids.asha)).toMatchObject({ state: "invited", loginEmail: "asha.verma@example.in" });
    expect(list.find((e) => e.employeeId === ids.ravi)).toMatchObject({ state: "none" });

    const peek = await createTestCaller({ userId: owner.id, email: owner.email, name: null, tenantId: tenant.id, businessId: biz.id }).tenant.peekInvitation({ token: tokenOf(inv.inviteUrl) });
    expect(peek).toMatchObject({ role: "employee", roleLabel: "Employee (self-service)", accessDescription: expect.stringContaining("own") });

    // Resending replaces the pending invitation: the old link stops working.
    const again = await hrC.payrollAccess.invite({ employeeId: ids.asha!, email: "asha@example.in" });
    expect(again.replaced).toBe(true);
    const stranger = await createUser({ email: "asha.verma@example.in", name: "Old Link" });
    await expect(callerFor(stranger, tenant, biz).tenant.acceptInvitation({ token: tokenOf(inv.inviteUrl) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    ids.ashaToken = tokenOf(again.inviteUrl);
  });

  it("only the invited address can accept; accepting links one employee and opens one business", async () => {
    const wrong = await createUser({ email: "someone.else@example.in", name: "Someone Else" });
    await expect(callerFor(wrong, tenant, biz).tenant.acceptInvitation({ token: ids.ashaToken! })).rejects.toMatchObject({ code: "FORBIDDEN" });

    asha = await createUser({ email: "asha@example.in", name: "Asha Verma" });
    ashaC = callerFor(asha, tenant, biz);
    await ashaC.tenant.acceptInvitation({ token: ids.ashaToken! });

    const [member] = await cdb().select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, asha.id)));
    expect(member!.role).toBe("employee");
    const grants = await db().select().from(businessMembers).where(eq(businessMembers.userId, asha.id));
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ businessId: biz.id, role: "member" });
    const [link] = await db().select().from(employeeLogins).where(eq(employeeLogins.userId, asha.id));
    expect(link).toMatchObject({ employeeId: ids.asha, businessId: biz.id });
    expect((await hrC.payrollAccess.loginList()).find((e) => e.employeeId === ids.asha)).toMatchObject({ state: "active", loginEmail: "asha@example.in" });

    // Single use: the used link cannot be used by anybody else, and replaying it as the same person changes nothing.
    await expect(callerFor(wrong, tenant, biz).tenant.acceptInvitation({ token: ids.ashaToken! })).rejects.toBeTruthy();
    await ashaC.tenant.acceptInvitation({ token: ids.ashaToken! });
    expect(await db().select().from(employeeLogins).where(eq(employeeLogins.employeeId, ids.asha!))).toHaveLength(1);

    const me = await ashaC.payrollSelf.me();
    expect(me).toMatchObject({ employee: { name: "Asha Verma", code: "E001" }, businessName: "People Co", next: "in" });
    expect(await ashaC.payrollSelf.workplaces()).toEqual([{ businessId: biz.id, businessName: "People Co", employeeName: "Asha Verma" }]);
  });

  it("an expired invitation is refused", async () => {
    const inv = await hrC.payrollAccess.invite({ employeeId: ids.ravi!, email: "ravi@example.in" });
    await cdb().update(invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitations.employeeId, ids.ravi!));
    ravi = await createUser({ email: "ravi@example.in", name: "Ravi Nair" });
    await expect(callerFor(ravi, tenant, biz).tenant.acceptInvitation({ token: tokenOf(inv.inviteUrl) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A fresh one works.
    const fresh = await hrC.payrollAccess.invite({ employeeId: ids.ravi!, email: "ravi@example.in" });
    raviC = callerFor(ravi, tenant, biz);
    await raviC.tenant.acceptInvitation({ token: tokenOf(fresh.inviteUrl) });
    expect((await raviC.payrollSelf.me()).employee.code).toBe("E002");
  });

  it("who may invite: HR, accountants and owners; not sellers, not employees; the add-on is needed", async () => {
    await expect(sellerC.payrollAccess.invite({ employeeId: ids.meena!, email: "meena@example.in" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ashaC.payrollAccess.invite({ employeeId: ids.meena!, email: "meena@example.in" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ownerBC.payrollAccess.invite({ employeeId: ids.meena!, email: "meena@example.in" })).rejects.toMatchObject({ code: "NOT_FOUND" }); // another business's employee
    // Not for a team member's address, and not twice for one employee.
    await expect(hrC.payrollAccess.invite({ employeeId: ids.meena!, email: "sunil@peopleco.in" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(hrC.payrollAccess.invite({ employeeId: ids.asha!, email: "other@example.in" })).rejects.toMatchObject({ code: "CONFLICT" });
    const t2 = await createTenant({ name: "No Addon Co" });
    const o2 = await createUser({ email: "owner@noaddon.in", name: "No Addon" });
    await addMember(t2.id, o2.id, "owner");
    const b2 = await createBusiness(db(), o2.id, { name: "No Addon Co" });
    await db().insert(businessMembers).values({ businessId: b2.id, userId: o2.id, role: "admin" });
    const err = await callerFor(o2, t2, b2).payrollAccess.invite({ employeeId: ids.meena!, email: "m@example.in" }).then(() => null, (e) => e);
    expect(reasonOf(err)).toBe("addon_required");
  });

  it("the HR role may invite, an employee cannot be given another role from the Team page, and the invite writes audit and access events", async () => {
    const audit = await db().select().from(auditLog).where(eq(auditLog.businessId, biz.id));
    const actions = audit.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["payroll.employeeLogin.invite", "payroll.employeeLogin.reinvite", "payroll.employeeLogin.accept"]));
    const accept = audit.find((a) => a.action === "payroll.employeeLogin.accept" && a.userId === asha.id);
    expect(accept).toBeTruthy(); // the actor is the employee who accepted
    await expect(ownerC.tenant.updateMemberRole({ userId: asha.id, role: "seller" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // HR is a normal staff role to invite.
    const hr2 = await ownerC.tenant.inviteMember({ email: "second.hr@peopleco.in", role: "hr" });
    expect(hr2.role).toBe("hr");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("seats and billing", () => {
  it("employee logins use no team seat, members and pending invitations alike", async () => {
    // Starter allows 3 team members including pending invitations. Owner, HR, accountant and seller already fill
    // it (and the second HR invitation above); the two employees add nothing.
    const members = await cdb().select().from(tenantMembers).where(eq(tenantMembers.tenantId, tenant.id));
    expect(members.filter((m) => m.role === "employee")).toHaveLength(2);
    // A fresh organisation on the same plan: owner + 2 employee logins (one pending) leaves room for two invitations.
    const t = await createTenant({ name: "Seat Co", plan: "starter" });
    await grantAddon(t.id, "payroll");
    const o = await createUser({ email: "owner@seatco.in", name: "Seat Owner" });
    await addMember(t.id, o.id, "owner");
    const b = await createBusiness(db(), o.id, { name: "Seat Co" });
    await db().insert(businessMembers).values({ businessId: b.id, userId: o.id, role: "admin" });
    const oc = callerFor(o, t, b);
    const emps = [];
    for (const n of [1, 2, 3]) emps.push((await oc.payrollEmployee.create({ employeeCode: `S${n}`, name: `Seat ${n}`, dateOfJoining: "2026-04-01" })).id);
    await giveLogin(oc, t, b, emps[0]!, "seat1@example.in");
    await giveLogin(oc, t, b, emps[1]!, "seat2@example.in");
    await oc.payrollAccess.invite({ employeeId: emps[2]!, email: "seat3@example.in" }); // pending
    await expect(enforceTeamMemberLimit(t.id)).resolves.toBeUndefined();
    await oc.tenant.inviteMember({ email: "staff1@seatco.in", role: "seller" });
    await oc.tenant.inviteMember({ email: "staff2@seatco.in", role: "seller" });
    // The third staff invitation hits the limit (owner + two pending = 3), proving the three employee logins were not counted.
    await expect(oc.tenant.inviteMember({ email: "staff3@seatco.in", role: "seller" })).rejects.toMatchObject({ message: expect.stringContaining("team members") });
  });

  it("the same employee record is not counted twice for billing: the login adds no employee", async () => {
    const before = await hrC.payrollEmployee.list({ status: "active", page: 1, limit: 50 });
    expect(before.total).toBe(3);
    expect(before.data.map((e) => e.employeeCode).sort()).toEqual(["E001", "E002", "E003"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("employee isolation", () => {
  it("an employee reaches only the self-service procedures", async () => {
    const calls: Record<string, () => Promise<unknown>> = {
      "payrollEmployee.list": () => ashaC.payrollEmployee.list({ status: "active", page: 1, limit: 5 }),
      "payrollRun.list": () => ashaC.payrollRun.list(),
      "payrollLeave.applications": () => ashaC.payrollLeave.applications(),
      "payrollAttendance.month": () => ashaC.payrollAttendance.month({ month: "2026-10" }),
      "business.list": () => ashaC.business.list(),
      "tenant.members": () => ashaC.tenant.members(),
      "ai.settings": () => ashaC.ai.settings(),
      "payrollAccess.loginList": () => ashaC.payrollAccess.loginList(),
      "payrollPunch.punches": () => ashaC.payrollPunch.punches(),
    };
    for (const [name, call] of Object.entries(calls)) {
      const err = await call().then(() => null, (e) => e);
      expect(err?.code, `${name}: ${String(err?.message)}`).toBe("FORBIDDEN");
    }
    // Account-level procedures that are about the person themselves are still theirs.
    expect((await ashaC.auth.me()).role).toBe("employee");
    expect((await ashaC.tenant.current())?.name).toBe("People Co");
  });

  it("owners and other roles cannot use the self-service procedures", async () => {
    for (const c of [ownerC, hrC, accountantC, sellerC]) {
      await expect(c.payrollSelf.me()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.payrollSelf.payslips()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await ownerC.payrollSelf.workplaces()).toEqual([]);
  });

  it("an employee cannot open another business, and another organisation's data is out of reach", async () => {
    await expect(callerFor(asha, tenant, bizB).payrollSelf.me()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerFor(asha, tenantB, bizB).payrollSelf.me()).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The second business of the same organisation, which the employee was never given.
    await expect(callerFor(asha, tenant, biz2).payrollSelf.me()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the same person can be an employee in two businesses of one organisation, and leaving one keeps the other", async () => {
    const owner2C = createTestCaller({ userId: owner.id, email: owner.email, name: null, tenantId: tenant.id, businessId: biz2.id });
    const emp2 = await owner2C.payrollEmployee.create({ employeeCode: "E001", name: "Asha Verma", dateOfJoining: "2026-04-01" });
    const inv = await owner2C.payrollAccess.invite({ employeeId: emp2.id, email: "asha@example.in" });
    await ashaC.tenant.acceptInvitation({ token: tokenOf(inv.inviteUrl) });
    expect((await ashaC.payrollSelf.workplaces()).map((w) => w.businessName).sort()).toEqual(["People Co", "People Co Two"]);
    // Her role in the organisation is still the one employee role.
    const roles = await cdb().select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, asha.id)));
    expect(roles).toHaveLength(1);
    await owner2C.payrollAccess.revokeLogin({ employeeId: emp2.id });
    expect((await ashaC.payrollSelf.workplaces()).map((w) => w.businessName)).toEqual(["People Co"]);
    expect((await ashaC.payrollSelf.me()).employee.code).toBe("E001"); // still an employee of the first
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("check in and out", () => {
  const D1 = "2026-10-05"; // a Monday

  it("asks for consent first, and the consent is stored with its version", async () => {
    const me = await ashaC.payrollSelf.me();
    expect(me.consent).toMatchObject({ accepted: false, version: ATTENDANCE_CONSENT_VERSION });
    await expect(punch(ashaC, "in", `${D1}T09:02:00+05:30`)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(ashaC.payrollSelf.acceptConsent({ version: "old-wording" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await ashaC.payrollSelf.acceptConsent({ version: ATTENDANCE_CONSENT_VERSION });
    await ashaC.payrollSelf.acceptConsent({ version: ATTENDANCE_CONSENT_VERSION }); // idempotent
    expect((await ashaC.payrollSelf.me()).consent.accepted).toBe(true);
    await raviC.payrollSelf.acceptConsent({ version: ATTENDANCE_CONSENT_VERSION });
  });

  it("stamps the SERVER's time, keeps the phone's clock for reference, and refuses a wrong phone clock", async () => {
    setNow(`${D1}T09:02:00+05:30`);
    const phone = new Date(`${D1}T09:06:30+05:30`).getTime(); // 4.5 minutes fast: fine
    const r = await ashaC.payrollSelf.punch({ kind: "in", clientTime: phone, deviceId: "phone-1", consentVersion: ATTENDANCE_CONSENT_VERSION, selfie: PNG });
    expect(r).toMatchObject({ kind: "in", next: "out", workDate: D1, geofenceResult: "not_checked", warning: null });
    expect(r.punchedAt.toISOString()).toBe(new Date(`${D1}T09:02:00+05:30`).toISOString());
    const [row] = await db().select().from(employeePunches).where(eq(employeePunches.id, r.id));
    expect(row).toMatchObject({ source: "mobile", deviceId: "phone-1", employeeId: ids.asha, businessId: biz.id, reviewStatus: null });
    expect(row!.clientTime!.getTime()).toBe(phone);
    expect(row!.punchedAt.getTime()).not.toBe(phone);

    // A phone 11 minutes off (either way) is refused.
    setNow(`${D1}T09:30:00+05:30`);
    for (const skew of [11 * 60_000, -11 * 60_000]) {
      await expect(ashaC.payrollSelf.punch({ kind: "out", clientTime: Date.now() + skew - (Date.now() - punchClock.now().getTime()), deviceId: "phone-1", consentVersion: ATTENDANCE_CONSENT_VERSION, selfie: PNG })).rejects.toThrow(/date or time/);
    }
  });

  it("one open punch at a time, no double taps, a selfie when the business asks, and a closed day rolls up", async () => {
    await expect(punch(ashaC, "in", `${D1}T09:10:00+05:30`)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("09:02") });
    // A second tap within 30 seconds is a double tap.
    await expect(punch(ashaC, "out", `${D1}T09:02:20+05:30`)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    // The selfie is required, and must be a real image.
    await expect(punch(ashaC, "out", `${D1}T18:05:00+05:30`, { selfie: undefined })).rejects.toThrow(/selfie/);
    await expect(punch(ashaC, "out", `${D1}T18:05:00+05:30`, { selfie: "data:image/png;base64,AAAAAAAAAAAAAAAA" })).rejects.toBeTruthy();
    await expect(punch(ashaC, "out", `${D1}T18:05:00+05:30`, { selfie: "data:image/gif;base64,R0lGOD" })).rejects.toBeTruthy();

    const out = await punch(ashaC, "out", `${D1}T18:05:00+05:30`);
    expect(out).toMatchObject({ kind: "out", next: "in" });
    await expect(punch(ashaC, "out", `${D1}T18:10:00+05:30`)).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("not checked in") });

    // The day is in attendance, derived from the punches, with the shift rules (09:00 start, 15 minutes' grace).
    expect(await recordOf(ids.asha!, D1)).toMatchObject({ status: "present", checkIn: "09:02", checkOut: "18:05", source: "punch", overtimeHours: "0.00" });
    const month = await ashaC.payrollSelf.attendance({ month: "2026-10" });
    expect(month.days.find((d) => d.date === D1)).toMatchObject({ status: "present", checkIn: "09:02", checkOut: "18:05" });
    expect(month.days.find((d) => d.date === "2026-10-04")).toMatchObject({ weekOff: true }); // Sunday
    expect(month.punches.filter((p) => p.date === D1).map((p) => p.kind)).toEqual(["in", "out"]);
    expect(month.summary.present).toBe(1);
  });

  it("only the employee's own punches are visible to them, and a stranger's selfie is never reachable", async () => {
    await punch(raviC, "in", "2026-10-05T09:40:00+05:30", { deviceId: "ravi-phone" });
    await punch(raviC, "out", "2026-10-05T19:00:00+05:30");
    const mine = await ashaC.payrollSelf.attendance({ month: "2026-10" });
    const theirs = await raviC.payrollSelf.attendance({ month: "2026-10" });
    expect(mine.punches.every((p) => ["in", "out"].includes(p.kind))).toBe(true);
    expect(mine.punches).toHaveLength(2);
    expect(theirs.punches).toHaveLength(2);
    expect(new Set([...mine.punches, ...theirs.punches].map((p) => p.id)).size).toBe(4);
    // Ravi came in at 09:40: late by 40 minutes, recorded on his day.
    expect(await recordOf(ids.ravi!, D1)).toMatchObject({ status: "present", checkIn: "09:40", note: expect.stringContaining("Late by 40") });
    // No procedure takes a punch id for the employee, and the HR-only ones refuse the employee.
    await expect(ashaC.payrollPunch.selfie({ punchId: mine.punches[0]!.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("HR's own mark wins over derived attendance and later punches do not undo it", async () => {
    const D2 = "2026-10-06";
    await punch(ashaC, "in", `${D2}T09:00:00+05:30`);
    await punch(ashaC, "out", `${D2}T18:00:00+05:30`);
    expect((await recordOf(ids.asha!, D2))?.source).toBe("punch");
    await hrC.payrollAttendance.mark({ employeeId: ids.asha!, date: D2, status: "half_day", note: "Left early for a bank visit" });
    expect(await recordOf(ids.asha!, D2)).toMatchObject({ status: "half_day", source: "manual" });
    // A later punch pair for the same day (a correction by the device) does not touch HR's decision.
    await punch(ashaC, "in", `${D2}T19:00:00+05:30`);
    await punch(ashaC, "out", `${D2}T19:30:00+05:30`);
    expect(await recordOf(ids.asha!, D2)).toMatchObject({ status: "half_day", source: "manual" });
  });

  it("an overnight shift belongs to the day it started", async () => {
    const meena = await giveLogin(ownerC, tenant, biz, ids.meena!, "meena@example.in");
    const meenaC = callerFor(meena, tenant, biz);
    await meenaC.payrollSelf.acceptConsent({ version: ATTENDANCE_CONSENT_VERSION });
    await punch(meenaC, "in", "2026-10-07T22:05:00+05:30");
    await punch(meenaC, "out", "2026-10-08T06:10:00+05:30");
    expect(await recordOf(ids.meena!, "2026-10-07")).toMatchObject({ status: "present", checkIn: "22:05", checkOut: "06:10", source: "punch" });
    expect(await recordOf(ids.meena!, "2026-10-08")).toBeUndefined();
    expect((await meenaC.payrollSelf.me()).next).toBe("in");
  });

  it("a month locked by its payroll run never changes: the punch is saved, the attendance is not", async () => {
    const run = await hrC.payrollRun.create({ month: "2026-10" });
    await hrC.payrollRun.lockAttendance({ id: run.id, fillUnmarked: "present" });
    const D = "2026-10-20";
    const r = await punch(raviC, "in", `${D}T09:00:00+05:30`);
    await punch(raviC, "out", `${D}T18:00:00+05:30`);
    expect(r.id).toBeTruthy();
    expect((await recordOf(ids.ravi!, D))?.source).toBe("lock");
    expect(await db().select().from(employeePunches).where(and(eq(employeePunches.employeeId, ids.ravi!), eq(employeePunches.workDate, D)))).toHaveLength(2);
    await hrC.payrollRun.reopen({ id: run.id });
    await hrC.payrollRun.delete({ id: run.id });
  });

  it("the audit trail records the punch for the employee as actor, without coordinates or photos", async () => {
    const rows = (await db().select().from(auditLog).where(eq(auditLog.businessId, biz.id))).filter((a) => a.action === "payroll.punch.create");
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.some((a) => a.userId === asha.id)).toBe(true);
    const blob = JSON.stringify(rows);
    expect(blob).not.toMatch(/19\.07|72\.87|base64|iVBOR/);
    expect(rows[0]!.metadata).toContain("geofence");
  });

  it("is rate limited per employee", async () => {
    for (let i = 0; i < 40; i++) selfPunchLimiter.hit(ids.ravi!);
    await expect(punch(raviC, "in", "2026-10-21T09:00:00+05:30")).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("work locations and the geofence policy", () => {
  const D = "2026-12-07"; // a Monday
  let office: string;
  const HERE = { lat: 19.076, lng: 72.8777, accuracyM: 15 };
  const FAR = { lat: 19.1, lng: 72.9, accuracyM: 15 };

  it("HR sets up a location and who may punch there", async () => {
    const loc = await hrC.payrollPunch.locationCreate({ name: "Head office", lat: 19.076, lng: 72.8777, radiusM: 100 });
    office = loc.id;
    await expect(hrC.payrollPunch.locationCreate({ name: "x", lat: 120, lng: 0, radiusM: 100 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(hrC.payrollPunch.locationCreate({ name: "x", lat: 1, lng: 1, radiusM: 5 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await hrC.payrollPunch.locationList())[0]).toMatchObject({ name: "Head office", radiusM: 100, assignedEmployees: 0 });
    await expect(sellerC.payrollPunch.locationList()).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Another business's location cannot be assigned here.
    const foreign = await ownerBC.payrollPunch.locationCreate({ name: "Their site", lat: 1, lng: 1, radiusM: 100 });
    await expect(hrC.payrollPunch.locationAssign({ employeeId: ids.asha!, locationIds: [foreign.id] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await hrC.payrollPunch.locationAssign({ employeeId: ids.asha!, locationIds: [office] });
    expect(await hrC.payrollPunch.employeeLocations({ employeeId: ids.asha! })).toEqual([office]);
  });

  it("record only (the default): outside is saved, flagged for review, the employee is not blocked or warned", async () => {
    expect((await hrC.payrollPunch.settings()).geofencePolicy).toBe("record");
    const r = await punch(ashaC, "in", `${D}T09:00:00+05:30`, FAR);
    expect(r).toMatchObject({ geofenceResult: "outside", warning: null });
    const list = await hrC.payrollPunch.punches({ review: "pending" });
    const flagged = list.find((p) => p.id === r.id)!;
    expect(flagged).toMatchObject({ geofenceResult: "outside", flags: ["outside_geofence"], reviewStatus: "pending", locationName: "Head office", hasSelfie: true });
    expect(flagged.distanceM).toBeGreaterThan(1000);
    await punch(ashaC, "out", `${D}T18:00:00+05:30`, HERE);
    expect(await recordOf(ids.asha!, D)).toMatchObject({ status: "present" });
  });

  it("HR rejects the flagged punch: it no longer counts; an approved exception counts again", async () => {
    const pending = (await hrC.payrollPunch.punches({ review: "pending" })).find((p) => p.employeeId === ids.asha && p.workDate === D)!;
    await expect(accountantC.payrollPunch.review({ punchId: pending.id, decision: "reject" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ashaC.payrollPunch.review({ punchId: pending.id, decision: "approve" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const rejected = await hrC.payrollPunch.review({ punchId: pending.id, decision: "reject", note: "Was at a client site without telling HR" });
    expect(rejected).toMatchObject({ reviewStatus: "rejected", attendanceLocked: false });
    expect(await recordOf(ids.asha!, D)).toBeUndefined(); // the check-in was rejected: the day cannot be decided
    const approved = await hrC.payrollPunch.review({ punchId: pending.id, decision: "approve" });
    expect(approved.reviewStatus).toBe("approved");
    expect(await recordOf(ids.asha!, D)).toMatchObject({ status: "present", source: "punch" });
    await expect(hrC.payrollPunch.review({ punchId: (await hrC.payrollPunch.punches({ review: "all" })).find((p) => p.reviewStatus === null)!.id, decision: "approve" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const trail = (await db().select().from(auditLog).where(eq(auditLog.businessId, biz.id))).map((a) => a.action);
    expect(trail).toEqual(expect.arrayContaining(["payroll.punch.reject", "payroll.punch.approve"]));
  });

  it("warn tells the employee; block refuses a punch outside, with no location, or with a poor fix", async () => {
    await hrC.payrollPunch.updateSettings(settingsInput({ geofencePolicy: "warn" }));
    const w = await punch(ashaC, "in", "2026-12-08T09:00:00+05:30", FAR);
    expect(w.warning).toMatch(/outside the allowed area/);
    await punch(ashaC, "out", "2026-12-08T18:00:00+05:30", HERE);

    await hrC.payrollPunch.updateSettings(settingsInput({ geofencePolicy: "block" }));
    await expect(punch(ashaC, "in", "2026-12-09T09:00:00+05:30", FAR)).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Move to your work location") });
    await expect(punch(ashaC, "in", "2026-12-09T09:00:00+05:30", {})).rejects.toThrow(/location/i);
    await expect(punch(ashaC, "in", "2026-12-09T09:00:00+05:30", { ...HERE, accuracyM: 250 })).rejects.toThrow(/precise/);
    // Inside, with a good fix, is fine. The refused punches left nothing behind.
    await punch(ashaC, "in", "2026-12-09T09:00:00+05:30", HERE);
    expect(await db().select().from(employeePunches).where(and(eq(employeePunches.employeeId, ids.asha!), eq(employeePunches.workDate, "2026-12-09")))).toHaveLength(1);
    await punch(ashaC, "out", "2026-12-09T18:00:00+05:30", HERE);
  });

  it("off asks for nothing and stores no location even when one is sent", async () => {
    await hrC.payrollPunch.updateSettings(settingsInput({ geofencePolicy: "off", selfieRequired: false }));
    const r = await punch(ashaC, "in", "2026-12-10T09:00:00+05:30", { ...HERE, selfie: undefined });
    expect(r.geofenceResult).toBe("not_checked");
    const [row] = await db().select().from(employeePunches).where(eq(employeePunches.id, r.id));
    expect(row).toMatchObject({ lat: null, lng: null });
    expect(await db().select().from(employeePunchSelfies).where(eq(employeePunchSelfies.punchId, r.id))).toHaveLength(0);
    await punch(ashaC, "out", "2026-12-10T18:00:00+05:30", { selfie: undefined });
    await hrC.payrollPunch.updateSettings(settingsInput());
  });

  it("an employee with no assignment may punch at any active location; an inactive one is ignored", async () => {
    await hrC.payrollPunch.locationAssign({ employeeId: ids.asha!, locationIds: [] });
    await hrC.payrollPunch.locationUpdate({ id: office, isActive: false });
    // No active location at all: nothing to compare with, so nothing is checked.
    expect((await punch(ashaC, "in", "2026-12-11T09:00:00+05:30", FAR)).geofenceResult).toBe("not_checked");
    await punch(ashaC, "out", "2026-12-11T18:00:00+05:30", FAR);
    await hrC.payrollPunch.locationUpdate({ id: office, isActive: true });
    expect((await punch(ashaC, "in", "2026-12-14T09:00:00+05:30", HERE)).geofenceResult).toBe("inside");
    await punch(ashaC, "out", "2026-12-14T18:00:00+05:30", HERE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("selfies: private, retained for a set time, then deleted", () => {
  it("only HR, owners and admins can see a selfie; it is a data URL, never a public link", async () => {
    const some = (await hrC.payrollPunch.punches({ review: "all", limit: 5 })).find((p) => p.hasSelfie)!;
    const shot = await hrC.payrollPunch.selfie({ punchId: some.id });
    expect(shot.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    await ownerC.payrollPunch.selfie({ punchId: some.id });
    for (const c of [accountantC, sellerC, ashaC, raviC]) await expect(c.payrollPunch.selfie({ punchId: some.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ownerBC.payrollPunch.selfie({ punchId: some.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const c of [accountantC, sellerC, ashaC]) await expect(c.payrollPunch.punches()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the retention period deletes the photo and keeps the punch; shortening it purges at once", async () => {
    const before = await db().select().from(employeePunchSelfies);
    expect(before.length).toBeGreaterThan(3);
    const oldest = before[0]!;
    await db().update(employeePunchSelfies).set({ capturedAt: new Date(Date.now() - 100 * 86_400_000) }).where(eq(employeePunchSelfies.punchId, oldest.punchId));
    const deleted = await purgeExpiredSelfies(db(), new Date());
    expect(deleted).toBe(1);
    expect(await db().select().from(employeePunchSelfies).where(eq(employeePunchSelfies.punchId, oldest.punchId))).toHaveLength(0);
    expect(await db().select().from(employeePunches).where(eq(employeePunches.id, oldest.punchId))).toHaveLength(1);
    await expect(hrC.payrollPunch.selfie({ punchId: oldest.punchId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Seven days is the shortest retention; the setting purges straight away.
    await db().update(employeePunchSelfies).set({ capturedAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(employeePunchSelfies.punchId, before[1]!.punchId));
    const saved = await hrC.payrollPunch.updateSettings(settingsInput({ selfieRetentionDays: 7 }));
    expect(saved.purged).toBeGreaterThanOrEqual(1);
    await expect(hrC.payrollPunch.updateSettings(settingsInput({ selfieRetentionDays: 3 }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await hrC.payrollPunch.updateSettings(settingsInput());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("leave through self-service", () => {
  it("shows balances, takes an application, goes to HR for approval, and the employee is told", async () => {
    await hrC.payrollLeave.accrue({ month: "2026-10" });
    const notice = vi.spyOn(emailService, "sendNotice").mockResolvedValue();
    const ov = await ashaC.payrollSelf.leaveOverview();
    expect(ov.types.map((t) => t.code)).toEqual(["CL", "EL", "SL"]);
    expect(ov.types.find((t) => t.code === "CL")).toMatchObject({ balance: 12, isPaid: true });

    const app = await ashaC.payrollSelf.leaveApply({ leaveTypeId: ids.l_CL!, fromDate: "2026-11-02", toDate: "2026-11-02", reason: "Family function" });
    expect(app).toMatchObject({ status: "pending", employeeId: ids.asha, days: "1.00" });
    // HR and the owner are told; the recipients are the deciders, not the employee.
    expect(notice).toHaveBeenCalledWith(expect.stringMatching(/hema@peopleco\.in|owner@peopleco\.in/), expect.stringContaining("Leave request from Asha Verma"), expect.any(String));
    await expect(ashaC.payrollSelf.leaveApply({ leaveTypeId: ids.l_CL!, fromDate: "2026-11-02", toDate: "2026-11-02" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(ashaC.payrollSelf.leaveApply({ leaveTypeId: ids.l_CL!, fromDate: "2026-11-09", toDate: "2026-11-08" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    notice.mockClear();
    const decided = await hrC.payrollLeave.decide({ id: app.id, decision: "approve", note: "Enjoy" });
    expect(decided).toMatchObject({ status: "approved", paidDays: "1.00", lopDays: "0.00", decidedByUserId: hr.id });
    expect(notice).toHaveBeenCalledWith("asha@example.in", "Your leave request was approved", expect.stringContaining("Note from HR: Enjoy"));
    const after = await ashaC.payrollSelf.leaveOverview();
    expect(after.types.find((t) => t.code === "CL")!.balance).toBe(11);
    expect(after.applications[0]).toMatchObject({ id: app.id, status: "approved", decisionNote: "Enjoy" });
    expect(await recordOf(ids.asha!, "2026-11-02")).toMatchObject({ status: "leave", source: "leave" });
  });

  it("an employee cancels a pending application of their own, never an approved one, never someone else's", async () => {
    const mine = await ashaC.payrollSelf.leaveApply({ leaveTypeId: ids.l_CL!, fromDate: "2026-11-16", toDate: "2026-11-16" });
    const theirs = await raviC.payrollSelf.leaveApply({ leaveTypeId: ids.l_CL!, fromDate: "2026-11-17", toDate: "2026-11-17" });
    await expect(ashaC.payrollSelf.leaveCancel({ id: theirs.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await hrC.payrollLeave.applications({ status: "pending" })).some((a) => a.id === theirs.id)).toBe(true);
    expect(await ashaC.payrollSelf.leaveCancel({ id: mine.id })).toMatchObject({ status: "cancelled" });
    await expect(ashaC.payrollSelf.leaveCancel({ id: mine.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const approved = (await ashaC.payrollSelf.leaveOverview()).applications.find((a) => a.status === "approved")!;
    await expect(ashaC.payrollSelf.leaveCancel({ id: approved.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Ask HR") });
    // Another business's application id finds nothing either.
    await expect(callerFor(asha, tenant, biz).payrollSelf.leaveCancel({ id: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The employee sees only their own applications.
    expect((await raviC.payrollSelf.leaveOverview()).applications.map((a) => a.id)).toEqual([theirs.id]);
    await hrC.payrollLeave.decide({ id: theirs.id, decision: "reject", note: "Busy week" });
    expect((await raviC.payrollSelf.leaveOverview()).applications[0]).toMatchObject({ status: "rejected", decisionNote: "Busy week" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("HR prepares payroll, an owner approves; payslips and Form 16 reach employees only when final", () => {
  it("HR cannot approve or post; payslips are not shown before approval", async () => {
    const month = "2026-09";
    const dates = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
    await hrC.payrollAttendance.bulkMark({ employeeIds: [ids.asha!, ids.ravi!, ids.meena!], dates, status: "present" });
    const run = await hrC.payrollRun.create({ month });
    ids.run = run.id;
    await hrC.payrollRun.lockAttendance({ id: run.id });
    await hrC.payrollRun.calculate({ id: run.id });
    await hrC.payrollRun.submit({ id: run.id });
    expect((await ashaC.payrollSelf.payslips())).toEqual([]);
    await expect(ashaC.payrollSelf.payslipPdf({ runId: run.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(hrC.payrollRun.approve({ id: run.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hrC.payrollRun.post({ id: run.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hrC.payrollRun.markPaid({ runId: run.id, paidOn: "2026-10-01", bankAccountId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hrC.payrollStatutory.recordPayment({ runId: run.id, kind: "pf", paidOn: "2026-10-01", amount: 1, bankAccountId: "00000000-0000-4000-8000-000000000000" } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // HR sees masked identity numbers only, like an accountant.
    expect((await hrC.payrollEmployee.get({ id: ids.asha! })).sensitiveIncluded).toBe(false);
  });

  it("after approval each employee sees only their own frozen payslip", async () => {
    await ownerC.payrollRun.approve({ id: ids.run! });
    const mine = await ashaC.payrollSelf.payslips();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ runId: ids.run, month: "2026-09", number: "PS-2026-09-E001", monthLabel: "September 2026" });
    const theirs = await raviC.payrollSelf.payslips();
    expect(theirs.map((p) => p.number)).toEqual(["PS-2026-09-E002"]);
    const pdf = await ashaC.payrollSelf.payslipPdf({ runId: ids.run! });
    expect(pdf).toMatchObject({ filename: "PS-2026-09-E001.pdf", contentType: "application/pdf" });
    expect(Buffer.from(pdf.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    // Not a draft: a draft payslip carries no "draft" marker and the run's number is the frozen one.
    await expect(ashaC.payrollSelf.payslipPdf({ runId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Another organisation cannot reach it, with the same id.
    await expect(callerFor(asha, tenantB, bizB).payrollSelf.payslipPdf({ runId: ids.run! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ownerBC.payrollRun.payslipPdf({ runId: ids.run!, employeeId: ids.asha! })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("an owner posts to the books; HR still cannot", async () => {
    const posted = await ownerC.payrollRun.post({ id: ids.run! });
    expect(posted.created).toBe(true);
    await expect(hrC.payrollRun.post({ id: ids.run! })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("Form 16 is available to an employee only when HR has released the year, as a labelled working copy", async () => {
    expect(await ashaC.payrollSelf.form16Years()).toEqual([]);
    await expect(ashaC.payrollSelf.form16Pdf({ financialYear: 2026 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await hrC.payrollAccess.form16List()).find((y) => y.financialYear === 2026)).toMatchObject({ label: "2026-27", released: false });
    await expect(sellerC.payrollAccess.form16Release({ financialYear: 2026 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await hrC.payrollAccess.form16Release({ financialYear: 2026 });
    await hrC.payrollAccess.form16Release({ financialYear: 2026 }); // idempotent
    expect((await ashaC.payrollSelf.form16Years()).map((y) => y.financialYear)).toEqual([2026]);
    const f = await ashaC.payrollSelf.form16Pdf({ financialYear: 2026 });
    expect(f.label.toLowerCase()).toContain("working copy");
    expect(Buffer.from(f.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    expect(f.filename).toContain("E001"); // always her own
    // A year she has no payroll in is not available even when released.
    await hrC.payrollAccess.form16Release({ financialYear: 2030 });
    expect((await ashaC.payrollSelf.form16Years()).map((y) => y.financialYear)).toEqual([2026]);
    await expect(ashaC.payrollSelf.form16Pdf({ financialYear: 2030 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await hrC.payrollAccess.form16Unrelease({ financialYear: 2026 });
    expect(await ashaC.payrollSelf.form16Years()).toEqual([]);
    await expect(ashaC.payrollSelf.form16Pdf({ financialYear: 2026 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("add-on and read-only rules", () => {
  it("an employee of an organisation without the add-on is refused with the add-on error", async () => {
    const t = await createTenant({ name: "Lapsed Co" });
    await grantAddon(t.id, "payroll");
    const o = await createUser({ email: "owner@lapsed.in", name: "Lapsed Owner" });
    await addMember(t.id, o.id, "owner");
    const b = await createBusiness(db(), o.id, { name: "Lapsed Co" });
    await db().insert(businessMembers).values({ businessId: b.id, userId: o.id, role: "admin" });
    const oc = callerFor(o, t, b);
    const e = await oc.payrollEmployee.create({ employeeCode: "L1", name: "Lapsed Emp", dateOfJoining: "2026-04-01" });
    const u = await giveLogin(oc, t, b, e.id, "lapsed.emp@example.in");
    const uc = callerFor(u, t, b);
    expect((await uc.payrollSelf.me()).employee.code).toBe("L1");
    // The add-on ends (cancelled) and the trial is not running: reads and writes are both refused.
    await cdb().execute(await import("drizzle-orm").then((m) => m.sql`UPDATE billing_subscriptions SET status = 'cancelled' WHERE tenant_id = ${t.id} AND kind = 'addon'`));
    invalidateEntitlements(t.id);
    for (const call of [() => uc.payrollSelf.me(), () => uc.payrollSelf.payslips(), () => uc.payrollSelf.acceptConsent({ version: ATTENDANCE_CONSENT_VERSION }), () => uc.payrollSelf.workplaces()]) {
      const err = await call().then(() => null, (x) => x);
      expect(reasonOf(err)).toBe("addon_required");
    }
  });

  it("a read-only organisation (trial over) lets employees read but not punch or apply", async () => {
    const t = await createTenant({ name: "Over Co", trialStartedAt: new Date(Date.now() - 20 * 86_400_000), trialEndsAt: new Date(Date.now() - 86_400_000), trialSource: "signup" });
    const o = await createUser({ email: "owner@over.in", name: "Over Owner" });
    await addMember(t.id, o.id, "owner");
    const b = await createBusiness(db(), o.id, { name: "Over Co" });
    await db().insert(businessMembers).values({ businessId: b.id, userId: o.id, role: "admin" });
    // The link rows are made directly: the owner cannot invite while read-only.
    const { employees } = await import("@fintranzact/db");
    const [emp] = await db().insert(employees).values({ businessId: b.id, employeeCode: "O1", name: "Over Emp", dateOfJoining: "2026-04-01" }).returning();
    const u = await createUser({ email: "over.emp@example.in", name: "Over Emp" });
    await addMember(t.id, u.id, "employee");
    await db().insert(businessMembers).values({ businessId: b.id, userId: u.id, role: "member" });
    await db().insert(employeeLogins).values({ businessId: b.id, employeeId: emp!.id, userId: u.id });
    const uc = callerFor(u, t, b);
    expect(await uc.payrollSelf.payslips()).toEqual([]);
    const err = await uc.payrollSelf.acceptConsent({ version: ATTENDANCE_CONSENT_VERSION }).then(() => null, (x) => x);
    expect(err).toMatchObject({ code: "FORBIDDEN" });
    expect(reasonOf(err)).toBe("read_only_trial_expired");
    invalidateEntitlements(t.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("termination and removal end access", () => {
  it("marking an employee as exited disables the login: sessions lose the organisation, the link goes", async () => {
    expect((await raviC.payrollSelf.me()).employee.code).toBe("E002");
    await hrC.payrollEmployee.exit({ id: ids.ravi!, lastWorkingDay: "2026-10-30", reason: "resignation" });
    expect(await db().select().from(employeeLogins).where(eq(employeeLogins.employeeId, ids.ravi!))).toHaveLength(0);
    expect(await cdb().select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, ravi.id)))).toHaveLength(0);
    expect(await db().select().from(businessMembers).where(eq(businessMembers.userId, ravi.id))).toHaveLength(0);
    const err = await raviC.payrollSelf.me().then(() => null, (x) => x);
    expect(err).toMatchObject({ code: "FORBIDDEN" });
    expect((await hrC.payrollAccess.loginList()).some((e) => e.employeeId === ids.ravi)).toBe(false); // an exited employee leaves the list
    const trail = (await db().select().from(auditLog).where(eq(auditLog.businessId, biz.id))).map((a) => a.action);
    expect(trail).toContain("payroll.employeeLogin.revokeOnExit");
  });

  it("HR can remove a login; a pending invitation is cancelled; the person can be invited again", async () => {
    const inv = await hrC.payrollAccess.invite({ employeeId: ids.meena!, email: "meena.new@example.in" }).catch(async () => null);
    // Meena already has a login (above): removing it works, and re-inviting gives a new link.
    const r = await hrC.payrollAccess.revokeLogin({ employeeId: ids.meena! });
    expect(r.revoked).toBe(true);
    void inv;
    const again = await hrC.payrollAccess.invite({ employeeId: ids.meena!, email: "meena.new@example.in" });
    expect(again.replaced).toBe(false);
    const rv = await hrC.payrollAccess.revokeLogin({ employeeId: ids.meena! });
    expect(rv).toMatchObject({ revoked: false, invitationsExpired: 1 });
    const stale = await createUser({ email: "meena.new@example.in", name: "Meena New" });
    await expect(callerFor(stale, tenant, biz).tenant.acceptInvitation({ token: tokenOf(again.inviteUrl) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(sellerC.payrollAccess.revokeLogin({ employeeId: ids.meena! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ownerBC.payrollAccess.revokeLogin({ employeeId: ids.meena! })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("removing the person from the Team page leaves no usable link behind", async () => {
    await ownerC.tenant.removeMember({ userId: asha.id });
    await expect(ashaC.payrollSelf.me()).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The stale link does not block a new invitation.
    const inv = await hrC.payrollAccess.invite({ employeeId: ids.asha!, email: "asha@example.in" });
    const back = callerFor(asha, tenant, biz);
    await back.tenant.acceptInvitation({ token: tokenOf(inv.inviteUrl) });
    expect((await back.payrollSelf.me()).employee.code).toBe("E001");
  });
});
