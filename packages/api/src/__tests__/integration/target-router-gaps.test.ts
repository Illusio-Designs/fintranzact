/**
 * Router gaps: target.update, target.delete and target.myTargets, plus the
 * period and item rules that create enforces and update must keep.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createInvoiceWithItems, createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { callerFor, expectCode, waitForAudit } from "../helpers/assertions.js";

let world: TestWorld;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const caller = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const other = () => callerFor(world, "kiran");
const day = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString();

function target(extra: Record<string, unknown> = {}) {
  return caller().target.create({
    userId: world.suresh.id, targetType: "order_value", targetValue: "10000", periodType: "monthly",
    periodStart: iso(-5), periodEnd: iso(25), ...extra,
  } as never);
}

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("target.create", () => {
  it("refuses an item target without an item, an end before the start, and another business's item", async () => {
    await expectCode(target({ targetType: "item_quantity" }), "BAD_REQUEST");
    await expectCode(target({ periodEnd: iso(-10) }), "BAD_REQUEST");
    await expectCode(target({ targetType: "item_quantity", itemId: world.item2.id }), "BAD_REQUEST");
    await expectCode(target({ targetValue: "-5" }), "BAD_REQUEST");
  });
});

describe("target.update", () => {
  it("updates fields and audits", async () => {
    const t = await target();
    const u = await caller().target.update({ id: t.id, targetValue: "20000", notes: "stretch" });
    expect(u).toMatchObject({ targetValue: "20000.00", notes: "stretch" });
    expect(await waitForAudit(world.business1.id, "salesTarget.update", t.id)).toHaveLength(1);
    const cleared = await caller().target.update({ id: t.id, notes: null });
    expect(cleared.notes).toBeNull();
  });

  it("refuses a period that ends before it starts", async () => {
    const t = await target();
    await expectCode(caller().target.update({ id: t.id, periodEnd: iso(-30) }), "BAD_REQUEST");
    await expectCode(caller().target.update({ id: t.id, periodStart: iso(60) }), "BAD_REQUEST");
  });

  it("an item target keeps an item of this business", async () => {
    const t = await target({ targetType: "item_quantity", itemId: world.item1.id, targetValue: "10" });
    await expectCode(caller().target.update({ id: t.id, itemId: null }), "BAD_REQUEST");
    await expectCode(caller().target.update({ id: t.id, itemId: world.item2.id }), "BAD_REQUEST");
  });

  it("NOT_FOUND for unknown and foreign targets; sellers refused", async () => {
    const t = await target();
    await expectCode(caller().target.update({ id: UNKNOWN, targetValue: "1" }), "NOT_FOUND");
    await expectCode(other().target.update({ id: t.id, targetValue: "1" }), "NOT_FOUND");
    await expectCode(seller().target.update({ id: t.id, targetValue: "1" }), "FORBIDDEN");
  });
});

describe("target.delete", () => {
  it("deletes and audits; NOT_FOUND afterwards and for foreign targets; sellers refused", async () => {
    const t = await target();
    await expectCode(other().target.delete({ id: t.id }), "NOT_FOUND");
    await expectCode(seller().target.delete({ id: t.id }), "FORBIDDEN");
    await expect(caller().target.delete({ id: t.id })).resolves.toEqual({ success: true });
    expect(await waitForAudit(world.business1.id, "salesTarget.delete", t.id)).toHaveLength(1);
    await expectCode(caller().target.getProgress({ id: t.id }), "NOT_FOUND");
    await expectCode(caller().target.delete({ id: t.id }), "NOT_FOUND");
  });
});

describe("target.myTargets", () => {
  it("lists the caller's current and future targets with progress from their own sales", async () => {
    const mine = await target({ targetType: "order_count", targetValue: "4" });
    const ended = await target({ periodStart: iso(-60), periodEnd: iso(-31) });
    const someoneElse = await target({ userId: world.ramesh.id });
    await createInvoiceWithItems(getTenantTestDb(), world.business1.id, world.party1.id,
      [{ quantity: "1", unitPrice: "100" }], { createdByUserId: world.suresh.id, status: "sent" });
    await createInvoiceWithItems(getTenantTestDb(), world.business1.id, world.party1.id,
      [{ quantity: "1", unitPrice: "100" }], { createdByUserId: world.suresh.id }); // draft: not counted

    const res = await seller().target.myTargets();
    const ids = res.map((t) => t.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(ended.id);
    expect(ids).not.toContain(someoneElse.id);
    expect(res.find((t) => t.id === mine.id)!.progress).toMatchObject({ current: 1, target: 4, percentage: 25, unit: "orders" });
    expect(await other().target.myTargets()).toEqual([]);
  });
});
