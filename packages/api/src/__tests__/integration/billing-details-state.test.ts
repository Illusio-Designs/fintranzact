/**
 * The organisation's billing State (GST state code): saved with the billing
 * details, validated against the shared list, copied onto each payment at the
 * time it is made (a later change never rewrites past invoices), and used by the
 * subscription invoice for the CGST+SGST / IGST split.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { desc, eq } from "drizzle-orm";
import { billingPayments, tenants } from "@fintranzact/db";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, type TestUser, type TestTenant } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";

const NO_BUSINESS = "00000000-0000-4000-8000-000000000000";
let owner: TestUser;
let member: TestUser;
let tenant: TestTenant;

const as = (u: TestUser) =>
  createTestCaller({ userId: u.id, email: u.email, name: u.name ?? null, tenantId: tenant.id, businessId: NO_BUSINESS });

const details = (over: Record<string, unknown> = {}) => ({
  name: "Mehta Traders",
  gstin: null,
  address: "12 Ring Road, Surat",
  email: "billing@mehta.in",
  ...over,
});

async function tenantState() {
  const [row] = await getControlDb().select({ s: tenants.billingState }).from(tenants).where(eq(tenants.id, tenant.id));
  return row!.s;
}

async function lastPayment() {
  const [row] = await getControlDb().select().from(billingPayments).where(eq(billingPayments.tenantId, tenant.id)).orderBy(desc(billingPayments.createdAt)).limit(1);
  return row;
}

beforeAll(async () => {
  owner = await createUser({ email: "owner.state@mehta.in", name: "Anjali Mehta" });
  member = await createUser({ email: "member.state@mehta.in", name: "Pooja Nair" });
  tenant = await createTenant({ name: "Mehta Traders Org", plan: "starter" });
  await addMember(tenant.id, owner.id, "owner");
  await addMember(tenant.id, member.id, "member");
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("billing.updateBillingDetails — state", () => {
  it("saves a valid state code and returns it from the overview", async () => {
    await as(owner).billing.updateBillingDetails(details({ state: "24" }));
    expect(await tenantState()).toBe("24");
    expect((await as(owner).billing.overview()).billingDetails).toMatchObject({ name: "Mehta Traders", state: "24" });
  });

  it("rejects a code that is not in the state list", async () => {
    for (const state of ["00", "99x", "Gujarat", "2", "250"]) {
      await expect(as(owner).billing.updateBillingDetails(details({ state }))).rejects.toThrow(/Choose a state or UT from the list/);
    }
    expect(await tenantState()).toBe("24");
  });

  it("leaves the state alone when it is omitted, and clears it with null", async () => {
    await as(owner).billing.updateBillingDetails(details());
    expect(await tenantState()).toBe("24");
    await as(owner).billing.updateBillingDetails(details({ state: null }));
    expect(await tenantState()).toBeNull();
    expect((await as(owner).billing.overview()).billingDetails.state).toBeNull();
  });

  it("is for the owner only", async () => {
    await expect(as(member).billing.updateBillingDetails(details({ state: "27" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await tenantState()).toBeNull();
  });
});

describe("the state on a payment is frozen at payment time", () => {
  it("a later change to the organisation's state does not rewrite past invoices", async () => {
    await as(owner).billing.updateBillingDetails(details({ state: "24" }));
    await as(owner).billing.demoCheckout({ plan: "growth", cycle: "monthly", method: "upi" });
    const first = await lastPayment();
    expect(first).toMatchObject({ billingState: "24", status: "captured" });

    await as(owner).billing.updateBillingDetails(details({ state: "27" }));
    const again = await getControlDb().select().from(billingPayments).where(eq(billingPayments.id, first!.id));
    expect(again[0]!.billingState).toBe("24");

    // The next charge snapshots the new state.
    await as(owner).billing.subscribeAddon({ addon: "payroll", cycle: "monthly" });
    const addon = await lastPayment();
    expect(addon).toMatchObject({ billingState: "27" });
    expect(addon!.id).not.toBe(first!.id);
  });
});
