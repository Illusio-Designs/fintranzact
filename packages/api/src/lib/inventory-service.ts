import { and, eq, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  businesses,
  invoiceItems,
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

/**
 * Undo the stock effect of an invoice before it is edited or deleted.
 *
 * Invoices with recorded stock movements are reversed per warehouse using the
 * net of all their movements, so repeated edits never double-reverse.
 * Invoices from before warehouses existed have no movements; their stock was
 * applied straight to item quantities, so reverse it the same way from their
 * line items.
 */
export async function reverseInvoiceStock(
  tx: InventoryDb,
  input: {
    businessId: string;
    invoiceId: string;
    invoiceType: string;
    referenceType: "INVOICE_UPDATE_REVERSAL" | "INVOICE_DELETE_REVERSAL";
    actorUserId: string;
  },
) {
  const netMovements = await tx
    .select({
      warehouseId: stockMovements.warehouseId,
      itemId: stockMovements.itemId,
      variantId: stockMovements.variantId,
      quantity: sql<string>`SUM(${stockMovements.quantity}::numeric)`,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.businessId, input.businessId),
        eq(stockMovements.referenceId, input.invoiceId),
        sql`${stockMovements.referenceType} IN ('INVOICE', 'INVOICE_UPDATE', 'INVOICE_UPDATE_REVERSAL')`,
      ),
    )
    .groupBy(stockMovements.warehouseId, stockMovements.itemId, stockMovements.variantId);

  const isSale = input.invoiceType === "sale";

  if (netMovements.length > 0) {
    for (const movement of netMovements) {
      if (Number(movement.quantity) === 0) continue;
      await recordStockMovement(tx, {
        businessId: input.businessId,
        warehouseId: movement.warehouseId,
        itemId: movement.itemId,
        variantId: movement.variantId,
        referenceType: input.referenceType,
        referenceId: input.invoiceId,
        movementType: isSale ? "SALE_REVERSAL" : "PURCHASE_REVERSAL",
        quantity: sql<string>`-(${movement.quantity})::numeric`,
        actorUserId: input.actorUserId,
      });
    }
    return;
  }

  const lineItems = await tx
    .select({
      itemId: invoiceItems.itemId,
      variantId: invoiceItems.variantId,
      quantity: invoiceItems.quantity,
      conversionFactor: invoiceItems.conversionFactor,
    })
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, input.invoiceId));

  for (const li of lineItems) {
    if (!li.itemId && !li.variantId) continue;
    const base = li.variantId
      ? sql<string>`${li.quantity}::numeric`
      : sql<string>`(${li.quantity}::numeric * ${li.conversionFactor ?? "1"}::numeric)`;
    await updateLegacyStockQuantity(tx, {
      businessId: input.businessId,
      itemId: li.itemId as string,
      variantId: li.variantId,
      // A sale took stock out, so reversing puts it back (and vice versa).
      quantity: isSale ? base : sql<string>`-${base}`,
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
/**
 * The warehouse an invoice moves stock through: the one the user picked, or
 * the business default for the operation. A picked warehouse must belong to
 * the business and be active.
 */
export async function resolveInvoiceWarehouse(
  tx: InventoryDb,
  input: { businessId: string; operation: InventoryOperation; warehouseId?: string | null },
) {
  if (!input.warehouseId) return getDefaultWarehouse(tx, input);
  const [warehouse] = await tx
    .select({ id: warehouses.id, name: warehouses.name, status: warehouses.status })
    .from(warehouses)
    .where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.businessId, input.businessId)))
    .limit(1);
  if (!warehouse) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Warehouse not found in this business" });
  }
  if (warehouse.status !== "active") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That warehouse is inactive" });
  }
  return warehouse;
}
