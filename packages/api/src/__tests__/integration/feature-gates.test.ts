/**
 * Plan feature flags enforced end to end against Postgres: the real routers
 * behind the real middleware chain, with organisations on Starter, Growth and
 * Business, a trial, a grandfathered organisation and an admin editing a flag.
 *
 * The registry itself (FEATURE_GATES) is checked without a database in
 * ../feature-gate-registry.test.ts and shared/__tests__/feature-gates.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { billingSubscriptions, planSettings, tenants } from "@fintranzact/db";
import {
  FEATURE_GATES,
  featureGatesFor,
  PLAN_DEFAULTS,
  PLAN_FLAG_KEYS,
  PLAN_IDS,
  limitsToStored,
  type PlanFlagKey,
  type PlanId,
} from "@fintranzact/shared";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createUser, createTenant, addMember, createBusiness, type TestTenant } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { listProcedures } from "../helpers/sweep-procs.js";
import { invalidatePlanCatalog } from "../../lib/plan-catalog.js";
import { invalidateEntitlements, getEntitlements } from "../../lib/entitlements.js";
import { entitlementDataOf } from "../../lib/entitlement-error.js";
import { hasFeature, requireFeature } from "../../lib/feature-gate.js";
import { supportBadges } from "../../lib/support-badges.js";
import { recordRenewalFailure } from "../../lib/billing/service.js";
import { emailService } from "../../lib/email.js";
import { resetEnquiryRateLimit } from "../../routers/contact.js";

const DAY = 86_400_000;

interface Org {
  tenant: TestTenant;
  c: ReturnType<typeof createTestCaller>;
  businessId: string;
}

let n = 0;
async function org(plan: PlanId, tenantOverrides: Partial<TestTenant> = {}): Promise<Org> {
  n += 1;
  const owner = await createUser({ email: `feature.owner${n}@mehtatraders.in`, name: "Anjali Mehta" });
  const tenant = await createTenant({ name: `Feature org ${n}`, plan, ...tenantOverrides });
  await addMember(tenant.id, owner.id, "owner");
  const business = await createBusiness(getTenantTestDb(), owner.id, { name: `Feature business ${n}` });
  const c = createTestCaller({ userId: owner.id, email: owner.email, name: owner.name ?? null, tenantId: tenant.id, businessId: business.id });
  return { tenant, c, businessId: business.id };
}

async function setPlan(tenantId: string, plan: PlanId) {
  await getControlDb().update(tenants).set({ plan }).where(eq(tenants.id, tenantId));
  invalidateEntitlements(tenantId);
}

/** An admin edit in the Plans editor: store the plan with one flag changed. */
async function editFlag(plan: PlanId, flag: PlanFlagKey, value: boolean) {
  const base = PLAN_DEFAULTS[plan];
  const limits = { ...limitsToStored(base.limits), [flag]: value };
  await getControlDb()
    .insert(planSettings)
    .values({ plan, name: base.name, tagline: base.tagline, monthlyPriceInr: base.monthlyPriceInr, yearlyPriceInr: base.yearlyPriceInr, features: base.features, highlight: false, visible: true, limits })
    .onConflictDoUpdate({ target: planSettings.plan, set: { limits } });
  invalidatePlanCatalog();
}

async function resetPlans() {
  await getControlDb().delete(planSettings);
  invalidatePlanCatalog();
}

async function featureRefusal(p: Promise<unknown>) {
  const err = await p.then(() => null, (e) => e);
  if (!err) return null;
  const data = entitlementDataOf(err);
  return data?.reason === "feature_not_in_plan" ? { err, data } : null;
}

async function expectFeatureRefused(p: Promise<unknown>, flag: PlanFlagKey) {
  const r = await featureRefusal(p);
  expect(r, `expected feature_not_in_plan for ${flag}`).not.toBeNull();
  expect(r!.err.code).toBe("FORBIDDEN");
  expect(r!.data).toMatchObject({ reason: "feature_not_in_plan", code: "feature_not_in_plan", feature: flag, featureName: FEATURE_GATES[flag].name });
  return r!;
}

async function expectNotFeatureRefused(p: Promise<unknown>) {
  expect(await featureRefusal(p)).toBeNull();
}

/** Call a procedure by path with an input that fails validation: the gate answers first, validation after. */
function call(c: Org["c"], path: string, input: unknown = {}): Promise<unknown> {
  const [router, name] = path.split(".") as [string, string];
  return (c as never as Record<string, Record<string, (i: unknown) => Promise<unknown>>>)[router]![name]!(input);
}

beforeAll(async () => {
  await resetPlans();
});

afterAll(async () => {
  await resetPlans();
  await truncateAllTables();
  await closeTestDb();
});

// Every procedure the registry gates outright (its router's mutations and named procedures).
const unconditional = listProcedures().flatMap((p) =>
  featureGatesFor(p.path, p.type)
    .filter((m) => !m.condition)
    .map((m) => ({ path: p.path, flag: m.flag })),
);

describe("every gated procedure, on each plan's default flags", () => {
  const orgs = new Map<PlanId, Org>();
  beforeAll(async () => {
    for (const plan of PLAN_IDS) orgs.set(plan, await org(plan));
  });

  for (const plan of PLAN_IDS) {
    it(`${plan}: refused exactly where the plan's flag is off`, async () => {
      const o = orgs.get(plan)!;
      const refusedWhereOff: string[] = [];
      for (const { path, flag } of unconditional) {
        const on = PLAN_DEFAULTS[plan].limits[flag];
        const r = await featureRefusal(call(o.c, path));
        if (on) expect(r, `${plan} should be allowed ${path} (${flag})`).toBeNull();
        else {
          expect(r, `${plan} should be refused ${path} (${flag})`).not.toBeNull();
          expect(r!.data.feature).toBe(flag);
          refusedWhereOff.push(path);
        }
      }
      // Sanity: Starter is refused plenty, Business nothing.
      if (plan === "business") expect(refusedWhereOff).toEqual([]);
      if (plan === "starter") expect(refusedWhereOff.length).toBeGreaterThan(20);
    }, 120_000);
  }
});

describe("the refusal", () => {
  it("carries code, feature, name, the required plan from the stored settings, the current plan and a clear message", async () => {
    const { c } = await org("starter");
    const { err, data } = await expectFeatureRefused(call(c, "eInvoice.generate"), "eInvoicing");
    expect(err.message).toBe("E-invoicing is available on the Growth plan and above.");
    expect(data).toEqual({
      reason: "feature_not_in_plan",
      code: "feature_not_in_plan",
      upgradePath: "/settings?tab=billing",
      feature: "eInvoicing",
      featureName: "E-invoicing",
      requiredPlan: "Growth",
      currentPlan: "Starter",
    });
  });

  it("names Business, without 'and above', for a Business-only feature", async () => {
    const { c } = await org("growth");
    const { err, data } = await expectFeatureRefused(call(c, "manufacturing.bomCreate"), "manufacturing");
    expect(data).toMatchObject({ requiredPlan: "Business", currentPlan: "Growth" });
    expect(err.message).toBe("Manufacturing and bill of materials is available on the Business plan.");
  });

  it("billing.status carries the features, the required plans and the plan", async () => {
    const { c } = await org("starter");
    const status = await c.billing.status();
    expect(status).toMatchObject({ plan: "starter", topPlanName: "Business" });
    expect(status.features).toMatchObject({ eInvoicing: false, pos: true, manufacturing: false });
    expect(status.featureRequiredPlans).toMatchObject({ eInvoicing: "Growth", manufacturing: "Business", pos: "Starter" });
  });
});

describe("states that decide the features", () => {
  it("an active trial has Business-level features", async () => {
    const o = await org("starter", { trialEndsAt: new Date(Date.now() + 10 * DAY) });
    expect((await getEntitlements(o.tenant.id)).state).toBe("trialing");
    for (const path of ["eInvoice.generate", "manufacturing.bomCreate", "bankRecon.uploadCSV", "stock.transfer", "batch.create"]) {
      await expectNotFeatureRefused(call(o.c, path));
    }
  });

  it("a grandfathered organisation has everything, even if the plan says otherwise", async () => {
    const o = await org("starter", { accessGrandfathered: true });
    for (const path of ["eInvoice.generate", "manufacturing.bomCreate", "bankRecon.uploadCSV"]) await expectNotFeatureRefused(call(o.c, path));
    expect((await getEntitlements(o.tenant.id)).features).toEqual(Object.fromEntries(PLAN_FLAG_KEYS.map((k) => [k, true])));
  });

  it("an expired trial is read-only: the read-only message wins over the plan message", async () => {
    const o = await org("starter", { trialEndsAt: new Date(Date.now() - 3 * DAY) });
    const err = await call(o.c, "eInvoice.generate").then(() => null, (e) => e);
    expect(entitlementDataOf(err)).toMatchObject({ reason: "read_only_trial_expired" });
  });

  it("a halted organisation gets the read-only message, not the plan message", async () => {
    const o = await org("starter");
    await o.c.billing.demoCheckout({ plan: "starter", cycle: "monthly", method: "upi" });
    const [sub] = await getControlDb().select().from(billingSubscriptions).where(eq(billingSubscriptions.tenantId, o.tenant.id));
    await recordRenewalFailure(sub!, "Card declined");
    await getControlDb().update(billingSubscriptions).set({ graceUntil: new Date(Date.now() - 1000) }).where(eq(billingSubscriptions.id, sub!.id));
    invalidateEntitlements(o.tenant.id);
    const err = await call(o.c, "bankRecon.uploadCSV").then(() => null, (e) => e);
    expect(entitlementDataOf(err)).toMatchObject({ reason: "read_only_halted" });
  });

  it("an active paid subscription on Starter still lacks Growth features", async () => {
    const o = await org("starter");
    await o.c.billing.demoCheckout({ plan: "starter", cycle: "monthly", method: "upi" });
    await expectFeatureRefused(call(o.c, "eInvoice.generate"), "eInvoicing");
  });
});

describe("an admin editing a flag in the Plans editor", () => {
  beforeEach(resetPlans);

  it("switching e-invoicing off for Growth refuses a Growth organisation and moves the required plan to Business", async () => {
    const { c } = await org("growth");
    await expectNotFeatureRefused(call(c, "eInvoice.generate"));
    await editFlag("growth", "eInvoicing", false);
    const { err, data } = await expectFeatureRefused(call(c, "eInvoice.generate"), "eInvoicing");
    expect(data).toMatchObject({ requiredPlan: "Business", currentPlan: "Growth" });
    expect(err.message).toBe("E-invoicing is available on the Business plan.");
  });

  it("switching a flag on for Starter lets a Starter organisation use it", async () => {
    const { c } = await org("starter");
    await expectFeatureRefused(call(c, "bankRecon.uploadCSV"), "bankReconciliation");
    await editFlag("starter", "bankReconciliation", true);
    await expectNotFeatureRefused(call(c, "bankRecon.uploadCSV"));
  });

  it("switching a default-on flag off for Starter gates it (POS, GST, e-way bills, recurring)", async () => {
    const { c } = await org("starter");
    for (const [flag, path] of [
      ["pos", "pos.catalog"],
      ["gstReports", "gstReturns.fileGstr1"],
      ["eWayBills", "ewayBill.generate"],
      ["recurringInvoices", "recurringInvoice.create"],
    ] as const) {
      await expectNotFeatureRefused(call(c, path));
      await editFlag("starter", flag, false);
      await expectFeatureRefused(call(c, path), flag);
    }
  });

  it("when no plan has the flag the message says it is not available", async () => {
    const { c } = await org("business");
    for (const plan of PLAN_IDS) await editFlag(plan, "manufacturing", false);
    const { err, data } = await expectFeatureRefused(call(c, "manufacturing.bomCreate"), "manufacturing");
    expect(data!.requiredPlan).toBeNull();
    expect(err.message).toBe("Manufacturing and bill of materials is not available on your plan.");
  });

  it("a renamed plan is named as stored", async () => {
    const { c } = await org("starter");
    const base = PLAN_DEFAULTS.growth;
    await getControlDb().insert(planSettings).values({ plan: "growth", name: "Pro", tagline: "", monthlyPriceInr: 699, yearlyPriceInr: null, features: base.features, highlight: false, visible: true, limits: limitsToStored(base.limits) });
    invalidatePlanCatalog();
    const { err } = await expectFeatureRefused(call(c, "eInvoice.generate"), "eInvoicing");
    expect(err.message).toBe("E-invoicing is available on the Pro plan and above.");
  });
});

describe("multiple warehouses", () => {
  it("Starter keeps one default warehouse and basic inventory, and cannot add a second or transfer", async () => {
    const { c } = await org("starter");
    await c.stock.setup();
    const [main] = await c.warehouse.warehouseList();
    expect(main).toBeDefined();
    await expectFeatureRefused(
      c.warehouse.warehouseCreate({ premiseId: main!.premiseId, name: "Second", code: "SEC", warehouseType: "godown" }),
      "multiWarehouse",
    );
    await expectFeatureRefused(c.stock.transfer({ sourceWarehouseId: main!.id, destinationWarehouseId: main!.id, lines: [] } as never), "multiWarehouse");
    await expectFeatureRefused(c.warehouse.locationCreate({} as never), "multiWarehouse");
    // Basic inventory stays: items, adjustments, the ledger, the default warehouse, renaming it.
    const item = await c.item.create({ name: "Cement", unit: "bag", salePrice: "400", stockQuantity: "0" } as never);
    await c.stock.adjust({ warehouseId: main!.id, reason: "Opening", lines: [{ itemId: item.id, quantity: "10" }] } as never);
    expect((await c.stock.balances({ page: 1, limit: 20 } as never)).data.length).toBeGreaterThan(0);
    await expect(c.warehouse.warehouseUpdate({ id: main!.id, name: "Main godown" } as never)).resolves.toBeDefined();
  });

  it("Growth can add a second warehouse and transfer between them", async () => {
    const { c } = await org("growth");
    await c.stock.setup();
    const [main] = await c.warehouse.warehouseList();
    const second = await c.warehouse.warehouseCreate({ premiseId: main!.premiseId, name: "Second", code: "SEC", warehouseType: "godown" });
    expect(second.id).toBeDefined();
  });

  it("a downgraded organisation keeps seeing its warehouses but cannot add more", async () => {
    const o = await org("growth");
    await o.c.stock.setup();
    const [main] = await o.c.warehouse.warehouseList();
    await o.c.warehouse.warehouseCreate({ premiseId: main!.premiseId, name: "Second", code: "SEC", warehouseType: "godown" });
    await setPlan(o.tenant.id, "starter");
    expect((await o.c.warehouse.warehouseList()).length).toBe(2);
    await expectFeatureRefused(
      o.c.warehouse.warehouseCreate({ premiseId: main!.premiseId, name: "Third", code: "THI", warehouseType: "godown" }),
      "multiWarehouse",
    );
    // Removing one is never refused.
    const [, other] = (await o.c.warehouse.warehouseList()).sort((a, b) => a.code.localeCompare(b.code));
    await expect(o.c.warehouse.warehouseDelete({ id: other!.id })).resolves.toBeDefined();
  });
});

describe("batches and expiry", () => {
  it("Starter cannot switch batch tracking on, create batches or write batch fields; plain items and sales work", async () => {
    const { c } = await org("starter");
    await expectFeatureRefused(c.item.create({ name: "Syrup", unit: "btl", trackBatches: true } as never), "batchesExpiry");
    await expectFeatureRefused(c.item.create({ name: "Syrup", unit: "btl", trackBatches: true, trackExpiry: true, openingBatch: { batchNumber: "B1" } } as never), "batchesExpiry");
    const plain = await c.item.create({ name: "Soap", unit: "pcs", salePrice: "10", stockQuantity: "10" } as never);
    await expectFeatureRefused(c.item.update({ id: plain.id, data: { trackBatches: true } } as never), "batchesExpiry");
    await expectFeatureRefused(c.batch.create({ itemId: plain.id, batchNumber: "X1" } as never), "batchesExpiry");
    // Editing another field and selling without batch fields is fine.
    await expectNotFeatureRefused(c.item.update({ id: plain.id, data: { name: "Soap bar" } } as never));
    await expectFeatureRefused(
      c.invoice.create({ partyId: "00000000-0000-4000-8000-000000000000", type: "sale", lineItems: [{ itemId: plain.id, itemName: "Soap", quantity: "1", unitPrice: "10", taxPercent: "0", discountPercent: "0", batchId: "00000000-0000-4000-8000-000000000001" }] } as never),
      "batchesExpiry",
    );
    await expectFeatureRefused(c.stock.adjust({ warehouseId: "00000000-0000-4000-8000-000000000000", reason: "x", lines: [{ itemId: plain.id, quantity: "1", newBatch: { batchNumber: "N1" } }] } as never), "batchesExpiry");
  });

  it("Growth tracks batches; after a downgrade the batch data stays readable and other edits work", async () => {
    const o = await org("growth");
    const item = await o.c.item.create({ name: "Cough syrup", unit: "btl", stockQuantity: "8", trackBatches: true, trackExpiry: true, openingBatch: { batchNumber: "OP1", expiryDate: "2030-01-31" } } as never);
    expect(item.trackBatches).toBe(true);
    await setPlan(o.tenant.id, "starter");

    const list = await o.c.batch.list({ itemId: item.id });
    expect(list.data.map((b) => b.batchNumber)).toEqual(["OP1"]);
    expect((await o.c.item.getById({ id: item.id }))?.trackBatches).toBe(true);

    await expectNotFeatureRefused(o.c.item.update({ id: item.id, data: { name: "Cough syrup 100ml" } } as never));
    // Keeping the flags on for an item that already tracks them is not "switching them on".
    await expectNotFeatureRefused(o.c.item.update({ id: item.id, data: { trackBatches: true, trackExpiry: true, name: "Cough syrup" } } as never));
    // Switching tracking OFF is always allowed.
    await expect(o.c.item.update({ id: item.id, data: { trackBatches: false } } as never)).resolves.toBeDefined();
    await expectFeatureRefused(o.c.batch.create({ itemId: item.id, batchNumber: "NEW" } as never), "batchesExpiry");
    await expectFeatureRefused(o.c.item.update({ id: item.id, data: { trackBatches: true } } as never), "batchesExpiry");
  });
});

describe("POS", () => {
  it("a POS sale is gated by the pos flag; a normal invoice is not", async () => {
    const o = await org("starter");
    await editFlag("starter", "pos", false);
    try {
      const body = { partyId: "00000000-0000-4000-8000-000000000000", type: "sale", lineItems: [] };
      await expectFeatureRefused(o.c.invoice.create({ ...body, source: "pos" } as never), "pos");
      await expectNotFeatureRefused(o.c.invoice.create(body as never));
      await expectFeatureRefused(o.c.pos.catalog({} as never), "pos");
    } finally {
      await resetPlans();
    }
  });
});

describe("recurring invoices: stopping is never refused", () => {
  it("with the flag off, create/update/resume/runNow are refused but pause and delete work", async () => {
    const o = await org("starter");
    await editFlag("starter", "recurringInvoices", false);
    try {
      for (const name of ["create", "update", "resume", "runNow"]) await expectFeatureRefused(call(o.c, `recurringInvoice.${name}`), "recurringInvoices");
      await expectNotFeatureRefused(call(o.c, "recurringInvoice.pause", { id: "00000000-0000-4000-8000-000000000000" }));
      await expectNotFeatureRefused(call(o.c, "recurringInvoice.delete", { id: "00000000-0000-4000-8000-000000000000" }));
    } finally {
      await resetPlans();
    }
  });
});

describe("reads of existing data stay open", () => {
  it("a Starter organisation can read every gated area", async () => {
    const { c } = await org("starter");
    const reads: Array<[string, unknown]> = [
      ["eInvoice.dashboard", undefined],
      ["eInvoice.getConfig", undefined],
      ["ewayBill.dashboard", undefined],
      ["bankRecon.templateList", undefined],
      ["manufacturing.bomList", { page: 1, limit: 10 }],
      ["warehouse.warehouseList", undefined],
      ["gst.compositionSettings", undefined],
    ];
    for (const [path, input] of reads) {
      const [router, name] = path.split(".") as [string, string];
      const fn = (c as never as Record<string, Record<string, (i?: unknown) => Promise<unknown>>>)[router]![name];
      if (!fn) continue;
      await expectNotFeatureRefused(fn(input));
    }
  });
});

describe("code outside tRPC", () => {
  it("hasFeature / requireFeature follow the entitlements", async () => {
    const starter = await org("starter");
    const growth = await org("growth");
    expect(await hasFeature(starter.tenant.id, "eInvoicing")).toBe(false);
    expect(await hasFeature(growth.tenant.id, "eInvoicing")).toBe(true);
    await expect(requireFeature(starter.tenant.id, "eInvoicing")).rejects.toMatchObject({ code: "FORBIDDEN", message: "E-invoicing is available on the Growth plan and above." });
    await expect(requireFeature(growth.tenant.id, "eInvoicing")).resolves.toBeDefined();
  });

  it("the recurring scheduler skips a plan without the flag", async () => {
    const o = await org("starter");
    const ent = await getEntitlements(o.tenant.id);
    expect(ent.features.recurringInvoices).toBe(true);
    await editFlag("starter", "recurringInvoices", false);
    const off = await getEntitlements(o.tenant.id);
    expect(off.features.recurringInvoices).toBe(false);
    expect(off.readOnly).toBe(false);
    await resetPlans();
  });
});

describe("operational flags: support badges", () => {
  it("Business shows Priority support and Onboarding help included; Starter shows none", async () => {
    const business = await org("business");
    const starter = await org("starter");
    expect(await supportBadges(business.tenant.id)).toEqual({ priority: true, onboarding: true, labels: ["Priority support", "Onboarding help included"] });
    expect(await supportBadges(starter.tenant.id)).toEqual({ priority: false, onboarding: false, labels: [] });
  });

  it("a signed-in contact submission carries the badge and a [Priority] subject for Business", async () => {
    resetEnquiryRateLimit();
    const spy = vi.spyOn(emailService, "sendEnquiry").mockResolvedValue(undefined as never);
    try {
      const o = await org("business");
      await o.c.contact.submit({ kind: "contact", name: "Anjali Mehta", email: "anjali@mehtatraders.in", message: "Need help setting up my warehouses." });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "[Priority] Website enquiry from Anjali Mehta",
          fields: expect.arrayContaining([["Plan support", "Priority support, Onboarding help included"]]),
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });
});
