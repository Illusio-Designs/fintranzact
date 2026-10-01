import { describe, expect, it, vi } from "vitest";
import { invalidateStockViews } from "../stock-cache";

describe("invalidateStockViews", () => {
  it("refetches every view of stock: items, warehouses and balances, batches, inventory reports", async () => {
    const calls: string[] = [];
    const spy = (name: string) => vi.fn(async () => void calls.push(name));
    const utils = {
      item: { list: { invalidate: spy("item.list") } },
      stock: { invalidate: spy("stock") },
      batch: { invalidate: spy("batch") },
      inventoryReports: { invalidate: spy("inventoryReports") },
    };
    // A sale used to refresh only the item list: the Warehouses page kept
    // showing the stock from before it for 30 seconds.
    await invalidateStockViews(utils as unknown as Parameters<typeof invalidateStockViews>[0]);
    expect(calls.sort()).toEqual(["batch", "inventoryReports", "item.list", "stock"]);
  });
});
