/**
 * payroll-aadhaar-encryption.test.ts — an employee's Aadhaar number is encrypted at rest.
 *
 * Invariants:
 *   1. The column never holds the digits once a key is configured; the API still returns
 *      them in full to a role with Payroll "manage" and masked to everyone else.
 *   2. Editing other fields leaves the stored value alone; changing or clearing it works.
 *   3. A number saved before encryption existed (plain digits) still reads.
 *   4. A value no configured key opens never reaches a response as ciphertext.
 *   5. The self-export leaves the number out (its ciphertext is useless on another server).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, businessMembers, employees } from "@fintranzact/db";
import { isEncrypted } from "@fintranzact/db";
import { createTenant, createUser, addMember, createBusiness, grantAddon, type TestUser, type TestTenant, type TestBusiness } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { TABLE_REGISTRY } from "../../lib/tableRegistry.js";

const db = () => getTenantTestDb();
type Caller = ReturnType<typeof createTestCaller>;
const callerFor = (u: TestUser, t: TestTenant, b: TestBusiness): Caller =>
  createTestCaller({ userId: u.id, email: u.email, name: u.name ?? null, tenantId: t.id, businessId: b.id });

const KEY_A = "aa".repeat(32);
const KEY_B = "bb".repeat(32);
const AADHAAR = "234567890123";
const OTHER_AADHAAR = "345678901234";

let tenant: TestTenant;
let biz: TestBusiness;
let ownerC: Caller;
let accountantC: Caller;
let employeeId: string;
const savedKey = process.env.ENCRYPTION_KEY;

const rawAadhaar = async (): Promise<string | null> => {
  const [row] = await db().select({ a: employees.aadhaar }).from(employees).where(eq(employees.id, employeeId));
  return row!.a;
};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = KEY_A;
  tenant = await createTenant({ name: "Aadhaar Co" });
  const owner = await createUser({ email: "owner@aadhaarco.in", name: "Ramesh Kumar" });
  await addMember(tenant.id, owner.id, "owner");
  biz = await createBusiness(db(), owner.id, { name: "Aadhaar Co" });
  await db().insert(businessMembers).values({ businessId: biz.id, userId: owner.id, role: "admin" });
  const acct = await createUser({ email: "anita@aadhaarco.in", name: "Anita" });
  await addMember(tenant.id, acct.id, "accountant");
  await db().insert(businessMembers).values({ businessId: biz.id, userId: acct.id, role: "member" });
  await grantAddon(tenant.id, "payroll");
  ownerC = callerFor(owner, tenant, biz);
  accountantC = callerFor(acct, tenant, biz);
}, 120_000);

afterAll(async () => {
  if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = savedKey;
  await truncateAllTables();
  await closeTestDb();
});

describe("Aadhaar numbers are encrypted at rest", () => {
  it("stores ciphertext, returns the number in full to the owner and masked to an accountant", async () => {
    const e = await ownerC.payrollEmployee.create({ employeeCode: "A001", name: "Asha Verma", dateOfJoining: "2026-04-01", aadhaar: "2345 6789 0123" });
    employeeId = e.id;
    expect(e).toMatchObject({ aadhaar: AADHAAR, aadhaarMasked: "XXXXXXXX0123", sensitiveIncluded: true });

    const raw = await rawAadhaar();
    expect(raw).not.toBeNull();
    expect(isEncrypted(raw!)).toBe(true);
    expect(raw).not.toContain(AADHAAR);
    expect(raw).not.toContain("0123");

    expect(await ownerC.payrollEmployee.get({ id: employeeId })).toMatchObject({ aadhaar: AADHAAR, aadhaarMasked: "XXXXXXXX0123" });
    const masked = await accountantC.payrollEmployee.get({ id: employeeId });
    expect(masked).toMatchObject({ aadhaar: null, aadhaarMasked: "XXXXXXXX0123", sensitiveIncluded: false });
    expect(JSON.stringify(masked)).not.toContain(AADHAAR);
    expect(JSON.stringify(await ownerC.payrollEmployee.list({ status: "active", page: 1, limit: 10 }))).not.toContain(AADHAAR);
  });

  it("leaves the stored value alone when other fields change, and replaces or clears it on request", async () => {
    const before = await rawAadhaar();
    await ownerC.payrollEmployee.update({ id: employeeId, name: "Asha V", branch: "Pune" });
    expect(await rawAadhaar()).toBe(before);

    await ownerC.payrollEmployee.update({ id: employeeId, aadhaar: OTHER_AADHAAR });
    const changed = await rawAadhaar();
    expect(isEncrypted(changed!)).toBe(true);
    expect(changed).not.toBe(before);
    expect(await ownerC.payrollEmployee.get({ id: employeeId })).toMatchObject({ aadhaar: OTHER_AADHAAR });

    await ownerC.payrollEmployee.update({ id: employeeId, aadhaar: "" });
    expect(await rawAadhaar()).toBeNull();
    expect(await ownerC.payrollEmployee.get({ id: employeeId })).toMatchObject({ aadhaar: null, aadhaarMasked: null });
  });

  it("never puts the number in the audit trail", async () => {
    await ownerC.payrollEmployee.update({ id: employeeId, aadhaar: AADHAAR });
    const blob = JSON.stringify(await db().select().from(auditLog).where(eq(auditLog.businessId, biz.id)));
    expect(blob).not.toContain(AADHAAR);
    expect(blob).not.toContain(OTHER_AADHAAR);
  });

  it("still reads a number saved as plain digits before encryption was added", async () => {
    await db().update(employees).set({ aadhaar: OTHER_AADHAAR }).where(eq(employees.id, employeeId));
    expect(await ownerC.payrollEmployee.get({ id: employeeId })).toMatchObject({ aadhaar: OTHER_AADHAAR, aadhaarMasked: "XXXXXXXX1234" });
  });

  it("never returns ciphertext when the key that wrote it is not configured", async () => {
    await ownerC.payrollEmployee.update({ id: employeeId, aadhaar: AADHAAR });
    const stored = (await rawAadhaar())!;
    process.env.ENCRYPTION_KEY = KEY_B;
    try {
      const res = await ownerC.payrollEmployee.get({ id: employeeId });
      expect(res).toMatchObject({ aadhaar: null, aadhaarMasked: null });
      expect(JSON.stringify(res)).not.toContain(stored);
    } finally {
      process.env.ENCRYPTION_KEY = KEY_A;
    }
    expect(await ownerC.payrollEmployee.get({ id: employeeId })).toMatchObject({ aadhaar: AADHAAR });
  });
});

describe("the self-export", () => {
  it("leaves the Aadhaar column out of the employees table", () => {
    const entry = TABLE_REGISTRY.find((t) => t.tableName === "employees");
    expect(entry?.redactedFields).toContain("aadhaar");
  });
});
