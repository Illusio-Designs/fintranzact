/**
 * Router gaps: ewayBill.
 *
 * eway-bill.test.ts covers generate, cancel, the vehicle update and the
 * dashboard happy paths. This file covers extend, expiringList, the
 * threshold and duplicate rules, validation, not-found and permissions.
 *
 * The NIC E-Way Bill client is mocked: no request leaves the process.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { businesses, ewayBills, ewayBillVehicleUpdates } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createInvoiceWithItems, createItem, createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { callerFor, expectCode } from "../helpers/assertions.js";

const nic = vi.hoisted(() => {
  let n = 0;
  return {
    generateEWB: vi.fn(async () => ({ ewayBillNo: `3216${String(++n).padStart(8, "0")}`, ewayBillDate: "", validUpto: "" })),
    cancelEWB: vi.fn(async (_b: string, no: string) => ({ ewayBillNo: no, cancelDate: "" })),
    updateVehicle: vi.fn(async (_b: string, no: string) => ({ ewayBillNo: no, transUpdateDate: "", validUpto: "" })),
    extendValidity: vi.fn(async (_b: string, no: string) => ({ ewayBillNo: no, validUpto: "2031-01-01T00:00:00Z" })),
  };
});

vi.mock("../../lib/ewb-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/ewb-client.js")>();
  class MockEWBClient {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any;
    constructor(config: unknown) {
      this.config = config;
    }
    generateEWB = nic.generateEWB;
    cancelEWB = nic.cancelEWB;
    updateVehicle = nic.updateVehicle;
    extendValidity = nic.extendValidity;
  }
  return { ...actual, EWBClient: MockEWBClient };
});

let world: TestWorld;
let goodsId: string;
let serviceId: string;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const caller = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const other = () => callerFor(world, "kiran");
const ENV = ["NIC_EWB_CLIENT_ID", "NIC_EWB_CLIENT_SECRET", "NIC_EWB_USERNAME", "NIC_EWB_PASSWORD"] as const;

function setCredentials(on: boolean) {
  for (const k of ENV) {
    if (on) process.env[k] = `test-${k}`;
    else delete process.env[k];
  }
}

async function bigInvoice(overrides: Record<string, unknown> = {}, itemId = goodsId, unitPrice = "60000") {
  const { invoice } = await createInvoiceWithItems(getTenantTestDb(), world.business1.id, world.party1.id,
    [{ itemId, description: "Goods", quantity: "1", unitPrice }], overrides as never);
  return invoice;
}

const gen = (invoiceId: string, extra: Record<string, unknown> = {}) =>
  caller().ewayBill.generate({ invoiceId, vehicleNumber: "MH12AB1234", distance: 150, ...extra } as never);

async function setValidUpto(id: string, hoursFromNow: number) {
  await getTenantTestDb().update(ewayBills).set({ validUpto: new Date(Date.now() + hoursFromNow * 3_600_000) }).where(eq(ewayBills.id, id));
}

beforeAll(async () => {
  setCredentials(true);
  world = await createTestWorld();
  const db = getTenantTestDb();
  goodsId = (await createItem(db, world.business1.id, { name: "EWB Steel", hsn: "7213", itemType: "product" })).id;
  serviceId = (await createItem(db, world.business1.id, { name: "EWB Consulting", hsn: "9983", itemType: "service" })).id;
});

beforeEach(() => {
  for (const f of Object.values(nic)) f.mockClear();
});

afterAll(async () => {
  setCredentials(false);
  await truncateAllTables();
  await closeTestDb();
});

describe("ewayBill.generate", () => {
  it("validates input", async () => {
    const inv = await bigInvoice();
    await expectCode(gen(inv.id, { distance: 0 }), "BAD_REQUEST");
    await expectCode(gen(inv.id, { distance: 4001 }), "BAD_REQUEST");
    await expectCode(gen(inv.id, { vehicleNumber: "X".repeat(21) }), "BAD_REQUEST");
    await expectCode(gen(inv.id, { fromPincode: "123" }), "BAD_REQUEST");
    await expectCode(gen(inv.id, { transportMode: "sea" }), "BAD_REQUEST");
    expect(nic.generateEWB).not.toHaveBeenCalled();
  });

  it("NOT_FOUND for unknown, foreign and deleted invoices", async () => {
    await expectCode(gen(UNKNOWN), "NOT_FOUND");
    const { invoice: theirs } = await createInvoiceWithItems(getTenantTestDb(), world.business2.id, world.party2.id, [{ quantity: "1", unitPrice: "90000" }]);
    await expectCode(gen(theirs.id), "NOT_FOUND");
    const gone = await bigInvoice({ deletedAt: new Date() });
    await expectCode(gen(gone.id), "NOT_FOUND");
  });

  it("refuses cancelled, service-only and below-threshold invoices", async () => {
    await expectCode(gen((await bigInvoice({ status: "cancelled" })).id), "BAD_REQUEST");
    await expectCode(gen((await bigInvoice({}, serviceId)).id), "BAD_REQUEST");
    await expect(gen((await bigInvoice({}, goodsId, "49999")).id)).rejects.toMatchObject({ code: "BAD_REQUEST", message: /threshold/ });
    expect(nic.generateEWB).not.toHaveBeenCalled();
  });

  it("uses the business's own threshold when it has one", async () => {
    const db = getTenantTestDb();
    await db.update(businesses).set({ eWayBillThreshold: "100000" }).where(eq(businesses.id, world.business1.id));
    try {
      await expectCode(gen((await bigInvoice()).id), "BAD_REQUEST");
    } finally {
      await db.update(businesses).set({ eWayBillThreshold: null }).where(eq(businesses.id, world.business1.id));
    }
  });

  it("needs NIC credentials", async () => {
    const inv = await bigInvoice();
    setCredentials(false);
    try {
      await expectCode(gen(inv.id), "PRECONDITION_FAILED");
    } finally {
      setCredentials(true);
    }
  });

  it("refuses a second active bill for the invoice, even after an earlier one was cancelled", async () => {
    const inv = await bigInvoice();
    const first = await gen(inv.id);
    await expectCode(gen(inv.id), "CONFLICT");
    await caller().ewayBill.cancel({ ewayBillId: first.id, cancelReason: "Wrong vehicle" });
    const second = await gen(inv.id);
    expect(second.status).toBe("generated");
    await expectCode(gen(inv.id), "CONFLICT");
    const rows = await getTenantTestDb().select().from(ewayBills).where(eq(ewayBills.invoiceId, inv.id));
    expect(rows.filter((r) => r.status !== "cancelled")).toHaveLength(1);
  });

  it("is refused to a seller", async () => {
    const inv = await bigInvoice();
    await expectCode(seller().ewayBill.generate({ invoiceId: inv.id, vehicleNumber: "X", distance: 10 } as never), "FORBIDDEN");
  });
});

describe("ewayBill.cancel / updateVehicle", () => {
  it("cancel: NOT_FOUND for unknown and foreign bills; refuses after 24 hours", async () => {
    const inv = await bigInvoice();
    const ewb = await gen(inv.id);
    await expectCode(caller().ewayBill.cancel({ ewayBillId: UNKNOWN, cancelReason: "x" }), "NOT_FOUND");
    await expectCode(other().ewayBill.cancel({ ewayBillId: ewb.id, cancelReason: "x" }), "NOT_FOUND");
    await getTenantTestDb().update(ewayBills).set({ ewbDate: new Date(Date.now() - 25 * 3_600_000) }).where(eq(ewayBills.id, ewb.id));
    await expectCode(caller().ewayBill.cancel({ ewayBillId: ewb.id, cancelReason: "late" }), "BAD_REQUEST");
    expect(nic.cancelEWB).not.toHaveBeenCalled();
    await expectCode(caller().ewayBill.cancel({ ewayBillId: ewb.id, cancelReason: "x".repeat(251) }), "BAD_REQUEST");
  });

  it("updateVehicle records history and refuses cancelled bills and unknown ids", async () => {
    const inv = await bigInvoice();
    const ewb = await gen(inv.id);
    const res = await caller().ewayBill.updateVehicle({ ewayBillId: ewb.id, vehicleNumber: "KA01ZZ9999", reason: "breakdown", fromPlace: "Pune" });
    expect(res.vehicleNumber).toBe("KA01ZZ9999");
    const history = await getTenantTestDb().select().from(ewayBillVehicleUpdates).where(eq(ewayBillVehicleUpdates.ewayBillId, ewb.id));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ vehicleNumber: "KA01ZZ9999", reason: "breakdown", fromPlace: "Pune" });

    await expectCode(caller().ewayBill.updateVehicle({ ewayBillId: UNKNOWN, vehicleNumber: "X", reason: "others" }), "NOT_FOUND");
    await expectCode(other().ewayBill.updateVehicle({ ewayBillId: ewb.id, vehicleNumber: "X", reason: "others" }), "NOT_FOUND");
    await expectCode(caller().ewayBill.updateVehicle({ ewayBillId: ewb.id, vehicleNumber: "X", reason: "stolen" as never }), "BAD_REQUEST");
    await caller().ewayBill.cancel({ ewayBillId: ewb.id, cancelReason: "done" });
    await expectCode(caller().ewayBill.updateVehicle({ ewayBillId: ewb.id, vehicleNumber: "X", reason: "others" }), "BAD_REQUEST");
  });

  it("sellers can't cancel or update", async () => {
    const inv = await bigInvoice();
    const ewb = await gen(inv.id);
    await expectCode(seller().ewayBill.cancel({ ewayBillId: ewb.id, cancelReason: "x" }), "FORBIDDEN");
    await expectCode(seller().ewayBill.updateVehicle({ ewayBillId: ewb.id, vehicleNumber: "X", reason: "others" }), "FORBIDDEN");
  });
});

describe("ewayBill.extend", () => {
  const ext = (ewayBillId: string, c = caller()) =>
    c.ewayBill.extend({ ewayBillId, vehicleNumber: "MH12AB1234", fromPlace: "Nashik", fromPincode: 422001, remainingDistance: 80 });

  it("extends within 8 hours of expiry and marks the bill active", async () => {
    const ewb = await gen((await bigInvoice()).id);
    await setValidUpto(ewb.id, 2);
    const res = await ext(ewb.id);
    expect(res).toMatchObject({ status: "active" });
    expect(new Date(res.validUpto!).toISOString()).toBe("2031-01-01T00:00:00.000Z");
    expect(nic.extendValidity).toHaveBeenCalledWith(world.business1.id, ewb.ewbNumber, "MH12AB1234", "Nashik", 27, 422001, 80);
  });

  it("also within 8 hours after expiry, but not outside the window", async () => {
    const ewb = await gen((await bigInvoice()).id);
    await setValidUpto(ewb.id, -7);
    await expect(ext(ewb.id)).resolves.toMatchObject({ status: "active" });

    const early = await gen((await bigInvoice()).id);
    await setValidUpto(early.id, 9);
    await expect(ext(early.id)).rejects.toMatchObject({ code: "BAD_REQUEST", message: /before expiry/ });
    const late = await gen((await bigInvoice()).id);
    await setValidUpto(late.id, -9);
    await expect(ext(late.id)).rejects.toMatchObject({ code: "BAD_REQUEST", message: /after expiry/ });
  });

  it("refuses a cancelled bill", async () => {
    const ewb = await gen((await bigInvoice()).id);
    await caller().ewayBill.cancel({ ewayBillId: ewb.id, cancelReason: "wrong" });
    await setValidUpto(ewb.id, 1);
    await expectCode(ext(ewb.id), "BAD_REQUEST");
    const [row] = await getTenantTestDb().select().from(ewayBills).where(eq(ewayBills.id, ewb.id));
    expect(row!.status).toBe("cancelled");
    expect(nic.extendValidity).not.toHaveBeenCalled();
  });

  it("validates input; NOT_FOUND for unknown and foreign bills; seller refused", async () => {
    const ewb = await gen((await bigInvoice()).id);
    await setValidUpto(ewb.id, 1);
    await expectCode(caller().ewayBill.extend({ ewayBillId: ewb.id, vehicleNumber: "X", fromPlace: "Y", fromPincode: 1, remainingDistance: 0 }), "BAD_REQUEST");
    await expectCode(caller().ewayBill.extend({ ewayBillId: "x", vehicleNumber: "X", fromPlace: "Y", fromPincode: 1, remainingDistance: 5 }), "BAD_REQUEST");
    await expectCode(ext(UNKNOWN), "NOT_FOUND");
    await expectCode(ext(ewb.id, other()), "NOT_FOUND");
    await expectCode(ext(ewb.id, seller()), "FORBIDDEN");
  });
});

describe("ewayBill.getByInvoice / dashboard / expiringList", () => {
  it("getByInvoice returns the latest bill with its vehicle history; null for none or foreign", async () => {
    const inv = await bigInvoice();
    const ewb = await gen(inv.id);
    await caller().ewayBill.updateVehicle({ ewayBillId: ewb.id, vehicleNumber: "GJ01AA0001", reason: "transshipment" });
    const got = await caller().ewayBill.getByInvoice({ invoiceId: inv.id });
    expect(got!.id).toBe(ewb.id);
    expect(got!.vehicleHistory.map((h) => h.vehicleNumber)).toEqual(["GJ01AA0001"]);
    expect(await caller().ewayBill.getByInvoice({ invoiceId: UNKNOWN })).toBeNull();
    expect(await other().ewayBill.getByInvoice({ invoiceId: inv.id })).toBeNull();
  });

  it("dashboard filters by status, pages and summarises; scoped to the business", async () => {
    const all = await caller().ewayBill.dashboard({ page: 1, limit: 100 });
    expect(all.total).toBe(all.data.length);
    const cancelled = await caller().ewayBill.dashboard({ status: "cancelled", page: 1, limit: 100 });
    expect(cancelled.data.every((d) => d.status === "cancelled")).toBe(true);
    expect(cancelled.total).toBe(all.summary.cancelled);
    expect((await caller().ewayBill.dashboard({ page: 1, limit: 1 })).data).toHaveLength(1);
    await expectCode(caller().ewayBill.dashboard({ status: "odd" as never, page: 1, limit: 10 }), "BAD_REQUEST");
    await expectCode(caller().ewayBill.dashboard({ page: 1, limit: 101 }), "BAD_REQUEST");
    expect((await other().ewayBill.dashboard({ page: 1, limit: 10 })).total).toBe(0);
  });

  it("expiringList lists live bills expiring in the next 24 hours, soonest first", async () => {
    const soon = await gen((await bigInvoice()).id);
    const sooner = await gen((await bigInvoice()).id);
    const later = await gen((await bigInvoice()).id);
    const past = await gen((await bigInvoice()).id);
    const cancelled = await gen((await bigInvoice()).id);
    await setValidUpto(soon.id, 5);
    await setValidUpto(sooner.id, 1);
    await setValidUpto(later.id, 30);
    await setValidUpto(past.id, -1);
    await caller().ewayBill.cancel({ ewayBillId: cancelled.id, cancelReason: "x" });
    await setValidUpto(cancelled.id, 2);

    const ids = (await caller().ewayBill.expiringList()).map((r) => r.id);
    expect(ids.indexOf(sooner.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(sooner.id)).toBeLessThan(ids.indexOf(soon.id));
    expect(ids).not.toContain(later.id);
    expect(ids).not.toContain(past.id);
    expect(ids).not.toContain(cancelled.id);
    expect(await other().ewayBill.expiringList()).toEqual([]);
  });

  it("a seller can't read e-way bills", async () => {
    await expectCode(seller().ewayBill.dashboard({ page: 1, limit: 10 }), "FORBIDDEN");
    await expectCode(seller().ewayBill.expiringList(), "FORBIDDEN");
    await expectCode(seller().ewayBill.getByInvoice({ invoiceId: UNKNOWN }), "FORBIDDEN");
  });
});
