/**
 * payroll-attendance-import.test.ts — biometric device attendance import (Payroll Phase 3): file import with a
 * column mapping and preview, idempotency, unknown codes and bad rows, direction handling, rollup into daily
 * attendance, undo, and the device push endpoint (key auth, add-on, read-only, size and rate limits).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { attendanceRecords, attendanceDeviceKeys, auditLog, businessMembers, employeePunches } from "@fintranzact/db";
import { createTenant, createUser, addMember, createBusiness, grantAddon, type TestUser, type TestTenant, type TestBusiness } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { registerAttendancePushRoute, resetAttendancePushLimits } from "../../http/attendancePush.js";
import { importLimiter } from "../../routers/payrollImport.js";
import { invalidateEntitlements } from "../../lib/entitlements.js";
import { punchClock } from "../../lib/payroll/punches.js";

const db = () => getTenantTestDb();
type Caller = ReturnType<typeof createTestCaller>;
const callerFor = (u: TestUser, t: TestTenant, b: TestBusiness): Caller => createTestCaller({ userId: u.id, email: u.email, name: u.name ?? null, tenantId: t.id, businessId: b.id });

let tenant: TestTenant;
let biz: TestBusiness;
let owner: TestUser;
let accountant: TestUser;
let seller: TestUser;
let ownerC: Caller;
let accountantC: Caller;
let sellerC: Caller;
const ids: Record<string, string> = {};
let app: Hono;
// The import refuses punches more than a day in the future; the dates below run to the end of October 2026.
const realNow = punchClock.now;

const MAPPING = { employeeCode: 0, date: 1, time: 2, direction: 3, deviceId: 4, hasHeader: true, dateOrder: "dmy" as const };
const header = ["Employee Code", "Date", "Time", "In/Out", "Device"];
const rowsOf = (...r: string[][]) => [header, ...r];
const recordOf = async (employeeId: string, date: string) => (await db().select().from(attendanceRecords).where(and(eq(attendanceRecords.employeeId, employeeId), eq(attendanceRecords.date, date))))[0];

async function push(key: string | null, body: unknown, headers: Record<string, string> = {}) {
  return app.request("/api/attendance/push", {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeAll(async () => {
  tenant = await createTenant({ name: "Device Co" });
  await grantAddon(tenant.id, "payroll");
  owner = await createUser({ email: "owner@deviceco.in", name: "Dev Owner" });
  await addMember(tenant.id, owner.id, "owner");
  biz = await createBusiness(db(), owner.id, { name: "Device Co" });
  await db().insert(businessMembers).values({ businessId: biz.id, userId: owner.id, role: "admin" });
  accountant = await createUser({ email: "acc@deviceco.in", name: "Acc" });
  await addMember(tenant.id, accountant.id, "accountant");
  await db().insert(businessMembers).values({ businessId: biz.id, userId: accountant.id, role: "member" });
  seller = await createUser({ email: "sell@deviceco.in", name: "Sell" });
  await addMember(tenant.id, seller.id, "seller");
  await db().insert(businessMembers).values({ businessId: biz.id, userId: seller.id, role: "member" });
  ownerC = callerFor(owner, tenant, biz);
  accountantC = callerFor(accountant, tenant, biz);
  sellerC = callerFor(seller, tenant, biz);
  const night = await ownerC.payrollEmployee.shiftCreate({ name: "Night", startTime: "22:00", endTime: "06:00", weeklyOffDays: [0], standardHours: 8 });
  const day = await ownerC.payrollEmployee.shiftCreate({ name: "Day", startTime: "09:00", endTime: "18:00", weeklyOffDays: [0], standardHours: 8 });
  for (const [key, code, shiftId] of [["a", "E001", day.id], ["b", "E002", day.id], ["n", "N001", night.id]] as const) {
    ids[key] = (await ownerC.payrollEmployee.create({ employeeCode: code, name: `Emp ${code}`, dateOfJoining: "2026-04-01", shiftId })).id;
  }
  app = new Hono();
  registerAttendancePushRoute(app);
  punchClock.now = () => new Date("2026-11-30T12:00:00+05:30");
}, 120_000);

afterAll(async () => {
  punchClock.now = realNow;
  await truncateAllTables();
  await closeTestDb();
});

beforeEach(() => {
  importLimiter.clear();
  resetAttendancePushLimits();
});

describe("file import", () => {
  it("previews without writing: counts, unknown codes, unreadable rows", async () => {
    const rows = rowsOf(
      ["E001", "05/10/2026", "09:01:10", "IN", "gate-1"],
      ["E001", "05/10/2026", "18:02:00", "OUT", "gate-1"],
      ["E999", "05/10/2026", "09:00:00", "IN", "gate-1"],
      ["E002", "not a date", "09:00:00", "IN", "gate-1"],
      ["", "05/10/2026", "09:00:00", "IN", "gate-1"],
    );
    const p = await ownerC.payrollImport.preview({ rows, mapping: MAPPING });
    expect(p.summary).toMatchObject({ rows: 5, imported: 2, duplicates: 0, unknownEmployees: 1, invalid: 2 });
    expect(p.unknown).toEqual([{ code: "E999", rows: [4] }]);
    expect(p.errors.map((e) => e.row)).toEqual([5, 6]);
    expect(p).toMatchObject({ fromDate: "2026-10-05", toDate: "2026-10-05", batchId: null, totalRows: 5 });
    expect(p.sample[0]).toMatchObject({ employeeCode: "E001", direction: "in", deviceId: "gate-1" });
    expect(await db().select().from(employeePunches)).toHaveLength(0);
  });

  it("imports, rolls the day up, and is idempotent", async () => {
    const rows = rowsOf(
      ["E001", "05/10/2026", "09:01:10", "IN", "gate-1"],
      ["E001", "05/10/2026", "18:02:00", "OUT", "gate-1"],
      ["E002", "05/10/2026", "09:20:00", "", "gate-1"],
      ["E002", "05/10/2026", "13:30:00", "", "gate-1"],
      ["E999", "05/10/2026", "09:00:00", "IN", "gate-1"],
    );
    const first = await ownerC.payrollImport.commit({ rows, mapping: MAPPING, fileName: "october.csv" });
    expect(first.summary).toMatchObject({ rows: 5, imported: 4, duplicates: 0, unknownEmployees: 1, rolledUp: 2 });
    ids.batch1 = first.batchId!;
    expect(await recordOf(ids.a!, "2026-10-05")).toMatchObject({ status: "present", checkIn: "09:01", checkOut: "18:02", source: "punch" });
    // Auto directions alternate (in, out): 4h10 is a half day for an 8-hour shift.
    expect(await recordOf(ids.b!, "2026-10-05")).toMatchObject({ status: "half_day", checkIn: "09:20", checkOut: "13:30" });
    const stored = await db().select().from(employeePunches).where(eq(employeePunches.employeeId, ids.b!));
    expect(stored.map((s) => s.kind).sort()).toEqual(["in", "out"]);
    expect(stored[0]).toMatchObject({ source: "biometric", deviceId: "gate-1", geofenceResult: "not_checked", importBatchId: first.batchId, lat: null });

    // The same file again: nothing new, nothing changes.
    const again = await ownerC.payrollImport.commit({ rows, mapping: MAPPING, fileName: "october.csv" });
    expect(again.summary).toMatchObject({ imported: 0, duplicates: 4, unknownEmployees: 1 });
    expect(await db().select().from(employeePunches)).toHaveLength(4);
    const hist = await ownerC.payrollImport.history();
    expect(hist).toHaveLength(2);
    expect(hist.find((h) => h.id === first.batchId)).toMatchObject({ source: "file", fileName: "october.csv", status: "applied", fromDate: "2026-10-05", toDate: "2026-10-05" });
    const trail = (await db().select().from(auditLog).where(eq(auditLog.businessId, biz.id))).filter((a) => a.action === "payroll.attendance.import");
    expect(trail).toHaveLength(2);
    expect(trail[0]!.metadata).toContain("imported");
  });

  it("handles an overnight shift (the day of the check-in), same-time duplicates from two devices, and a time zone", async () => {
    const rows = rowsOf(
      ["N001", "06/10/2026", "22:03:00", "IN", "gate-1"],
      ["N001", "07/10/2026", "06:05:00", "OUT", "gate-1"],
      // The same instant on a second device is its own punch (the key includes the device), then ignored as a double tap.
      ["N001", "07/10/2026", "06:05:00", "OUT", "gate-2"],
    );
    const r = await ownerC.payrollImport.commit({ rows, mapping: MAPPING });
    expect(r.summary).toMatchObject({ imported: 3, duplicates: 0 });
    expect(await recordOf(ids.n!, "2026-10-06")).toMatchObject({ status: "present", checkIn: "22:03", checkOut: "06:05", source: "punch" });
    expect(await recordOf(ids.n!, "2026-10-07")).toBeUndefined();
    // Stored as IST: 22:03 IST is 16:33 UTC.
    const first = (await db().select().from(employeePunches).where(eq(employeePunches.employeeId, ids.n!))).sort((a, b) => a.punchedAt.getTime() - b.punchedAt.getTime())[0]!;
    expect(first.punchedAt.toISOString()).toBe("2026-10-06T16:33:00.000Z");
  });

  it("never overwrites HR's own marks, and reports days locked by a payroll run", async () => {
    await ownerC.payrollAttendance.mark({ employeeId: ids.a!, date: "2026-10-12", status: "absent", note: "Unauthorised" });
    const rows = rowsOf(["E001", "12/10/2026", "09:00:00", "IN", "gate-1"], ["E001", "12/10/2026", "18:00:00", "OUT", "gate-1"]);
    await ownerC.payrollImport.commit({ rows, mapping: MAPPING });
    expect(await recordOf(ids.a!, "2026-10-12")).toMatchObject({ status: "absent", source: "manual" });

    const run = await ownerC.payrollRun.create({ month: "2026-10" });
    await ownerC.payrollRun.lockAttendance({ id: run.id, fillUnmarked: "present" });
    const locked = await ownerC.payrollImport.commit({ rows: rowsOf(["E002", "13/10/2026", "09:00:00", "IN", "gate-1"], ["E002", "13/10/2026", "18:00:00", "OUT", "gate-1"]), mapping: MAPPING });
    expect(locked.summary).toMatchObject({ imported: 2, rolledUp: 0, lockedDays: 1 });
    expect(locked.lockedDates).toEqual(["2026-10-13"]);
    expect((await recordOf(ids.b!, "2026-10-13"))?.source).toBe("lock");
    // Undo is refused while the month is locked; after reopening it works.
    await expect(ownerC.payrollImport.undo({ batchId: locked.batchId! })).rejects.toThrow(/locked/);
    await ownerC.payrollRun.reopen({ id: run.id });
    await ownerC.payrollRun.delete({ id: run.id });
  });

  it("undo removes the import's punches and recomputes the days; the history shows it", async () => {
    const before = await db().select().from(employeePunches).where(eq(employeePunches.importBatchId, ids.batch1!));
    expect(before.length).toBe(4);
    const r = await ownerC.payrollImport.undo({ batchId: ids.batch1! });
    expect(r.removed).toBe(4);
    expect(await db().select().from(employeePunches).where(eq(employeePunches.importBatchId, ids.batch1!))).toHaveLength(0);
    expect(await recordOf(ids.a!, "2026-10-05")).toBeUndefined(); // the derived day goes with its punches
    expect((await ownerC.payrollImport.history()).find((h) => h.id === ids.batch1)).toMatchObject({ status: "undone" });
    await expect(ownerC.payrollImport.undo({ batchId: ids.batch1! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Replace = undo, then import the corrected file.
    const redo = await ownerC.payrollImport.commit({ rows: rowsOf(["E001", "05/10/2026", "09:00:00", "IN", "gate-1"], ["E001", "05/10/2026", "18:30:00", "OUT", "gate-1"]), mapping: MAPPING });
    expect(redo.summary.imported).toBe(2);
    expect(await recordOf(ids.a!, "2026-10-05")).toMatchObject({ checkOut: "18:30" });
    await expect(ownerC.payrollImport.undo({ batchId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses an empty file, rows with no readable punch, and a missing date column; limits the rate", async () => {
    await expect(ownerC.payrollImport.commit({ rows: rowsOf(["E001", "garbage", "x", "IN", "g"]), mapping: MAPPING })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("nothing to import") });
    await expect(ownerC.payrollImport.preview({ rows: rowsOf(["E001", "05/10/2026", "09:00", "IN", "g"]), mapping: { employeeCode: 0, hasHeader: true, dateOrder: "dmy" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (let i = 0; i < 10; i++) importLimiter.hit(owner.id);
    await expect(ownerC.payrollImport.preview({ rows: rowsOf(["E001", "05/10/2026", "09:00:00", "IN", "g"]), mapping: MAPPING })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("is a payroll write: accountants may, sellers may not; another business's employees are unknown codes", async () => {
    await expect(sellerC.payrollImport.history()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sellerC.payrollImport.commit({ rows: rowsOf(["E001", "05/10/2026", "09:00:00", "IN", "g"]), mapping: MAPPING })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const a = await accountantC.payrollImport.preview({ rows: rowsOf(["E001", "20/10/2026", "09:00:00", "IN", "g"]), mapping: MAPPING });
    expect(a.summary.imported).toBe(1);
  });
});

describe("device push endpoint", () => {
  let key: string;

  it("HR makes a key (shown once, stored as a hash), and can list and revoke it", async () => {
    const made = await ownerC.payrollPunch.deviceKeyCreate({ name: "Gate terminal" });
    key = made.key;
    expect(key).toMatch(new RegExp(`^fdk_${tenant.id}_[0-9a-f]{48}$`));
    const rows = await db().select().from(attendanceDeviceKeys);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.keyHash).not.toContain(key.slice(-20));
    const list = await ownerC.payrollPunch.deviceKeyList();
    expect(list[0]).toMatchObject({ name: "Gate terminal", revokedAt: null });
    expect(JSON.stringify(list)).not.toContain(key.slice(-20));
    await expect(sellerC.payrollPunch.deviceKeyCreate({ name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects missing, malformed, unknown and cross-organisation keys with 401", async () => {
    const body = { punches: [{ employeeCode: "E001", timestamp: "2026-11-02 09:00:00" }] };
    expect((await push(null, body)).status).toBe(401);
    expect((await push("nonsense", body)).status).toBe(401);
    expect((await push(`fdk_${tenant.id}_${"0".repeat(48)}`, body)).status).toBe(401);
    const other = await createTenant({ name: "Other Device Org" });
    expect((await push(key.replace(tenant.id, other.id), body)).status).toBe(401);
  });

  it("accepts a batch, is idempotent, reports unknown codes and bad timestamps, and updates attendance", async () => {
    const body = {
      punches: [
        { employeeCode: "E001", timestamp: "2026-11-02 09:00:00", direction: "in" },
        { employeeCode: "E001", timestamp: "2026-11-02T18:10:00+05:30", direction: "out", deviceId: "mw-1" },
        { employeeCode: "NOPE", timestamp: "2026-11-02 09:00:00" },
        { employeeCode: "E002", timestamp: "yesterday" },
      ],
    };
    const res = await push(key, body);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { batchId: string; summary: Record<string, number>; unknown: Array<{ code: string }>; rejected: Array<{ index: number }> };
    expect(json.summary).toMatchObject({ imported: 2, unknownEmployees: 1, invalid: 1 });
    expect(json.unknown[0]!.code).toBe("NOPE");
    expect(json.rejected).toEqual([{ index: 3, reason: "timestamp could not be read" }]);
    expect(await recordOf(ids.a!, "2026-11-02")).toMatchObject({ status: "present", checkIn: "09:00", checkOut: "18:10" });
    const again = (await (await push(key, body)).json()) as { summary: Record<string, number> };
    expect(again.summary).toMatchObject({ imported: 0, duplicates: 2 });
    const hist = await ownerC.payrollImport.history();
    expect(hist.filter((h) => h.source === "device")).toHaveLength(2);
    expect((await ownerC.payrollPunch.deviceKeyList())[0]!.lastUsedAt).not.toBeNull();
    const trail = (await db().select().from(auditLog).where(eq(auditLog.businessId, biz.id))).filter((a) => a.action === "payroll.attendance.devicePush");
    expect(trail.length).toBe(2);
    expect(JSON.stringify(trail)).not.toContain(key.slice(-20));
  });

  it("validates the body: at most 500 punches, a body size cap, JSON only", async () => {
    const one = { employeeCode: "E001", timestamp: "2026-11-03 09:00:00" };
    expect((await push(key, { punches: [] })).status).toBe(400);
    expect((await push(key, { punches: Array.from({ length: 501 }, (_, i) => ({ ...one, timestamp: `2026-11-03 09:${String(i % 60).padStart(2, "0")}:00` })) })).status).toBe(400);
    expect((await push(key, "not json")).status).toBe(400);
    expect((await push(key, { punches: [{ employeeCode: "E001", timestamp: "2026-11-03 09:00:00", direction: "sideways" }] })).status).toBe(400);
    const huge = JSON.stringify({ punches: [{ ...one, deviceId: "x".repeat(300_000) }] });
    expect((await push(key, huge, { "content-length": String(huge.length) })).status).toBe(413);
    const ok = await push(key, { punches: Array.from({ length: 500 }, (_, i) => ({ employeeCode: "E002", timestamp: `2026-11-03 ${String(Math.floor(i / 60) + 6).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00` })) });
    expect(ok.status).toBe(200);
  });

  it("is rate limited per key", async () => {
    const body = { punches: [{ employeeCode: "E001", timestamp: "2026-11-04 09:00:00" }] };
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await push(key, body)).status;
    expect(last).toBe(429);
  });

  it("stops working when the key is revoked", async () => {
    const [{ id }] = await ownerC.payrollPunch.deviceKeyList();
    await ownerC.payrollPunch.deviceKeyRevoke({ id: id! });
    expect((await push(key, { punches: [{ employeeCode: "E001", timestamp: "2026-11-05 09:00:00" }] })).status).toBe(401);
    await expect(ownerC.payrollPunch.deviceKeyRevoke({ id: id! })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("needs the add-on and a writable organisation (403 with the entitlement body)", async () => {
    const made = await ownerC.payrollPunch.deviceKeyCreate({ name: "Second" });
    // Read-only: the trial ended and nothing is paid for.
    const { tenants } = await import("@fintranzact/db");
    const { getControlDb } = await import("../helpers/test-db.js");
    await getControlDb().update(tenants).set({ trialStartedAt: new Date(Date.now() - 20 * 86_400_000), trialEndsAt: new Date(Date.now() - 86_400_000), trialSource: "signup" }).where(eq(tenants.id, tenant.id));
    const { billingSubscriptions } = await import("@fintranzact/db");
    await getControlDb().update(billingSubscriptions).set({ status: "cancelled" }).where(eq(billingSubscriptions.tenantId, tenant.id));
    invalidateEntitlements(tenant.id);
    const res = await push(made.key, { punches: [{ employeeCode: "E001", timestamp: "2026-11-06 09:00:00" }] });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { entitlement?: { reason: string } };
    expect(json.entitlement?.reason).toBeTruthy();
    expect(await db().select().from(employeePunches).where(eq(employeePunches.workDate, "2026-11-06"))).toHaveLength(0);
  });
});
