import { and, eq, sql, type SQL } from "drizzle-orm";
import {
  items,
  itemVariants,
  stockBalances,
  stockMovements,
  warehouses,
  warehouseLocations,
  inventorySettings,
} from "@hisaabo/db";

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
  const [settings] = await tx
    .select()
    .from(inventorySettings)
    .where(eq(inventorySettings.businessId, input.businessId))
    .limit(1);

  if (!settings) {
    throw new Error("Inventory settings not configured for this business.");
  }

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
 * Keep Hisaabo's existing aggregate stockQuantity fields synchronized.
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