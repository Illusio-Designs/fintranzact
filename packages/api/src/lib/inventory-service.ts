import { and, eq, sql, type SQL } from "drizzle-orm";
import {
  businesses,
  invoiceItems,
  invoices,
  items,
  itemVariants,
  premises,
  stockBalances,
  stockMovements,
  warehouses,
  warehouseLocations,
  inventorySettings,
} from "@fintranzact/db";

const DEFAULT_CODE = "MAIN";

type InventoryDb = any;
type QuantityExpression = string | SQL<string>;

export type StockMovementInput = {
  businessId: string;

  warehouseId: string;

  sourceWarehouseId?: string | null;
  destinationWarehouseId?: string | null;

  locationId?: string | null;

  itemId: string;
  variantId?: string | null;

  batchId?: string | null;
  serialId?: string | null;

  referenceType: string;
  referenceId?: string | null;

  movementType: string;

  quantity: QuantityExpression;
  unitCost?: string | null;

  movementDate?: Date;

  actorUserId?: string | null;
};

export type StockBalanceKey = {
  businessId: string;
  warehouseId: string;
  locationId?: string | null;
  itemId: string;
  variantId?: string | null;
};

export type InventoryOperation =
  | "sale"
  | "purchase"
  | "sales_return"
  | "purchase_return"
  | "production"
  | "stock_adjustment";

export async function getDefaultWarehouse(
  tx: InventoryDb,
  input: {
    businessId: string;
    operation: InventoryOperation;
  },
) {
  const settings = await ensureDefaultWarehouse(tx, input.businessId);

  const warehouseId =
    input.operation === "sale"
      ? settings.salesWarehouseId
      : input.operation === "purchase"
        ? settings.purchaseWarehouseId
        : input.operation === "sales_return"
          ? settings.salesReturnWarehouseId
          : input.operation === "purchase_return"
            ? settings.purchaseReturnWarehouseId
            : input.operation === "production"
              ? settings.productionWarehouseId
              : settings.stockAdjustmentWarehouseId;

  if (!warehouseId) {
    throw new Error(
      `Default warehouse is not configured for ${input.operation}.`,
    );
  }

  const [warehouse] = await tx
    .select({
      id: warehouses.id,
      name: warehouses.name,
      status: warehouses.status,
    })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.id, warehouseId),
        eq(warehouses.businessId, input.businessId),
      ),
    )
    .limit(1);

  if (!warehouse) {
    throw new Error(
      `Configured default warehouse for ${input.operation} does not belong to this business.`,
    );
  }

  if (warehouse.status !== "active") {
    throw new Error(
      `Configured default warehouse for ${input.operation} is not active.`,
    );
  }

  return warehouse;
}

/**
 * Make sure a business has inventory settings pointing at a warehouse.
 *
 * New businesses get this at registration (business.create). Businesses that
 * existed before warehouses were introduced get it lazily the first time stock
 * moves. The default is one "Main" premise + warehouse built from the business
 * address, used for every operation. Safe to call concurrently: the unique
 * indexes on (business, code) and inventory_settings.business_id absorb races.
 */
export async function ensureDefaultWarehouse(tx: InventoryDb, businessId: string) {
  const [existing] = await tx
    .select()
    .from(inventorySettings)
    .where(eq(inventorySettings.businessId, businessId))
    .limit(1);
  if (existing) return existing;

  const [biz] = await tx
    .select({
      address: businesses.address,
      city: businesses.city,
      state: businesses.state,
      pincode: businesses.pincode,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!biz) throw new Error("Business not found.");

  const fullAddress =
    [biz.address, biz.city, biz.state, biz.pincode].filter(Boolean).join(", ") || null;

  // Reuse a warehouse the business already set up by hand, if any.
  let [warehouse] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.businessId, businessId), eq(warehouses.status, "active")))
    .limit(1);

  if (!warehouse) {
    await tx
      .insert(premises)
      .values({
        businessId,
        name: "Main premises",
        code: DEFAULT_CODE,
        address: biz.address ?? null,
        city: biz.city ?? null,
        state: biz.state ?? null,
      })
      .onConflictDoNothing();
    const [premise] = await tx
      .select({ id: premises.id })
      .from(premises)
      .where(and(eq(premises.businessId, businessId), eq(premises.code, DEFAULT_CODE)))
      .limit(1);

    await tx
      .insert(warehouses)
      .values({
        businessId,
        premiseId: premise!.id,
        name: "Main warehouse",
        code: DEFAULT_CODE,
        warehouseType: "main",
        address: fullAddress,
      })
      .onConflictDoNothing();
    [warehouse] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.businessId, businessId), eq(warehouses.code, DEFAULT_CODE)))
      .limit(1);
  }

  const warehouseId = warehouse!.id;
  await tx
    .insert(inventorySettings)
    .values({
      businessId,
      salesWarehouseId: warehouseId,
      purchaseWarehouseId: warehouseId,
      salesReturnWarehouseId: warehouseId,
      purchaseReturnWarehouseId: warehouseId,
      productionWarehouseId: warehouseId,
      stockAdjustmentWarehouseId: warehouseId,
    })
    .onConflictDoNothing();

  const [settings] = await tx
    .select()
    .from(inventorySettings)
    .where(eq(inventorySettings.businessId, businessId))
    .limit(1);
  return settings!;
}

type StockDocument = {
  documentType: string;
  type: string;
};

/**
 * Which way a document moves stock: -1 out, +1 in, 0 not at all.
 * Credit and debit notes are financial only — goods coming back or going back
 * are recorded with a sales return or purchase return instead.
 */
export function documentStockDirection(doc: StockDocument): -1 | 0 | 1 {
  switch (doc.documentType) {
    case "invoice":
      return doc.type === "sale" ? -1 : 1;
    case "delivery_challan":
    case "purchase_return":
      return -1;
    case "sales_return":
      return 1;
    default:
      return 0;
  }
}

function documentOperation(doc: StockDocument): InventoryOperation {
  switch (doc.documentType) {
    case "sales_return":
      return "sales_return";
    case "purchase_return":
      return "purchase_return";
    case "invoice":
      return doc.type === "sale" ? "sale" : "purchase";
    default:
      return "sale";
  }
}

function documentMovementType(doc: StockDocument) {
  if (doc.documentType === "invoice") return doc.type === "sale" ? "SALE" : "PURCHASE";
  return doc.documentType.toUpperCase();
}

/** Reference-type prefix for a document's movements: INVOICE… or DOCUMENT…. */
function documentReferencePrefix(doc: StockDocument) {
  return doc.documentType === "invoice" ? "INVOICE" : "DOCUMENT";
}

export type DocumentStockEvent = "CREATE" | "UPDATE" | "CANCEL" | "REINSTATE" | "DELETE";

/**
 * Bring a document's stock effect in line with what it should be right now.
 *
 * A document holds stock while it is live (not cancelled, not deleted) and
 * its stock mode isn't "none". What it should hold comes from its line items;
 * what it holds is the net of the stock movements already recorded against
 * it. Only the difference is posted, so this is safe to call after any
 * change — create, edit, cancel, reinstate, delete — and calling it twice
 * changes nothing.
 *
 * Documents from before stock movements existed ("legacy") applied their
 * effect straight to item totals; that is undone from their line items first,
 * after which they are tracked like any other document.
 *
 * Call it after the document row and its line items are written, inside the
 * same transaction.
 */
export async function syncDocumentStock(
  tx: InventoryDb,
  input: {
    businessId: string;
    documentId: string;
    event: DocumentStockEvent;
    actorUserId?: string | null;
    /** Warehouse to hold the stock in. Defaults to where the document already
     *  holds it, else the business default for the operation. */
    warehouseId?: string | null;
  },
) {
  const [doc] = await tx
    .select({
      id: invoices.id,
      type: invoices.type,
      documentType: invoices.documentType,
      status: invoices.status,
      deletedAt: invoices.deletedAt,
      stockMode: invoices.stockMode,
      invoiceDate: invoices.invoiceDate,
    })
    .from(invoices)
    .where(and(eq(invoices.id, input.documentId), eq(invoices.businessId, input.businessId)))
    .limit(1);
  if (!doc) return;

  const direction = documentStockDirection(doc);
  if (doc.stockMode === "none" || direction === 0) return;

  if (doc.stockMode === "legacy") {
    await undoLegacyDocumentStock(tx, input.businessId, doc.id, direction);
    await tx.update(invoices).set({ stockMode: "tracked" }).where(eq(invoices.id, doc.id));
  }

  const prefix = documentReferencePrefix(doc);
  const holdsStock = !doc.deletedAt && doc.status !== "cancelled";

  const warehouseId = holdsStock
    ? input.warehouseId
      ?? (await currentDocumentWarehouse(tx, input.businessId, doc.id, prefix))
      ?? (await getDefaultWarehouse(tx, { businessId: input.businessId, operation: documentOperation(doc) })).id
    : null;

  // Desired holding per (item, variant) at one warehouse, minus the net already
  // recorded per (warehouse, item, variant). Each line rounds to the 3 decimals
  // stock quantities are stored with, the same as when it was posted.
  const diffs = (await tx.execute(sql`
    WITH desired AS (
      SELECT COALESCE(li.item_id, v.item_id) AS item_id,
             li.variant_id,
             SUM(ROUND(li.quantity::numeric
               * CASE WHEN li.variant_id IS NULL THEN COALESCE(li.conversion_factor, 1)::numeric ELSE 1 END, 3))
               * ${direction} AS qty
      FROM invoice_items li
      LEFT JOIN item_variants v ON v.id = li.variant_id
      WHERE li.invoice_id = ${doc.id}
        AND ${holdsStock ? sql`TRUE` : sql`FALSE`}
        AND COALESCE(li.item_id, v.item_id) IS NOT NULL
      GROUP BY 1, 2
    ),
    held AS (
      SELECT warehouse_id, item_id, variant_id, SUM(quantity::numeric) AS qty
      FROM stock_movements
      WHERE business_id = ${input.businessId}
        AND reference_id = ${doc.id}
        AND reference_type LIKE ${prefix + "%"}
      GROUP BY 1, 2, 3
    )
    SELECT COALESCE(h.warehouse_id, ${warehouseId}::uuid) AS warehouse_id,
           COALESCE(d.item_id, h.item_id) AS item_id,
           COALESCE(d.variant_id, h.variant_id) AS variant_id,
           (COALESCE(d.qty, 0) - COALESCE(h.qty, 0))::text AS diff
    FROM desired d
    FULL OUTER JOIN held h
      ON h.warehouse_id = ${warehouseId}::uuid
     AND h.item_id = d.item_id
     AND h.variant_id IS NOT DISTINCT FROM d.variant_id
    WHERE COALESCE(d.qty, 0) - COALESCE(h.qty, 0) <> 0
  `)) as unknown as Array<{ warehouse_id: string; item_id: string; variant_id: string | null; diff: string }>;

  const movementType = documentMovementType(doc);
  const referenceType = input.event === "CREATE" ? prefix : `${prefix}_${input.event}`;

  for (const row of diffs) {
    const sameWay = Math.sign(Number(row.diff)) === direction;
    await recordStockMovement(tx, {
      businessId: input.businessId,
      warehouseId: row.warehouse_id,
      itemId: row.item_id,
      variantId: row.variant_id,
      referenceType,
      referenceId: doc.id,
      movementType: sameWay ? movementType : `${movementType}_REVERSAL`,
      quantity: row.diff,
      movementDate: input.event === "CREATE" ? doc.invoiceDate : new Date(),
      actorUserId: input.actorUserId ?? null,
    });
  }
}

/**
 * Record the stock an item or variant starts with, in the default adjustment
 * warehouse. The item/variant row must have been inserted with zero stock —
 * this movement is what sets its total.
 */
export async function recordOpeningStock(
  tx: InventoryDb,
  input: {
    businessId: string;
    itemId: string;
    variantId?: string | null;
    quantity: string | null | undefined;
    actorUserId?: string | null;
  },
) {
  if (!input.quantity || Number(input.quantity) === 0) return;
  const warehouse = await getDefaultWarehouse(tx, {
    businessId: input.businessId,
    operation: "stock_adjustment",
  });
  await recordStockMovement(tx, {
    businessId: input.businessId,
    warehouseId: warehouse.id,
    itemId: input.itemId,
    variantId: input.variantId ?? null,
    referenceType: "OPENING_BALANCE",
    referenceId: input.variantId ?? input.itemId,
    movementType: "OPENING",
    quantity: input.quantity,
    actorUserId: input.actorUserId ?? null,
  });
}

/**
 * Post the stock effect of many freshly inserted documents at once (imports).
 *
 * Same result as syncDocumentStock per document — one movement per
 * (document, item, variant) at the default warehouse for its operation — but
 * inserted in one statement, with warehouse balances and item totals updated
 * once per item instead of once per line. Only documents with stock mode
 * "tracked" that don't hold stock yet should be passed.
 */
export async function postNewDocumentsStock(
  tx: InventoryDb,
  input: { businessId: string; documentIds: string[]; actorUserId?: string | null },
) {
  if (input.documentIds.length === 0) return;

  const warehouseFor = async (operation: InventoryOperation) =>
    (await getDefaultWarehouse(tx, { businessId: input.businessId, operation })).id as string;
  const [saleWh, purchaseWh, salesReturnWh, purchaseReturnWh] = [
    await warehouseFor("sale"),
    await warehouseFor("purchase"),
    await warehouseFor("sales_return"),
    await warehouseFor("purchase_return"),
  ];

  // Keep in step with documentStockDirection / documentOperation.
  const direction = sql`CASE
      WHEN i.document_type = 'invoice' THEN CASE WHEN i.type = 'sale' THEN -1 ELSE 1 END
      WHEN i.document_type IN ('delivery_challan', 'purchase_return') THEN -1
      WHEN i.document_type = 'sales_return' THEN 1
      ELSE 0 END`;
  const warehouse = sql`CASE
      WHEN i.document_type = 'sales_return' THEN ${salesReturnWh}::uuid
      WHEN i.document_type = 'purchase_return' THEN ${purchaseReturnWh}::uuid
      WHEN i.document_type = 'invoice' AND i.type = 'purchase' THEN ${purchaseWh}::uuid
      ELSE ${saleWh}::uuid END`;

  const totals = (await tx.execute(sql`
    WITH ins AS (
      INSERT INTO stock_movements
        (business_id, warehouse_id, item_id, variant_id, reference_type, reference_id,
         movement_type, quantity, movement_date, actor_user_id)
      SELECT i.business_id,
             ${warehouse},
             COALESCE(li.item_id, v.item_id),
             li.variant_id,
             CASE WHEN i.document_type = 'invoice' THEN 'INVOICE' ELSE 'DOCUMENT' END,
             i.id,
             CASE WHEN i.document_type = 'invoice'
                  THEN CASE WHEN i.type = 'sale' THEN 'SALE' ELSE 'PURCHASE' END
                  ELSE upper(i.document_type::text) END,
             SUM(ROUND(li.quantity::numeric
               * CASE WHEN li.variant_id IS NULL THEN COALESCE(li.conversion_factor, 1)::numeric ELSE 1 END, 3))
               * ${direction},
             i.invoice_date,
             ${input.actorUserId ?? null}::uuid
      FROM invoices i
      JOIN invoice_items li ON li.invoice_id = i.id
      LEFT JOIN item_variants v ON v.id = li.variant_id
      WHERE i.business_id = ${input.businessId}
        AND i.id IN ${input.documentIds}
        AND i.stock_mode = 'tracked'
        AND i.deleted_at IS NULL
        AND i.status <> 'cancelled'
        AND ${direction} <> 0
        AND COALESCE(li.item_id, v.item_id) IS NOT NULL
      GROUP BY i.id, i.business_id, i.document_type, i.type, i.invoice_date,
               COALESCE(li.item_id, v.item_id), li.variant_id
      RETURNING warehouse_id, item_id, variant_id, quantity
    )
    SELECT warehouse_id, item_id, variant_id, SUM(quantity)::text AS quantity
    FROM ins
    GROUP BY 1, 2, 3
  `)) as unknown as Array<{ warehouse_id: string; item_id: string; variant_id: string | null; quantity: string }>;

  for (const row of totals) {
    if (Number(row.quantity) === 0) continue;
    await updateStockBalance(tx, {
      businessId: input.businessId,
      warehouseId: row.warehouse_id,
      itemId: row.item_id,
      variantId: row.variant_id,
    }, row.quantity);
    await updateLegacyStockQuantity(tx, {
      businessId: input.businessId,
      itemId: row.item_id,
      variantId: row.variant_id,
      quantity: row.quantity,
    });
  }
}

/** The warehouse a document most recently posted stock into, if any. */
async function currentDocumentWarehouse(
  tx: InventoryDb,
  businessId: string,
  documentId: string,
  prefix: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ warehouseId: stockMovements.warehouseId })
    .from(stockMovements)
    .where(and(
      eq(stockMovements.businessId, businessId),
      eq(stockMovements.referenceId, documentId),
      sql`${stockMovements.referenceType} LIKE ${prefix + "%"}`,
      sql`${stockMovements.movementType} NOT LIKE '%_REVERSAL'`,
    ))
    .orderBy(sql`${stockMovements.createdAt} DESC`)
    .limit(1);
  return row?.warehouseId ?? null;
}

/** Undo a pre-movements document's effect on item totals, from its lines. */
async function undoLegacyDocumentStock(
  tx: InventoryDb,
  businessId: string,
  documentId: string,
  direction: -1 | 1,
) {
  const lineItems = await tx
    .select({
      itemId: invoiceItems.itemId,
      variantId: invoiceItems.variantId,
      quantity: invoiceItems.quantity,
      conversionFactor: invoiceItems.conversionFactor,
    })
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, documentId));

  for (const li of lineItems) {
    if (!li.itemId && !li.variantId) continue;
    const base = li.variantId
      ? sql<string>`${li.quantity}::numeric`
      : sql<string>`(${li.quantity}::numeric * ${li.conversionFactor ?? "1"}::numeric)`;
    await updateLegacyStockQuantity(tx, {
      businessId,
      itemId: li.itemId as string,
      variantId: li.variantId,
      // Stock that went out comes back, and stock that came in goes out.
      quantity: direction === -1 ? base : sql<string>`-${base}`,
    });
  }
}

export async function validateInventoryLocation(
  tx: InventoryDb,
  input: {
    businessId: string;
    warehouseId: string;
    locationId?: string | null;
  },
) {
  const [warehouse] = await tx
    .select({
      id: warehouses.id,
      status: warehouses.status,
    })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.id, input.warehouseId),
        eq(warehouses.businessId, input.businessId),
      ),
    )
    .limit(1);

  if (!warehouse) {
    throw new Error("Warehouse does not belong to this business.");
  }

  if (warehouse.status !== "active") {
    throw new Error("Warehouse is not active.");
  }

  if (!input.locationId) {
    return warehouse;
  }

  const [location] = await tx
    .select({
      id: warehouseLocations.id,
      status: warehouseLocations.status,
    })
    .from(warehouseLocations)
    .where(
      and(
        eq(warehouseLocations.id, input.locationId),
        eq(warehouseLocations.warehouseId, input.warehouseId),
      ),
    )
    .limit(1);

  if (!location) {
    throw new Error("Location does not belong to this warehouse.");
  }

  if (location.status !== "active") {
    throw new Error("Location is not active.");
  }

  return warehouse;
}

/**
 * Central inventory service.
 *
 * Responsibilities:
 * 1. Record immutable stock movement history.
 * 2. Maintain current stock balance for a warehouse/location/item.
 * 3. Keep legacy items.stockQuantity / itemVariants.stockQuantity
 *    synchronized while the migration to warehouse-aware inventory
 *    is being completed.
 *
 * This service expects to run inside an existing Drizzle transaction.
 */
export async function recordStockMovement(
  tx: InventoryDb,
  input: StockMovementInput,
) {
  const quantity = input.quantity;

  await validateInventoryLocation(tx, {
    businessId: input.businessId,
    warehouseId: input.warehouseId,
    locationId: input.locationId,
  });

  const [movement] = await tx
    .insert(stockMovements)
    .values({
      businessId: input.businessId,
      warehouseId: input.warehouseId,
      sourceWarehouseId: input.sourceWarehouseId ?? null,
      destinationWarehouseId: input.destinationWarehouseId ?? null,
      locationId: input.locationId ?? null,
      itemId: input.itemId,
      variantId: input.variantId ?? null,
      batchId: input.batchId ?? null,
      serialId: input.serialId ?? null,
      referenceType: input.referenceType,
      referenceId: input.referenceId ?? null,
      movementType: input.movementType,
      quantity,
      unitCost: input.unitCost ?? null,
      movementDate: input.movementDate ?? new Date(),
      actorUserId: input.actorUserId ?? null,
    })
    .returning();

  await updateStockBalance(tx, {
    businessId: input.businessId,
    warehouseId: input.warehouseId,
    locationId: input.locationId ?? null,
    itemId: input.itemId,
    variantId: input.variantId ?? null,
  }, quantity);

  await updateLegacyStockQuantity(tx, {
    businessId: input.businessId,
    itemId: input.itemId,
    variantId: input.variantId ?? null,
    quantity,
  });

  return movement;
}

/**
 * Update the current warehouse/location stock balance.
 *
 * If the balance row does not exist, create it.
 * If it exists, atomically increment the quantity.
 */
export async function updateStockBalance(
  tx: InventoryDb,
  key: StockBalanceKey,
  quantity: QuantityExpression,
) {
  const locationCondition = key.locationId
    ? eq(stockBalances.locationId, key.locationId)
    : sql`${stockBalances.locationId} IS NULL`;

  const variantCondition = key.variantId
    ? eq(stockBalances.variantId, key.variantId)
    : sql`${stockBalances.variantId} IS NULL`;

  const conditions = and(
    eq(stockBalances.businessId, key.businessId),
    eq(stockBalances.warehouseId, key.warehouseId),
    locationCondition,
    eq(stockBalances.itemId, key.itemId),
    variantCondition,
  );

  const [existing] = await tx
    .select({ id: stockBalances.id })
    .from(stockBalances)
    .where(conditions)
    .limit(1);

  if (existing) {
    const [updated] = await tx
      .update(stockBalances)
      .set({
        quantity: sql`${stockBalances.quantity}::numeric + ${quantity}::numeric`,
        updatedAt: new Date(),
      })
      .where(eq(stockBalances.id, existing.id))
      .returning();

    return updated;
  }

  const [created] = await tx
    .insert(stockBalances)
    .values({
      businessId: key.businessId,
      warehouseId: key.warehouseId,
      locationId: key.locationId ?? null,
      itemId: key.itemId,
      variantId: key.variantId ?? null,
      quantity,
      reservedQuantity: "0",
      damagedQuantity: "0",
      blockedQuantity: "0",
    })
    .returning();

  return created;
}

/**
 * Read the current stock balance for one warehouse/location/item.
 */
export async function getStockBalance(
  tx: InventoryDb,
  key: StockBalanceKey,
) {
  const locationCondition = key.locationId
    ? eq(stockBalances.locationId, key.locationId)
    : sql`${stockBalances.locationId} IS NULL`;

  const variantCondition = key.variantId
    ? eq(stockBalances.variantId, key.variantId)
    : sql`${stockBalances.variantId} IS NULL`;

  return tx
    .select()
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.businessId, key.businessId),
        eq(stockBalances.warehouseId, key.warehouseId),
        locationCondition,
        eq(stockBalances.itemId, key.itemId),
        variantCondition,
      ),
    )
    .limit(1);
}

/**
 * Keep Fintranzact's existing aggregate stockQuantity fields synchronized.
 *
 * This is deliberately separate from warehouse-aware stock_balances.
 * Existing invoice/POS/report code still depends on these fields.
 */
export async function updateLegacyStockQuantity(
  tx: InventoryDb,
  input: {
    businessId: string;
    itemId: string;
    variantId?: string | null;
    quantity: QuantityExpression;
  },
) {
  if (input.variantId) {
    await tx
      .update(itemVariants)
      .set({
        stockQuantity: sql`${itemVariants.stockQuantity}::numeric + ${input.quantity}::numeric`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(itemVariants.id, input.variantId),
          sql`EXISTS (
            SELECT 1
            FROM ${items}
            WHERE ${items.id} = ${itemVariants.itemId}
              AND ${items.businessId} = ${input.businessId}
          )`,
        ),
      );

    return;
  }

  await tx
    .update(items)
    .set({
      stockQuantity: sql`${items.stockQuantity}::numeric + ${input.quantity}::numeric`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(items.id, input.itemId),
        eq(items.businessId, input.businessId),
      ),
    );
}