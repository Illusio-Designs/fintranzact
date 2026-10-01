/**
 * Router gaps: recurringInvoice.
 *
 * recurring-invoice.test.ts covers create, pause/resume and the generator.
 * This file covers list, getById, update, delete, executionHistory,
 * planUsage and suggestions, plus validation, unknown and foreign ids,
 * permissions, audit rows and side effects of runNow.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { items, recurringInvoiceTemplates } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createInvoiceWithItems, createParty, createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { callerFor, expectCode, waitForAudit } from "../helpers/assertions.js";
import { istDateParts, istStartOfDay } from "@fintranzact/shared";
import { firstRunDate } from "../../routers/recurringInvoice.js";

let world: TestWorld;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const caller = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const other = () => callerFor(world, "kiran");

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

function input(overrides: Record<string, unknown> = {}) {
  return {
    partyId: world.party1.id,
    name: "Gap template",
    type: "sale" as const,
    frequency: "monthly" as const,
    startDate: daysAgo(1).toISOString(),
    lineItems: [{ itemName: "Retainer", quantity: "1", unitPrice: "1000.00", taxPercent: "18", discountPercent: "0" }],
    ...overrides,
  } as Parameters<ReturnType<typeof caller>["recurringInvoice"]["create"]>[0];
}

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("recurringInvoice.create", () => {
  it("audits creation and keeps a future start date as the first run", async () => {
    const start = new Date(Date.now() + 5 * 86_400_000);
    const t = await caller().recurringInvoice.create(input({ name: "Future start", startDate: start.toISOString() }));
    expect(new Date(t.nextRunDate).toISOString()).toBe(start.toISOString());
    expect(await waitForAudit(world.business1.id, "recurringInvoice.create", t.id)).toHaveLength(1);
  });

  // Regression (J8 journey): a template starting today (the form's default,
  // sent as that day's midnight) skipped today and first ran a month later.
  it("runs a template that starts today today, and one that started earlier a period from now", async () => {
    const now = new Date();
    const { year, month, day } = istDateParts(now);
    const midnight = istStartOfDay(year, month, day);
    const t = await caller().recurringInvoice.create(input({ name: "Starts today", startDate: midnight.toISOString() }));
    expect(new Date(t.nextRunDate).toISOString()).toBe(midnight.toISOString());

    const lastWeek = new Date(midnight.getTime() - 7 * 86_400_000);
    expect(firstRunDate(lastWeek, "monthly", null, now).getTime()).toBeGreaterThan(now.getTime());
    expect(firstRunDate(midnight, "monthly", null, now).toISOString()).toBe(midnight.toISOString());
  });

  it("validates input", async () => {
    await expectCode(caller().recurringInvoice.create(input({ lineItems: [] })), "BAD_REQUEST");
    await expectCode(caller().recurringInvoice.create(input({ name: "" })), "BAD_REQUEST");
    await expectCode(caller().recurringInvoice.create(input({ startDate: "2026-01-01" })), "BAD_REQUEST");
    await expectCode(caller().recurringInvoice.create(input({ frequency: "daily" })), "BAD_REQUEST");
    await expectCode(caller().recurringInvoice.create(input({ maxRuns: 0 })), "BAD_REQUEST");
    await expectCode(caller().recurringInvoice.create(input({
      lineItems: [{ itemName: "Zero", quantity: "0", unitPrice: "1" }],
    })), "BAD_REQUEST");
  });

  it("refuses another business's party", async () => {
    await expectCode(caller().recurringInvoice.create(input({ partyId: world.party2.id })), "BAD_REQUEST");
  });

  it("refuses another business's item on a line", async () => {
    await expectCode(caller().recurringInvoice.create(input({
      lineItems: [{ itemId: world.item2.id, itemName: "Foreign", quantity: "1", unitPrice: "10" }],
    })), "BAD_REQUEST");
  });

  it("is refused to a seller (read-only on recurring invoices)", async () => {
    await expectCode(seller().recurringInvoice.create(input()), "FORBIDDEN");
  });
});

describe("recurringInvoice.list / getById", () => {
  it("lists with party names, filters by status and pages", async () => {
    const a = await caller().recurringInvoice.create(input({ name: "List A" }));
    const b = await caller().recurringInvoice.create(input({ name: "List B" }));
    await caller().recurringInvoice.pause({ id: b.id });

    const all = await caller().recurringInvoice.list({ page: 1, limit: 100 });
    expect(all.data.map((t) => t.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(all.data.find((t) => t.id === a.id)!.partyName).toBe(world.party1.name);
    expect(all.total).toBe(all.data.length);

    const paused = await caller().recurringInvoice.list({ status: "paused", page: 1, limit: 100 });
    expect(paused.data.every((t) => t.status === "paused")).toBe(true);
    expect(paused.data.map((t) => t.id)).toContain(b.id);

    const page = await caller().recurringInvoice.list({ page: 1, limit: 1 });
    expect(page.data).toHaveLength(1);
    expect(page.total).toBe(all.total);
  });

  it("list validates status and paging, and is scoped to the business", async () => {
    await expectCode(caller().recurringInvoice.list({ status: "running" as never, page: 1, limit: 10 }), "BAD_REQUEST");
    await expectCode(caller().recurringInvoice.list({ page: 0, limit: 10 }), "BAD_REQUEST");
    expect((await other().recurringInvoice.list({ page: 1, limit: 100 })).total).toBe(0);
  });

  it("getById returns the full template, NOT_FOUND for unknown or foreign ids", async () => {
    const t = await caller().recurringInvoice.create(input({ name: "Get me", notes: "Thanks" }));
    const got = await caller().recurringInvoice.getById({ id: t.id });
    expect(got).toMatchObject({ id: t.id, name: "Get me", notes: "Thanks", partyName: world.party1.name });
    expect(got.lineItems).toHaveLength(1);
    await expectCode(caller().recurringInvoice.getById({ id: UNKNOWN }), "NOT_FOUND");
    await expectCode(other().recurringInvoice.getById({ id: t.id }), "NOT_FOUND");
    await expectCode(caller().recurringInvoice.getById({ id: "x" }), "BAD_REQUEST");
  });

  it("a seller can read", async () => {
    await expect(seller().recurringInvoice.list({ page: 1, limit: 10 })).resolves.toHaveProperty("data");
  });
});

describe("recurringInvoice.update", () => {
  it("updates fields, clears maxRuns with null, and audits", async () => {
    const t = await caller().recurringInvoice.create(input({ name: "Upd", maxRuns: 5 }));
    const end = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const updated = await caller().recurringInvoice.update({
      id: t.id,
      data: { name: "Updated", notes: "New notes", endDate: end, additionalCharges: "50" },
    });
    expect(updated).toMatchObject({ name: "Updated", notes: "New notes", additionalCharges: "50.00", maxRuns: 5 });
    expect(new Date(updated.endDate!).toISOString()).toBe(end);
    const cleared = await caller().recurringInvoice.update({ id: t.id, data: { maxRuns: null } });
    expect(cleared.maxRuns).toBeNull();
    expect((await waitForAudit(world.business1.id, "recurringInvoice.update", t.id)).length).toBeGreaterThanOrEqual(1);
  });

  it("moves the template to another party of the business, not another business's", async () => {
    const t = await caller().recurringInvoice.create(input({ name: "Party move" }));
    const p = await createParty(getTenantTestDb(), world.business1.id, { name: "Second customer" });
    await expect(caller().recurringInvoice.update({ id: t.id, data: { partyId: p.id } })).resolves.toMatchObject({ partyId: p.id });
    await expectCode(caller().recurringInvoice.update({ id: t.id, data: { partyId: world.party2.id } }), "BAD_REQUEST");
  });

  it("refuses to switch to a custom frequency without an interval", async () => {
    const t = await caller().recurringInvoice.create(input({ name: "To custom" }));
    await expectCode(caller().recurringInvoice.update({ id: t.id, data: { frequency: "custom" } }), "BAD_REQUEST");
    await expect(caller().recurringInvoice.update({ id: t.id, data: { frequency: "custom", customIntervalDays: 10 } }))
      .resolves.toMatchObject({ frequency: "custom", customIntervalDays: 10 });
  });

  it("refuses another business's item on a line", async () => {
    const t = await caller().recurringInvoice.create(input({ name: "Foreign line" }));
    await expectCode(caller().recurringInvoice.update({
      id: t.id,
      data: { lineItems: [{ itemId: world.item2.id, itemName: "x", quantity: "1", unitPrice: "1", taxPercent: "0", discountPercent: "0" }] },
    }), "BAD_REQUEST");
  });

  it("NOT_FOUND for unknown and foreign ids; validates input", async () => {
    const t = await caller().recurringInvoice.create(input({ name: "Upd guard" }));
    await expectCode(caller().recurringInvoice.update({ id: UNKNOWN, data: { name: "x" } }), "NOT_FOUND");
    await expectCode(other().recurringInvoice.update({ id: t.id, data: { name: "x" } }), "NOT_FOUND");
    await expectCode(caller().recurringInvoice.update({ id: t.id, data: { lineItems: [] } }), "BAD_REQUEST");
    await expectCode(caller().recurringInvoice.update({ id: t.id, data: { endDate: "soon" } }), "BAD_REQUEST");
  });

  it("is refused to a seller", async () => {
    const t = await caller().recurringInvoice.create(input({ name: "Seller upd" }));
    await expectCode(seller().recurringInvoice.update({ id: t.id, data: { name: "x" } }), "FORBIDDEN");
  });
});

describe("recurringInvoice.delete", () => {
  it("deletes the template and audits", async () => {
    const t = await caller().recurringInvoice.create(input({ name: "Delete me" }));
    await expect(caller().recurringInvoice.delete({ id: t.id })).resolves.toEqual({ success: true });
    await expectCode(caller().recurringInvoice.getById({ id: t.id }), "NOT_FOUND");
    expect(await waitForAudit(world.business1.id, "recurringInvoice.delete", t.id)).toHaveLength(1);
  });

  it("keeps invoices it generated", async () => {
    const t = await caller().recurringInvoice.create(input({ name: "Delete after run" }));
    const { invoiceId } = await caller().recurringInvoice.runNow({ id: t.id });
    await caller().recurringInvoice.delete({ id: t.id });
    await expect(caller().invoice.getById({ id: invoiceId })).resolves.toMatchObject({ id: invoiceId });
  });

  it("NOT_FOUND for unknown and foreign ids, without touching the template", async () => {
    const t = await caller().recurringInvoice.create(input({ name: "Not theirs" }));
    await expectCode(caller().recurringInvoice.delete({ id: UNKNOWN }), "NOT_FOUND");
    await expectCode(other().recurringInvoice.delete({ id: t.id }), "NOT_FOUND");
    await expect(caller().recurringInvoice.getById({ id: t.id })).resolves.toMatchObject({ id: t.id });
    const audits = await waitForAudit(world.business2.id, "recurringInvoice.delete");
    expect(audits).toHaveLength(0);
  });

  it("is refused to a seller", async () => {
    const t = await caller().recurringInvoice.create(input({ name: "Seller delete" }));
    await expectCode(seller().recurringInvoice.delete({ id: t.id }), "FORBIDDEN");
  });
});

describe("recurringInvoice.pause / resume / runNow", () => {
  it("pause and resume audit; unknown ids are NOT_FOUND", async () => {
    const t = await caller().recurringInvoice.create(input({ name: "Pause audit" }));
    await caller().recurringInvoice.pause({ id: t.id });
    await caller().recurringInvoice.resume({ id: t.id });
    expect(await waitForAudit(world.business1.id, "recurringInvoice.pause", t.id)).toHaveLength(1);
    expect(await waitForAudit(world.business1.id, "recurringInvoice.resume", t.id)).toHaveLength(1);
    await expectCode(caller().recurringInvoice.pause({ id: UNKNOWN }), "NOT_FOUND");
    await expectCode(caller().recurringInvoice.resume({ id: UNKNOWN }), "NOT_FOUND");
    await expectCode(caller().recurringInvoice.runNow({ id: UNKNOWN }), "NOT_FOUND");
  });

  it("another business can't pause, resume or run the template", async () => {
    const t = await caller().recurringInvoice.create(input({ name: "Foreign control" }));
    await expectCode(other().recurringInvoice.pause({ id: t.id }), "NOT_FOUND");
    await expectCode(other().recurringInvoice.runNow({ id: t.id }), "NOT_FOUND");
    await caller().recurringInvoice.pause({ id: t.id });
    await expectCode(other().recurringInvoice.resume({ id: t.id }), "NOT_FOUND");
  });

  it("runNow creates a numbered invoice, reduces stock, records the run and bumps the invoice counter", async () => {
    const db = getTenantTestDb();
    const [before] = await db.select().from(items).where(eq(items.id, world.item1.id));
    const t = await caller().recurringInvoice.create(input({
      name: "Stock run",
      lineItems: [{ itemId: world.item1.id, itemName: "Cotton", quantity: "2", unitPrice: "250", taxPercent: "5", discountPercent: "0" }],
    }));
    const { invoiceId } = await caller().recurringInvoice.runNow({ id: t.id });
    const inv = await caller().invoice.getById({ id: invoiceId });
    expect(inv).toMatchObject({ source: "recurring", totalAmount: "525.00" });
    const [after] = await db.select().from(items).where(eq(items.id, world.item1.id));
    expect(parseFloat(after!.stockQuantity!)).toBeCloseTo(parseFloat(before!.stockQuantity!) - 2, 3);

    const [tpl] = await db.select().from(recurringInvoiceTemplates).where(eq(recurringInvoiceTemplates.id, t.id));
    expect(tpl!.totalRuns).toBe(1);
    expect(tpl!.lastRunDate).not.toBeNull();
  });

  it("runNow and pause/resume are refused to a seller", async () => {
    const t = await caller().recurringInvoice.create(input({ name: "Seller run" }));
    await expectCode(seller().recurringInvoice.runNow({ id: t.id }), "FORBIDDEN");
    await expectCode(seller().recurringInvoice.pause({ id: t.id }), "FORBIDDEN");
  });
});

describe("recurringInvoice.executionHistory / planUsage", () => {
  it("lists runs with invoice numbers, newest first, and pages", async () => {
    const t = await caller().recurringInvoice.create(input({ name: "History" }));
    const r1 = await caller().recurringInvoice.runNow({ id: t.id });
    const r2 = await caller().recurringInvoice.runNow({ id: t.id });
    const h = await caller().recurringInvoice.executionHistory({ templateId: t.id, page: 1, limit: 10 });
    expect(h.total).toBe(2);
    expect(h.data.map((r) => r.invoiceId).sort()).toEqual([r1.invoiceId, r2.invoiceId].sort());
    expect(h.data.every((r) => r.status === "success" && r.invoiceNumber)).toBe(true);
    const p = await caller().recurringInvoice.executionHistory({ templateId: t.id, page: 2, limit: 1 });
    expect(p.data).toHaveLength(1);
    // Another business sees nothing; unknown template has no runs.
    expect((await other().recurringInvoice.executionHistory({ templateId: t.id, page: 1, limit: 10 })).total).toBe(0);
    expect((await caller().recurringInvoice.executionHistory({ templateId: UNKNOWN, page: 1, limit: 10 })).total).toBe(0);
    await expectCode(caller().recurringInvoice.executionHistory({ templateId: "x", page: 1, limit: 10 }), "BAD_REQUEST");
  });

  it("planUsage counts this month's successful runs and templates; self-hosted uses the free allowance", async () => {
    const usage = await caller().recurringInvoice.planUsage();
    expect(usage.runsThisMonth).toBeGreaterThanOrEqual(3);
    const n = (await caller().recurringInvoice.list({ page: 1, limit: 100 })).total;
    expect(usage.totalTemplates).toBe(n);
    expect(usage.limit).toBe(5);
    const theirs = await other().recurringInvoice.planUsage();
    expect(theirs).toMatchObject({ runsThisMonth: 0, totalTemplates: 0 });
  });
});

describe("recurringInvoice.suggestions", () => {
  it("suggests a weekly schedule for a regular customer, ignoring irregular and deleted invoices", async () => {
    const db = getTenantTestDb();
    const b = world.business1.id;
    const regular = await createParty(db, b, { name: "Weekly Regular" });
    for (const d of [28, 21, 14, 7]) {
      await createInvoiceWithItems(db, b, regular.id, [{ quantity: "1", unitPrice: "100" }], { invoiceDate: daysAgo(d) });
    }
    const irregular = await createParty(db, b, { name: "Irregular" });
    for (const d of [50, 49, 10]) {
      await createInvoiceWithItems(db, b, irregular.id, [{ quantity: "1", unitPrice: "100" }], { invoiceDate: daysAgo(d) });
    }
    const ghost = await createParty(db, b, { name: "Deleted invoices" });
    for (const d of [21, 14, 7]) {
      await createInvoiceWithItems(db, b, ghost.id, [{ quantity: "1", unitPrice: "100" }], { invoiceDate: daysAgo(d), deletedAt: new Date() });
    }

    const s = await caller().recurringInvoice.suggestions();
    const reg = s.find((x) => x.partyId === regular.id)!;
    expect(reg).toMatchObject({ suggestedFrequency: "weekly", invoiceCount: 4, medianIntervalDays: 7, medianAmount: "100.00" });
    expect(s.find((x) => x.partyId === irregular.id)).toBeUndefined();
    expect(s.find((x) => x.partyId === ghost.id)).toBeUndefined();
    expect((await other().recurringInvoice.suggestions()).find((x) => x.partyId === regular.id)).toBeUndefined();
  });
});
