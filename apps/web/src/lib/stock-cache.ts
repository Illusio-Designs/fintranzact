import type { trpc } from "@/lib/trpc";

type Utils = Pick<ReturnType<typeof trpc.useUtils>, "item" | "stock" | "batch" | "inventoryReports">;

/**
 * After anything that moves stock (a sale, purchase, return, conversion,
 * cancellation, transfer, adjustment, count or production run): every view
 * of stock refetches. Queries stay fresh for 30 seconds, so without this the
 * Warehouses page, a line's "in this warehouse" hint, batch pickers and the
 * inventory reports kept showing the stock from before.
 */
export function invalidateStockViews(utils: Utils) {
  return Promise.all([
    utils.item.list.invalidate(),
    utils.stock.invalidate(),
    utils.batch.invalidate(),
    utils.inventoryReports.invalidate(),
  ]);
}
