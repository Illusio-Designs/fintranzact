/**
 * Router gaps: gstr2b.
 *
 * gstr2b.test.ts covers the parser, the reconciler and the main upload,
 * list, link and ignore flows. This file covers missingInBooks, input
 * validation, unknown and foreign ids, permissions, and the rules around
 * linking a record to an invoice.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { gstr2bRecords } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createInvoiceWithItems, createParty, createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { callerFor, expectCode } from "../helpers/assertions.js";

let world: TestWorld;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const caller = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const other = () => callerFor(world, "kiran");
const PERIOD = "2026-05";

const CSV = `GSTIN,Trade Name,Invoice No,Invoice Date,Invoice Value,Taxable Value,CGST,SGST,IGST,Cess,ITC Available
27AABCG0000R1ZM,Gap Supplier,GAP-001,05-05-2026,1180,1000,90,90,0,0,Y
27AABCG0000R1ZM,Gap Supplier,GAP-002,06-05-2026,2360,2000,180,180,0,0,Y
27AABCZ0000R1ZM,Zeta Supplier,ZT-9,07-05-2026,590,500,45,45,0,0,N
`;

let uploadId: string;
let supplierId: string;
let matchedInvoiceId: string;

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();
  supplierId = (await createParty(db, world.business1.id, {
    name: "Gap Supplier", type: "supplier", gstin: "27AABCG0000R1ZM", stateCode: "27",
  })).id;
  // GAP-001 is in the books and matches; GAP-002 and ZT-9 are not.
  const { invoice } = await createInvoiceWithItems(db, world.business1.id, supplierId,
    [{ quantity: "1", unitPrice: "1000", taxPercent: "18" }],
    { type: "purchase", invoiceNumber: "GAP-001", invoiceDate: new Date("2026-05-05T06:00:00Z") });
  matchedInvoiceId = invoice.id;
  // In the books for May but not in 2B.
  await createInvoiceWithItems(db, world.business1.id, supplierId,
    [{ quantity: "1", unitPrice: "300", taxPercent: "18" }],
    { type: "purchase", invoiceNumber: "GAP-BOOKS-ONLY", invoiceDate: new Date("2026-05-20T06:00:00Z") });

  const res = await caller().gstr2b.upload({ returnPeriod: PERIOD, content: CSV, fileName: "gap.csv", format: "csv" });
  uploadId = res.uploadId;
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("gstr2b.upload", () => {
  it("reconciled the sample: one matched, two missing in books, one missing in 2B", async () => {
    const s = await caller().gstr2b.summary({ returnPeriod: PERIOD });
    expect(s).toMatchObject({ hasData: true, uploadId, matched: 1, missingInBooks: 2, totalRecords: 3 });
    // ITC at risk counts only ITC-available records not matched.
    expect(s.itcAtRisk.total).toBe("360.00");
    expect(s.itcAvailable.total).toBe("180.00");
  });

  it("validates input", async () => {
    await expectCode(caller().gstr2b.upload({ returnPeriod: "05-2026", content: CSV, fileName: "x.csv", format: "csv" }), "BAD_REQUEST");
    await expectCode(caller().gstr2b.upload({ returnPeriod: PERIOD, content: "", fileName: "x.csv", format: "csv" }), "BAD_REQUEST");
    await expectCode(caller().gstr2b.upload({ returnPeriod: PERIOD, content: CSV, fileName: "", format: "csv" }), "BAD_REQUEST");
    await expectCode(caller().gstr2b.upload({ returnPeriod: PERIOD, content: CSV, fileName: "x", format: "xml" as never }), "BAD_REQUEST");
  });

  it("refuses a file with no records", async () => {
    const header = CSV.split("\n")[0] + "\n";
    await expect(caller().gstr2b.upload({ returnPeriod: PERIOD, content: header, fileName: "empty.csv", format: "csv" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: /No records/ });
    await expectCode(caller().gstr2b.upload({ returnPeriod: PERIOD, content: "{}", fileName: "e.json", format: "json" }), "BAD_REQUEST");
  });

  it("is refused to a seller", async () => {
    await expectCode(seller().gstr2b.upload({ returnPeriod: PERIOD, content: CSV, fileName: "s.csv", format: "csv" }), "FORBIDDEN");
  });
});

describe("gstr2b.uploads / records / summary", () => {
  it("uploads validates paging and is scoped to the business", async () => {
    await expectCode(caller().gstr2b.uploads({ page: 1, limit: 51 }), "BAD_REQUEST");
    expect((await caller().gstr2b.uploads()).uploads.map((u) => u.id)).toContain(uploadId);
    expect((await other().gstr2b.uploads()).total).toBe(0);
  });

  it("records: NOT_FOUND for unknown and foreign uploads; validates the status", async () => {
    await expectCode(caller().gstr2b.records({ uploadId: UNKNOWN }), "NOT_FOUND");
    await expectCode(other().gstr2b.records({ uploadId }), "NOT_FOUND");
    await expectCode(caller().gstr2b.records({ uploadId, matchStatus: "odd" as never }), "BAD_REQUEST");
    const page = await caller().gstr2b.records({ uploadId, page: 2, limit: 2 });
    expect(page.records).toHaveLength(1);
    expect(page.total).toBe(3);
  });

  it("summary validates the period and shows no data to another business", async () => {
    await expectCode(caller().gstr2b.summary({ returnPeriod: "May" }), "BAD_REQUEST");
    expect((await other().gstr2b.summary({ returnPeriod: PERIOD })).hasData).toBe(false);
  });

  it("a seller has no GST report access (read)", async () => {
    await expectCode(seller().gstr2b.uploads(), "FORBIDDEN");
    await expectCode(seller().gstr2b.summary({ returnPeriod: PERIOD }), "FORBIDDEN");
  });
});

describe("gstr2b.missingInBooks", () => {
  it("lists only records missing from the books, sorted by supplier, and pages", async () => {
    const res = await caller().gstr2b.missingInBooks({ uploadId });
    expect(res.total).toBe(2);
    expect(res.records.map((r) => r.invoiceNumber)).toEqual(["GAP-002", "ZT-9"]);
    expect(res.records.every((r) => r.matchStatus === "missing_in_books")).toBe(true);
    const p2 = await caller().gstr2b.missingInBooks({ uploadId, page: 2, limit: 1 });
    expect(p2.records.map((r) => r.invoiceNumber)).toEqual(["ZT-9"]);
  });

  it("NOT_FOUND for unknown and foreign uploads; validates input", async () => {
    await expectCode(caller().gstr2b.missingInBooks({ uploadId: UNKNOWN }), "NOT_FOUND");
    await expectCode(other().gstr2b.missingInBooks({ uploadId }), "NOT_FOUND");
    await expectCode(caller().gstr2b.missingInBooks({ uploadId: "x" }), "BAD_REQUEST");
    await expectCode(caller().gstr2b.missingInBooks({ uploadId, limit: 101 }), "BAD_REQUEST");
  });
});

describe("gstr2b.missingIn2B", () => {
  it("lists the book invoice the supplier did not report", async () => {
    const res = await caller().gstr2b.missingIn2B({ returnPeriod: PERIOD });
    expect(res.records.map((r) => r.invoiceNumber)).toEqual(["GAP-BOOKS-ONLY"]);
    expect(res.records[0]!.partyGstin).toBe("27AABCG0000R1ZM");
  });

  it("is empty for a period with no upload; validates the period", async () => {
    expect(await caller().gstr2b.missingIn2B({ returnPeriod: "2020-01" })).toMatchObject({ records: [], total: 0 });
    await expectCode(caller().gstr2b.missingIn2B({ returnPeriod: "2026/05" }), "BAD_REQUEST");
  });
});

describe("gstr2b.linkInvoice / ignoreRecord", () => {
  const recordByNumber = async (n: string) => {
    const rows = await getTenantTestDb().select().from(gstr2bRecords).where(eq(gstr2bRecords.invoiceNumber, n));
    return rows.find((r) => r.uploadId === uploadId)!;
  };

  it("linking a book invoice marks the record matched and drops it from missingIn2B", async () => {
    const rec = await recordByNumber("GAP-002");
    const books = (await caller().gstr2b.missingIn2B({ returnPeriod: PERIOD })).records[0]!;
    await expect(caller().gstr2b.linkInvoice({ recordId: rec.id, invoiceId: books.id })).resolves.toEqual({ success: true });
    const after = await recordByNumber("GAP-002");
    expect(after).toMatchObject({ matchStatus: "matched", matchedInvoiceId: books.id, mismatchReasons: null });
    expect((await caller().gstr2b.missingIn2B({ returnPeriod: PERIOD })).total).toBe(0);
  });

  it("refuses unknown and foreign records, sale invoices and deleted invoices", async () => {
    const rec = await recordByNumber("ZT-9");
    await expectCode(caller().gstr2b.linkInvoice({ recordId: UNKNOWN, invoiceId: matchedInvoiceId }), "NOT_FOUND");
    await expectCode(other().gstr2b.linkInvoice({ recordId: rec.id, invoiceId: matchedInvoiceId }), "NOT_FOUND");
    await expectCode(caller().gstr2b.linkInvoice({ recordId: rec.id, invoiceId: UNKNOWN }), "NOT_FOUND");

    const db = getTenantTestDb();
    const { invoice: sale } = await createInvoiceWithItems(db, world.business1.id, world.party1.id, [{ quantity: "1", unitPrice: "1" }]);
    await expectCode(caller().gstr2b.linkInvoice({ recordId: rec.id, invoiceId: sale.id }), "NOT_FOUND");

    const { invoice: gone } = await createInvoiceWithItems(db, world.business1.id, supplierId, [{ quantity: "1", unitPrice: "1" }],
      { type: "purchase", deletedAt: new Date() });
    await expectCode(caller().gstr2b.linkInvoice({ recordId: rec.id, invoiceId: gone.id }), "NOT_FOUND");

    const { invoice: cancelled } = await createInvoiceWithItems(db, world.business1.id, supplierId, [{ quantity: "1", unitPrice: "1" }],
      { type: "purchase", status: "cancelled" });
    await expectCode(caller().gstr2b.linkInvoice({ recordId: rec.id, invoiceId: cancelled.id }), "NOT_FOUND");

    const { invoice: theirs } = await createInvoiceWithItems(db, world.business2.id, world.party2.id, [{ quantity: "1", unitPrice: "1" }], { type: "purchase" });
    await expectCode(caller().gstr2b.linkInvoice({ recordId: rec.id, invoiceId: theirs.id }), "NOT_FOUND");
    expect((await recordByNumber("ZT-9")).matchStatus).toBe("missing_in_books");
  });

  it("ignoreRecord marks the record ignored and moves it out of missingInBooks", async () => {
    const rec = await recordByNumber("ZT-9");
    await expect(caller().gstr2b.ignoreRecord({ recordId: rec.id })).resolves.toEqual({ success: true });
    expect((await recordByNumber("ZT-9")).matchStatus).toBe("ignored");
    expect((await caller().gstr2b.missingInBooks({ uploadId })).total).toBe(0);
    expect((await caller().gstr2b.summary({ returnPeriod: PERIOD })).ignored).toBe(1);
  });

  it("ignoreRecord: NOT_FOUND for unknown and foreign records; sellers refused on both", async () => {
    const rec = await recordByNumber("GAP-001");
    await expectCode(caller().gstr2b.ignoreRecord({ recordId: UNKNOWN }), "NOT_FOUND");
    await expectCode(other().gstr2b.ignoreRecord({ recordId: rec.id }), "NOT_FOUND");
    await expectCode(seller().gstr2b.ignoreRecord({ recordId: rec.id }), "FORBIDDEN");
    await expectCode(seller().gstr2b.linkInvoice({ recordId: rec.id, invoiceId: matchedInvoiceId }), "FORBIDDEN");
    await expectCode(caller().gstr2b.ignoreRecord({ recordId: "x" }), "BAD_REQUEST");
  });
});
