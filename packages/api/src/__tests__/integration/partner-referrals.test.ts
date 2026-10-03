/**
 * Partner referrals: approved partners get a referral code, organisations
 * that sign up with it are theirs, and badges, commission and payouts follow
 * from those organisations' plans.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { billingSubscriptions, tenants, tenantMembers, users } from "@fintranzact/db";
import { PLAN_DEFAULTS, limitsToStored } from "@fintranzact/shared";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, createBusiness, type TestUser, type TestTenant, type TestBusiness } from "../helpers/fixtures.js";
import { createTestCaller, createUnauthenticatedCaller } from "../helpers/create-test-caller.js";
import { emailService } from "../../lib/email.js";

const ADMIN_EMAIL = "partners.admin@fintranzact.com";
let admin: TestUser;
let tenant: TestTenant;
let business: TestBusiness;
let savedEnv: NodeJS.ProcessEnv;
let partnerId: string;
let referralCode: string;

const adminCaller = () =>
  createTestCaller({ userId: admin.id, email: admin.email, name: "Admin", tenantId: tenant.id, businessId: business.id });
const publicCaller = () => createUnauthenticatedCaller();

async function tenantOf(email: string) {
  const db = getControlDb();
  const [row] = await db
    .select({ id: tenants.id, partnerId: tenants.partnerId, referralCode: tenants.referralCode })
    .from(tenants)
    .innerJoin(tenantMembers, eq(tenantMembers.tenantId, tenants.id))
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(eq(users.email, email));
  return row!;
}

beforeAll(async () => {
  savedEnv = { ...process.env };
  process.env.PLATFORM_ADMIN_EMAIL = ADMIN_EMAIL;
  admin = await createUser({ email: ADMIN_EMAIL, name: "Admin" });
  tenant = await createTenant({ name: "Admin Org" });
  await addMember(tenant.id, admin.id, "owner");
  business = await createBusiness(getTenantTestDb(), admin.id, { name: "Admin Business" });

  await publicCaller().partner.submitApplication({
    contactName: "Kiran Desai",
    companyName: "Desai Tax Consultants",
    email: "kiran@desaitax.in",
    phone: "+91 98765 43210",
    city: "Ahmedabad",
    partnerType: "accountant",
    listPublicly: true,
  });
  const [application] = (await adminCaller().platform.partners({})).data;
  partnerId = application!.id;
});

afterAll(async () => {
  process.env = savedEnv;
  await truncateAllTables();
  await closeTestDb();
});

describe("referral codes", () => {
  it("are given when a partner is approved, emailed to them once, and never change", async () => {
    const spy = vi.spyOn(emailService, "sendPartnerApproved").mockResolvedValue(undefined);
    const approved = await adminCaller().platform.updatePartner({ id: partnerId, status: "approved" });
    expect(approved.referralCode).toMatch(/^FTZ-[A-HJ-NP-Z2-9]{6}$/);
    expect(approved.emailed).toBe(true);
    referralCode = approved.referralCode!;
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toBe("kiran@desaitax.in");
    expect(spy.mock.calls[0]![1]).toMatchObject({
      contactName: "Kiran Desai",
      referralCode,
      signupUrl: expect.stringMatching(new RegExp(`/register\\?ref=${referralCode}$`)),
      portalUrl: expect.stringMatching(/\/partner-portal$/),
    });

    const again = await adminCaller().platform.updatePartner({ id: partnerId, status: "approved" });
    expect(again.referralCode).toBe(referralCode);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("still approve the partner when the email cannot be sent", async () => {
    await publicCaller().partner.submitApplication({
      contactName: "Nobody Mail",
      companyName: "No Mail Co",
      email: "nomail@example.in",
      phone: "+91 90000 00000",
      city: "Pune",
      partnerType: "reseller",
    });
    const pending = (await adminCaller().platform.partners({ search: "No Mail" })).data[0]!;
    const spy = vi.spyOn(emailService, "sendPartnerApproved").mockRejectedValue(new Error("down"));
    const approved = await adminCaller().platform.updatePartner({ id: pending.id, status: "approved" });
    spy.mockRestore();
    expect(approved).toMatchObject({ status: "approved", emailed: false });
    expect(approved.referralCode).toBeTruthy();
  });

  it("link an organisation registered with the code, however it is typed", async () => {
    const typed = referralCode.replace("-", "").toLowerCase();
    await publicCaller().auth.register({
      name: "Meena Shah",
      email: "meena@shahtraders.in",
      password: "a-long-test-password",
      confirmPassword: "a-long-test-password",
      referralCode: ` ${typed} `,
    });
    expect(await tenantOf("meena@shahtraders.in")).toMatchObject({ partnerId, referralCode });
  });

  it("link a second organisation registered with the code", async () => {
    await publicCaller().auth.register({
      name: "Ravi Patel",
      email: "ravi@patelstores.in",
      password: "a-long-test-password",
      confirmPassword: "a-long-test-password",
      referralCode,
    });
    expect(await tenantOf("ravi@patelstores.in")).toMatchObject({ partnerId, referralCode });
  });

  it("keep an unknown code as typed without linking a partner", async () => {
    await publicCaller().auth.register({
      name: "Anil Rao",
      email: "anil@raoandco.in",
      password: "a-long-test-password",
      confirmPassword: "a-long-test-password",
      referralCode: "FRIEND2026",
    });
    expect(await tenantOf("anil@raoandco.in")).toMatchObject({ partnerId: null, referralCode: "FRIEND2026" });
  });
});

describe("badges, commission and payouts", () => {
  it("count only referred organisations with a paid plan subscription", async () => {
    await adminCaller().platform.savePlan({
      plan: "growth",
      settings: {
        name: "Growth",
        tagline: "",
        monthlyPriceInr: 1499,
        yearlyPriceInr: null,
        features: [],
        highlight: false,
        visible: true,
        limits: limitsToStored(PLAN_DEFAULTS.growth.limits),
      },
    });
    const meena = await tenantOf("meena@shahtraders.in");
    await adminCaller().platform.setPlan({ tenantId: meena.id, plan: "growth" });
    // Only an organisation with a live plan subscription pays: the other referral is a trial on Growth.
    await getControlDb().insert(billingSubscriptions).values({
      tenantId: meena.id, kind: "plan", plan: "growth", cycle: "monthly", status: "active", basePaise: 149_900,
    });

    const detail = await adminCaller().platform.partner({ id: partnerId });
    expect(detail.referralCode).toBe(referralCode);
    expect(detail.referred).toHaveLength(2);
    expect(detail.stats).toMatchObject({
      referred: 2,
      paidReferrals: 1,
      monthlyValue: "1499.00",
      badge: "registered",
      commissionPercent: 10,
      monthlyCommission: "149.90",
      next: { badge: "silver", needed: 4 },
    });
  });

  it("uses a partner's own commission rate when one is set", async () => {
    await adminCaller().platform.updatePartner({ id: partnerId, commissionPercent: 20 });
    expect((await adminCaller().platform.partner({ id: partnerId })).stats.monthlyCommission).toBe("299.80");
    await adminCaller().platform.updatePartner({ id: partnerId, commissionPercent: null });
    expect((await adminCaller().platform.partner({ id: partnerId })).stats.commissionPercent).toBe(10);
  });

  it("records a payout once per month and marks it paid", async () => {
    const payout = await adminCaller().platform.recordPayout({ partnerId, period: "2026-09", amount: "149.90" });
    expect(payout).toMatchObject({ status: "pending", amount: "149.90" });
    await expect(adminCaller().platform.recordPayout({ partnerId, period: "2026-09", amount: "10" })).rejects.toThrow(
      /already recorded/,
    );
    await expect(adminCaller().platform.recordPayout({ partnerId, period: "2026-13", amount: "10" })).rejects.toThrow();

    let detail = await adminCaller().platform.partner({ id: partnerId });
    expect(detail.stats.pendingPayout).toBe("149.90");

    await adminCaller().platform.updatePayout({ id: payout.id, status: "paid", reference: "UPI 4312 9981" });
    detail = await adminCaller().platform.partner({ id: partnerId });
    expect(detail.stats).toMatchObject({ paidOut: "149.90", pendingPayout: "0.00" });
    expect(detail.payouts[0]).toMatchObject({ status: "paid", reference: "UPI 4312 9981" });
    expect(detail.payouts[0]?.paidAt).toBeTruthy();

    await expect(adminCaller().platform.deletePayout({ id: payout.id })).rejects.toThrow(/Only a pending payout/);
  });

  it("shows the badge in the public directory", async () => {
    const [listed] = await publicCaller().partner.directory();
    expect(listed).toMatchObject({ companyName: "Desai Tax Consultants", badge: "registered" });
    expect(listed).not.toHaveProperty("email");
    expect(listed).not.toHaveProperty("commissionPercent");
  });

  it("shows the organisation's partner to platform admins", async () => {
    const meena = await tenantOf("meena@shahtraders.in");
    const detail = await adminCaller().platform.tenant({ id: meena.id });
    expect(detail.referredBy).toMatchObject({ companyName: "Desai Tax Consultants", referralCode });
  });
});

describe("partner portal (signed in)", () => {
  const callerAs = (u: TestUser) => createTestCaller({ userId: u.id, email: u.email, name: u.name ?? null, tenantId: tenant.id, businessId: business.id });

  it("shows an approved partner their code, badge, referrals and payouts", async () => {
    const kiran = await createUser({ email: "kiran@desaitax.in", name: "Kiran Desai" });
    expect(await callerAs(kiran).partner.me()).toEqual({ status: "approved" });

    const portal = await callerAs(kiran).partner.portal();
    expect(portal.kind).toBe("partner");
    if (portal.kind !== "partner") return;
    expect(portal).toMatchObject({ companyName: "Desai Tax Consultants", referralCode });
    expect(portal.stats).toMatchObject({ referred: 2, paidReferrals: 1, paidOut: "149.90", badge: "registered" });
    expect(portal.referred.map((r) => r.paid).sort()).toEqual([false, true]);
    expect(portal.payouts).toEqual([
      expect.objectContaining({ period: "2026-09", amount: "149.90", status: "paid", reference: "UPI 4312 9981" }),
    ]);
  });

  it("shows nothing to an account whose email is not verified", async () => {
    await getControlDb().delete(users).where(eq(users.email, "kiran@desaitax.in"));
    const squatter = await createUser({ email: "kiran@desaitax.in", emailVerified: false });
    expect(await callerAs(squatter).partner.me()).toEqual({ status: null });
    expect(await callerAs(squatter).partner.portal()).toMatchObject({ kind: "none", emailVerified: false });
    await getControlDb().delete(users).where(eq(users.id, squatter.id));
  });

  it("shows a pending applicant only their application status", async () => {
    await publicCaller().partner.submitApplication({
      contactName: "Pending Person",
      companyName: "Pending Firm",
      email: "pending@firm.in",
      phone: "+91 91234 56789",
      city: "Surat",
      partnerType: "reseller",
    });
    const pending = await createUser({ email: "pending@firm.in" });
    expect(await callerAs(pending).partner.portal()).toEqual({
      kind: "application",
      email: "pending@firm.in",
      companyName: "Pending Firm",
      status: "pending",
      appliedAt: expect.any(String),
    });
  });

  it("shows an unverified applicant the status only, and approval verifies their email", async () => {
    await publicCaller().partner.submitApplication({
      contactName: "New Signup",
      companyName: "Signup Firm",
      email: "signup@firm.in",
      phone: "+91 91234 56780",
      city: "Surat",
      partnerType: "reseller",
    });
    const signup = await createUser({ email: "signup@firm.in", emailVerified: false });
    expect(await callerAs(signup).partner.portal()).toMatchObject({ kind: "application", status: "pending", companyName: null });

    const pending = (await adminCaller().platform.partners({ search: "Signup Firm" })).data[0]!;
    const spy = vi.spyOn(emailService, "sendPartnerApproved").mockResolvedValue(undefined);
    await adminCaller().platform.updatePartner({ id: pending.id, status: "approved" });
    spy.mockRestore();
    expect(await callerAs(signup).partner.portal()).toMatchObject({ kind: "partner", companyName: "Signup Firm" });
  });

  it("tells anyone else they are not a partner", async () => {
    const stranger = await createUser({ email: "stranger@example.in" });
    expect(await callerAs(stranger).partner.me()).toEqual({ status: null });
    expect(await callerAs(stranger).partner.portal()).toMatchObject({ kind: "none", email: "stranger@example.in" });
  });
});

describe("rejected partners", () => {
  it("stops linking new organisations once a partner is rejected", async () => {
    await adminCaller().platform.updatePartner({ id: partnerId, status: "rejected" });
    await publicCaller().auth.register({
      name: "Late Signup",
      email: "late@signup.in",
      password: "a-long-test-password",
      confirmPassword: "a-long-test-password",
      referralCode,
    });
    expect((await tenantOf("late@signup.in")).partnerId).toBeNull();
    expect(await publicCaller().partner.directory()).toEqual([]);
  });
});
