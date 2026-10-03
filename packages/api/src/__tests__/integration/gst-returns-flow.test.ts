/**
 * GST returns router against a real database: the attempt journal (state kept
 * in audit_log), the nil GSTR-1 sequence through the procedures with a mocked
 * Sandbox gateway, and the guards (period with data, missing confirmation).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog } from "@fintranzact/db";
import { createCallerFactory, type TenantDatabase } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { resetSandboxClientForTests } from "../../lib/sandbox/client.js";
import { clearGstSessionsForTests } from "../../lib/sandbox/gst-returns.js";
import { loadAttempt, saveAttempt, newAttempt } from "../../lib/gst-return-flow.js";
import { createUser, createTenant, addMember } from "../helpers/fixtures.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

const callerFactory = createCallerFactory(appRouter);
function callerFor(user: { id: string; email: string; name: string | null }, tenantId: string, businessId: string | null) {
  return callerFactory({
    user, tenantId, businessId,
    req: new Request("http://localhost:3000/api/trpc/test", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json", ...(businessId ? { "x-business-id": businessId } : {}) }),
    }),
    resHeaders: new Headers(),
    ipAddress: null,
  });
}
type Caller = ReturnType<typeof callerFor>;

let owner: Caller;
let userId: string;
let businessId: string;
const GSTIN = "27AABCU9603R1ZM";
const PERIOD = { year: 2026, month: 8 };
let trackMode: "partial" | "full" = "partial";
const FULL_GSTR1 = ["042026", "052026", "062026", "072026"].map((ret_prd, i) => ({ arn: `G${i}`, dof: "11-08-2026", mof: "GSP", ret_prd, rtntype: "GSTR1", status: "Filed", valid: "Y" }));
const calls: Array<{ method: string; path: string; query: URLSearchParams; body: unknown }> = [];

const reply = (data: object = {}) => new Response(JSON.stringify({ code: 200, data: { status_cd: "1", ...data } }), { status: 200 });
function gateway(url: string | URL, init?: RequestInit) {
  const u = new URL(String(url));
  if (u.pathname === "/authenticate") return Promise.resolve(reply({ access_token: "api" }));
  calls.push({ method: init?.method ?? "GET", path: u.pathname, query: u.searchParams, body: init?.body ? JSON.parse(String(init.body)) : undefined });
  if (u.pathname.endsWith("/gstrs/track")) {
    const fy = u.searchParams.get("financial_year");
    return Promise.resolve(reply({ data: { EFiledlist: fy === "FY 2026-27" && trackMode === "full" ? FULL_GSTR1 : fy === "FY 2026-27"
      ? [
          { arn: "AA3", dof: "20-06-2026", mof: "GSP", ret_prd: "052026", rtntype: "GSTR3B", status: "Filed", valid: "Y" },
          { arn: "AA1", dof: "11-05-2026", mof: "GSP", ret_prd: "042026", rtntype: "GSTR1", status: "Filed", valid: "Y" },
          { arn: "AA2", dof: "20-05-2026", mof: "GSP", ret_prd: "042026", rtntype: "GSTR3B", status: "Filed", valid: "Y" },
        ]
      : [] } }));
  }
  if (u.pathname.endsWith("/otp/verify")) return Promise.resolve(reply({ access_token: "taxpayer" }));
  if (u.pathname.endsWith("/new-proceed")) return Promise.resolve(reply({ data: { reference_id: "REF-1" } }));
  if (u.pathname.endsWith("/status")) return Promise.resolve(reply({ data: { status_cd: "P" } }));
  if (u.pathname.endsWith("/evc/otp")) return Promise.resolve(reply());
  if (u.pathname.endsWith("/file")) return Promise.resolve(reply({ data: { reference_id: "ARN-NIL" } }));
  return Promise.resolve(new Response(JSON.stringify({ message: "no route" }), { status: 404 }));
}

beforeAll(async () => {
  const o = await createUser({ email: `gstflow.owner.${Date.now()}@example.in`, name: "Rishi Soni" });
  userId = o.id;
  const tenant = await createTenant({ name: "Flow Traders" });
  await addMember(tenant.id, o.id, "owner");
  const ou = { id: o.id, email: o.email, name: o.name ?? null };
  const biz = await callerFor(ou, tenant.id, null).business.create({
    name: "Flow Traders", phone: "9876543210", address: "1 Fort", city: "Mumbai", state: "Maharashtra", stateCode: "27",
    gstRegistrationType: "regular", gstin: GSTIN, pan: "AABCU9603R",
  } as Parameters<Caller["business"]["create"]>[0]);
  businessId = biz.id;
  owner = callerFor(ou, tenant.id, biz.id);
}, 90_000);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetSandboxClientForTests();
  clearGstSessionsForTests();
  calls.length = 0;
  trackMode = "partial";
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("attempt journal", () => {
  it("keeps the newest row per return and period, and never stores an OTP or token", async () => {
    const db = getTenantTestDb() as unknown as TenantDatabase;
    expect(await loadAttempt(db, businessId, "gstr1", "072026")).toBeNull();
    const a = newAttempt("gstr1", "072026", false, "saved", 1000);
    await saveAttempt(db, businessId, userId, { ...a, saveRef: "R1" }, 1000);
    await saveAttempt(db, businessId, userId, { ...a, state: "save_validated", saveRef: "R1" }, 2000);
    expect(await loadAttempt(db, businessId, "gstr1", "072026")).toMatchObject({ state: "save_validated", saveRef: "R1" });
    expect(await loadAttempt(db, businessId, "gstr3b", "072026")).toBeNull();
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.businessId, businessId), eq(auditLog.entityType, "gst_return_attempt")));
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toMatch(/otp|token/i);
    // the journal is not user activity: it stays out of the audit trail
    const trail = await owner.business.auditTrail({ page: 1, limit: 100 });
    expect(trail.data.some((e: { entityType: string }) => e.entityType === "gst_return_attempt")).toBe(false);
  });
});

describe("procedures", () => {
  it("filingAttempt starts at draft", async () => {
    const r = await owner.gstReturns.filingAttempt({ ...PERIOD, kind: "gstr1" });
    expect(r).toMatchObject({ state: "draft", nil: false, period: "082026", errors: [] });
    expect(r.prerequisite).toMatch(/earlier period/);
  });

  it("filing without Sandbox enabled is refused clearly", async () => {
    await expect(owner.gstReturns.proceedGstr1({ ...PERIOD, nil: true, confirmNil: true })).rejects.toThrow(/Sandbox/);
    expect(await owner.gstReturns.filingStatus({ fyStartYear: 2026 })).toMatchObject({ status: "unavailable", financialYear: "FY 2026-27", months: [] });
  });

  it("nil GSTR-1 through the procedures: confirmation required, then proceed, poll, OTP, file", async () => {
    vi.stubEnv("GOV_API_PROVIDER", "sandbox");
    vi.stubEnv("SANDBOX_API_KEY", "key_test_abc");
    vi.stubEnv("SANDBOX_API_SECRET", "secret");
    vi.stubEnv("SANDBOX_BASE_URL", "https://test-api.sandbox.co.in");
    vi.stubGlobal("fetch", vi.fn(gateway));
    resetSandboxClientForTests();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-05T10:00:00Z"));

    trackMode = "full";
    await owner.gstReturns.verifyOtp({ username: "taxpayer1", otp: "123456" });

    await expect(owner.gstReturns.proceedGstr1({ ...PERIOD, nil: true, confirmNil: false })).rejects.toThrow(/Confirm that there were no outward supplies/);
    const eligibility = await owner.gstReturns.filingAttempt({ ...PERIOD, kind: "gstr1" });
    expect(eligibility).toMatchObject({ nilEligible: true, nilBlockers: [] });

    expect(await owner.gstReturns.proceedGstr1({ ...PERIOD, nil: true, confirmNil: true })).toMatchObject({ state: "proceeding", referenceId: "REF-1", nil: true });
    // too early: no portal call
    const n = calls.length;
    expect(await owner.gstReturns.pollReturnStatus({ ...PERIOD, kind: "gstr1" })).toMatchObject({ status: "wait" });
    expect(calls.length).toBe(n);
    vi.setSystemTime(new Date("2026-09-05T10:00:13Z"));
    expect(await owner.gstReturns.pollReturnStatus({ ...PERIOD, kind: "gstr1" })).toMatchObject({ status: "done", state: "ready_to_file" });
    expect(await owner.gstReturns.requestEvcOtp({ ...PERIOD, kind: "gstr1" })).toMatchObject({ sent: true, panSource: "business", nil: true });
    expect(await owner.gstReturns.fileGstr1({ ...PERIOD, evcOtp: "246810" })).toMatchObject({ filed: true, referenceId: "ARN-NIL", nil: true });

    const file = calls.filter((c) => c.path.endsWith("/file")).at(-1)!;
    expect(file.path).toBe("/gst/compliance/tax-payer/gstrs/gstr-1/2026/08/file");
    expect(file.query.get("pan")).toBe("AABCU9603R");
    expect(file.body).toEqual({ ret_period: "082026", gstin: GSTIN, isnil: "Y" });

    const state = await owner.gstReturns.filingAttempt({ ...PERIOD, kind: "gstr1" });
    expect(state).toMatchObject({ state: "filed", nil: true, filedRef: "ARN-NIL" });
    const audits = await getTenantTestDb().select().from(auditLog).where(and(eq(auditLog.businessId, businessId), eq(auditLog.action, "gstReturns.fileGstr1")));
    expect(JSON.stringify(audits)).not.toContain("246810");
  });

  it("filingStatus: unavailable without Sandbox, then the months of a financial year with ARNs, sorted and cached", async () => {
    vi.stubEnv("GOV_API_PROVIDER", "sandbox");
    vi.stubEnv("SANDBOX_API_KEY", "key_test_abc");
    vi.stubEnv("SANDBOX_API_SECRET", "secret");
    vi.stubEnv("SANDBOX_BASE_URL", "https://test-api.sandbox.co.in");
    vi.stubGlobal("fetch", vi.fn(gateway));
    resetSandboxClientForTests();

    const r = await owner.gstReturns.filingStatus({ fyStartYear: 2026, refresh: true });
    expect(r).toMatchObject({ status: "ok", financialYear: "FY 2026-27", composition: false, cached: false });
    expect(r.months).toHaveLength(12);
    expect(r.months[0]).toMatchObject({ period: "042026", label: "Apr 2026", gstr1: { arn: "AA1", filedOn: "2026-05-11" }, gstr3b: { arn: "AA2" } });
    expect(r.months[1]).toMatchObject({ period: "052026", gstr1: null, gstr3b: { arn: "AA3" } });
    expect(r.months[2]).toMatchObject({ gstr1: null, gstr3b: null });
    const track = calls.filter((c) => c.path.endsWith("/gstrs/track"));
    expect(track).toHaveLength(1);
    expect(track[0]!.body).toEqual({ gstin: GSTIN });
    // a second, non-refresh read is served from our cache
    expect(await owner.gstReturns.filingStatus({ fyStartYear: 2026 })).toMatchObject({ status: "ok", cached: true });
    expect(calls.filter((c) => c.path.endsWith("/gstrs/track"))).toHaveLength(1);
  });

  it("the prerequisite blocks a nil GSTR-1 for a month that follows an unfiled one", async () => {
    vi.stubEnv("GOV_API_PROVIDER", "sandbox");
    vi.stubEnv("SANDBOX_API_KEY", "key_test_abc");
    vi.stubEnv("SANDBOX_API_SECRET", "secret");
    vi.stubEnv("SANDBOX_BASE_URL", "https://test-api.sandbox.co.in");
    vi.stubGlobal("fetch", vi.fn(gateway));
    resetSandboxClientForTests();
    await owner.gstReturns.verifyOtp({ username: "taxpayer1", otp: "123456" });
    // GSTR-1 for Apr 2026 is the only one filed: May to Aug are missing before Sep
    await expect(owner.gstReturns.proceedGstr1({ year: 2026, month: 9, nil: true, confirmNil: true })).rejects.toThrow(/File these returns first: GSTR-1 May 2026, GSTR-1 Jun 2026, GSTR-1 Jul 2026, GSTR-1 Aug 2026/);
    expect(calls.some((c) => c.path.endsWith("/new-proceed"))).toBe(false);
  });
});
