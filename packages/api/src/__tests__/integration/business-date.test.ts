/**
 * buildBusinessDateFilter: which column each table filters on, inclusive
 * bounds, and — against the database — that an Indian month range picks up
 * exactly the documents dated in that month, first and last instant included.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { bankTransactions, expenses, invoices, journalEntries, payments } from "@fintranzact/db";
import { financialYearRange, istPeriodRange } from "@fintranzact/shared";
import { buildBusinessDateFilter } from "../../lib/business-date.js";
import { getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import { createTestWorld, createInvoiceWithItems, type TestWorld } from "../helpers/fixtures.js";

const dialect = new PgDialect();
const render = (conds: ReturnType<typeof buildBusinessDateFilter>) =>
  conds.length ? dialect.sqlToQuery(and(...conds)!) : null;

describe("buildBusinessDateFilter — SQL shape", () => {
  it.each([
    [invoices, "invoice_date"],
    [payments, "payment_date"],
    [expenses, "expense_date"],
    [bankTransactions, "transaction_date"],
    [journalEntries, "entry_date"],
  ] as const)("filters %# on its business date column (%s), never created_at", (table, column) => {
    const q = render(buildBusinessDateFilter(table, { from: new Date(0), to: new Date(1) }))!;
    expect(q.sql).toContain(`"${column}" >= $1`);
    expect(q.sql).toContain(`"${column}" <= $2`);
    expect(q.sql).not.toContain("created_at");
  });

  it("omitted or null bounds add no condition", () => {
    expect(buildBusinessDateFilter(invoices, {})).toEqual([]);
    expect(buildBusinessDateFilter(invoices, { from: null, to: undefined })).toEqual([]);
    expect(buildBusinessDateFilter(invoices, { to: new Date(0) })).toHaveLength(1);
  });

  it("ISO strings are parsed to the same instant", () => {
    const q = render(buildBusinessDateFilter(invoices, { from: "2026-03-31T18:30:00.000Z" }))!;
    expect(q.params[0]).toBe("2026-03-31T18:30:00.000Z");
  });

  it("SQL bounds pass through", () => {
    const q = render(buildBusinessDateFilter(invoices, { from: sql`NOW() - INTERVAL '30 days'` }))!;
    expect(q.sql).toContain("NOW() - INTERVAL '30 days'");
  });
});

let world: TestWorld;

async function dated(iso: string) {
  const { invoice } = await createInvoiceWithItems(
    getTenantTestDb(), world.business1.id, world.party1.id,
    [{ quantity: "1", unitPrice: "1.00" }],
    { invoiceDate: new Date(iso), stockMode: "none" },
  );
  return invoice.invoiceNumber;
}

async function numbersIn(range: { from: Date; to: Date }) {
  const rows = await getTenantTestDb()
    .select({ n: invoices.invoiceNumber })
    .from(invoices)
    .where(and(eq(invoices.businessId, world.business1.id), ...buildBusinessDateFilter(invoices, range)));
  return rows.map((r) => r.n).sort();
}

describe("Indian month and FY ranges against the database", () => {
  const n: Record<string, string> = {};

  beforeAll(async () => {
    world = await createTestWorld();
    n.marLast = await dated("2026-03-31T18:29:59.999Z"); // 31 Mar 23:59:59.999 IST
    n.aprFirst = await dated("2026-03-31T18:30:00.000Z"); // 1 Apr 00:00 IST (date picked in India)
    n.aprUtcMidnight = await dated("2026-04-01T00:00:00.000Z"); // 1 Apr 05:30 IST
    n.aprLast = await dated("2026-04-30T18:29:59.999Z"); // 30 Apr 23:59:59.999 IST
    n.mayFirst = await dated("2026-04-30T18:30:00.000Z"); // 1 May 00:00 IST
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  it("April takes both its first and last instant and nothing either side", async () => {
    expect(await numbersIn(istPeriodRange(2026, 4))).toEqual([n.aprFirst, n.aprUtcMidnight, n.aprLast].sort());
  });

  it("March ends at 23:59:59.999 IST on the 31st", async () => {
    expect(await numbersIn(istPeriodRange(2026, 3))).toEqual([n.marLast]);
  });

  it("FY 2025-26 ends where FY 2026-27 begins", async () => {
    expect(await numbersIn(financialYearRange(2025))).toEqual([n.marLast]);
    expect(await numbersIn(financialYearRange(2026))).toEqual(
      [n.aprFirst, n.aprUtcMidnight, n.aprLast, n.mayFirst].sort(),
    );
  });
});
