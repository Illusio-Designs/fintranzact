/**
 * Stock direction for every document type on both sides, and that the three
 * places that encode it agree:
 *   - documentStockDirection (TypeScript, used by syncDocumentStock),
 *   - the SQL CASE in postNewDocumentsStock (bulk imports),
 *   - the net movements actually posted through the document lifecycle
 *     (create → cancel → reinstate → edit → delete).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { invoiceItems, invoices, stockMovements } from "@fintranzact/db";
import { documentTypes } from "@fintranzact/shared";
import { getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import { createTestWorld, createInvoiceWithItems, type TestWorld } from "../helpers/fixtures.js";
import {
  documentStockDirection,
  ensureDefaultWarehouse,
  postNewDocumentsStock,
  syncDocumentStock,
} from "../../lib/inventory-service.js";

const SIDES = ["sale", "purchase"] as const;

const EXPECTED: Record<(typeof documentTypes)[number], { sale: -1 | 0 | 1; purchase: -1 | 0 | 1 }> = {
  invoice: { sale: -1, purchase: 1 },
  delivery_challan: { sale: -1, purchase: 1 },
  goods_receipt_note: { sale: 1, purchase: 1 },
  sales_return: { sale: 1, purchase: 1 },
  purchase_return: { sale: -1, purchase: -1 },
  credit_note: { sale: 0, purchase: 0 },
  debit_note: { sale: 0, purchase: 0 },
  quotation: { sale: 0, purchase: 0 },
  proforma: { sale: 0, purchase: 0 },
  sales_order: { sale: 0, purchase: 0 },
  purchase_order: { sale: 0, purchase: 0 },
};

const combos = documentTypes.flatMap((documentType) =>
  SIDES.map((type) => ({ documentType, type, direction: EXPECTED[documentType][type] })),
);

describe("documentStockDirection — every document type × side", () => {
  it("the table covers every document type", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...documentTypes].sort());
  });

  it.each(combos)("$documentType ($type) → $direction", ({ documentType, type, direction }) => {
    expect(documentStockDirection({ documentType, type })).toBe(direction);
  });

  it("anything unknown moves nothing", () => {
    expect(documentStockDirection({ documentType: "something_new", type: "sale" })).toBe(0);
  });
});

let world: TestWorld;

async function newDoc(documentType: string, type: "sale" | "purchase", quantity = "2") {
  const { invoice } = await createInvoiceWithItems(
    getTenantTestDb(),
    world.business1.id,
    world.party1.id,
    [{ itemId: world.item1.id, quantity, unitPrice: "10.00" }],
    { documentType: documentType as never, type, status: "sent", stockMode: "tracked" },
  );
  return invoice;
}

async function held(documentId: string) {
  const [row] = await getTenantTestDb()
    .select({ qty: sql<string>`COALESCE(SUM(${stockMovements.quantity}::numeric), 0)::text` })
    .from(stockMovements)
    .where(and(eq(stockMovements.businessId, world.business1.id), eq(stockMovements.referenceId, documentId)));
  return Number(row!.qty);
}

async function sync(documentId: string, event: "CREATE" | "UPDATE" | "CANCEL" | "REINSTATE" | "DELETE") {
  await getTenantTestDb().transaction((tx) =>
    syncDocumentStock(tx as never, { businessId: world.business1.id, documentId, event }),
  );
}

beforeAll(async () => {
  world = await createTestWorld();
  await ensureDefaultWarehouse(getTenantTestDb(), world.business1.id);
});

afterAll(async () => {
  await truncateAllTables();
});

describe("bulk posting (imports) agrees with documentStockDirection", () => {
  it("posts direction × quantity for every document type × side", async () => {
    const docs: Array<(typeof combos)[number] & { doc: Awaited<ReturnType<typeof newDoc>> }> = [];
    for (const c of combos) docs.push({ ...c, doc: await newDoc(c.documentType, c.type) });
    await getTenantTestDb().transaction((tx) =>
      postNewDocumentsStock(tx as never, { businessId: world.business1.id, documentIds: docs.map((d) => d.doc.id) }),
    );
    const got: Array<{ documentType: string; type: string; held: number }> = [];
    for (const d of docs) got.push({ documentType: d.documentType, type: d.type, held: await held(d.doc.id) });
    expect(got).toEqual(docs.map((d) => ({ documentType: d.documentType, type: d.type, held: d.direction * 2 })));
  });
});

describe("document lifecycle posts and reverses stock by direction", () => {
  it.each(combos.filter((c) => c.direction !== 0))(
    "$documentType ($type): create, cancel, reinstate, edit, delete",
    async ({ documentType, type, direction }) => {
      const db = getTenantTestDb();
      const doc = await newDoc(documentType, type, "2");

      await sync(doc.id, "CREATE");
      expect(await held(doc.id)).toBe(direction * 2);
      await sync(doc.id, "CREATE"); // idempotent
      expect(await held(doc.id)).toBe(direction * 2);

      await db.update(invoices).set({ status: "cancelled" }).where(eq(invoices.id, doc.id));
      await sync(doc.id, "CANCEL");
      expect(await held(doc.id)).toBe(0);

      await db.update(invoices).set({ status: "sent" }).where(eq(invoices.id, doc.id));
      await sync(doc.id, "REINSTATE");
      expect(await held(doc.id)).toBe(direction * 2);

      await db.update(invoiceItems).set({ quantity: "5.5" }).where(eq(invoiceItems.invoiceId, doc.id));
      await sync(doc.id, "UPDATE");
      expect(await held(doc.id)).toBe(direction * 5.5);

      await db.update(invoices).set({ deletedAt: new Date() }).where(eq(invoices.id, doc.id));
      await sync(doc.id, "DELETE");
      expect(await held(doc.id)).toBe(0);
    },
  );

  it.each(combos.filter((c) => c.direction === 0))("$documentType ($type) never moves stock", async ({ documentType, type }) => {
    const doc = await newDoc(documentType, type);
    await sync(doc.id, "CREATE");
    expect(await held(doc.id)).toBe(0);
  });

  it("a document with stock mode none moves nothing", async () => {
    const doc = await newDoc("invoice", "sale");
    await getTenantTestDb().update(invoices).set({ stockMode: "none" }).where(eq(invoices.id, doc.id));
    await sync(doc.id, "CREATE");
    expect(await held(doc.id)).toBe(0);
  });

  it("the conversion factor scales stock to the base unit", async () => {
    const doc = await newDoc("invoice", "purchase", "1.333");
    await getTenantTestDb().update(invoiceItems).set({ conversionFactor: "12" }).where(eq(invoiceItems.invoiceId, doc.id));
    await sync(doc.id, "CREATE");
    expect(await held(doc.id)).toBe(15.996); // 1.333 × 12
  });
});
