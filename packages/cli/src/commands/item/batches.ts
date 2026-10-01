import { FintranzactClient, FintranzactApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";

type BatchRow = {
  batchNumber: string;
  expiryDate: string | null;
  quantity: string | number;
  expired: boolean;
  daysToExpiry: number | null;
  name?: string;
  warehouseName?: string;
};

function expiryText(r: BatchRow) {
  if (!r.expiryDate) return "no expiry";
  if (r.daysToExpiry === null) return r.expiryDate;
  if (r.expired) return `${r.expiryDate} (expired ${-r.daysToExpiry}d ago)`;
  return `${r.expiryDate} (${r.daysToExpiry}d left)`;
}

function handleError(e: unknown, what: string): never {
  if (e instanceof FintranzactApiError) {
    const err = e.fintranzactError;
    if (err.code === "not_found") fatalError(`${what} not found`, EXIT.NOT_FOUND);
    if (err.code === "unauthorized") fatalError("Session expired. Run: fintranzact login", EXIT.AUTH);
    if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
  }
  fatalError(String(e instanceof Error ? e.message : e));
}

/** fintranzact item batches <id> — an item's batches with stock and expiry. */
export async function itemBatchesCommand(id: string, opts: { json?: boolean; warehouse?: string; all?: boolean }): Promise<void> {
  const client = new FintranzactClient(requireAuth());
  try {
    const result = (await client.item.batches({
      itemId: id,
      warehouseId: opts.warehouse ?? null,
      includeEmpty: !!opts.all,
    })) as { data: BatchRow[]; unbatched: string };
    if (opts.json) { outputJSON(result); return; }
    if (result.data.length === 0) console.log("\n  No batches in stock.");
    else {
      console.log();
      for (const b of result.data) {
        console.log(`  ${b.batchNumber.padEnd(18)} ${String(parseFloat(String(b.quantity))).padStart(10)}  ${expiryText(b)}`);
      }
    }
    if (parseFloat(result.unbatched) !== 0) console.log(`\n  Not in any batch: ${parseFloat(result.unbatched)}`);
    console.log();
  } catch (e) {
    handleError(e, `Item ${id}`);
  }
}

/** fintranzact item expiring — batches expiring soon, or expired stock. */
export async function itemExpiringCommand(opts: { json?: boolean; days?: number; expired?: boolean; warehouse?: string }): Promise<void> {
  const client = new FintranzactClient(requireAuth());
  try {
    const result = (await client.item.batchStock({
      status: opts.expired ? "expired" : "expiring",
      days: opts.days ?? 30,
      warehouseId: opts.warehouse ?? null,
    })) as { data: BatchRow[]; totalValue: number };
    if (opts.json) { outputJSON(result); return; }
    if (result.data.length === 0) {
      console.log(opts.expired ? "\n  No expired stock.\n" : `\n  Nothing expires in the next ${opts.days ?? 30} days.\n`);
      return;
    }
    console.log();
    for (const r of result.data) {
      console.log(`  ${(r.name ?? "").slice(0, 32).padEnd(32)} ${r.batchNumber.padEnd(14)} ${String(r.quantity).padStart(8)}  ${expiryText(r)}  ${r.warehouseName ?? ""}`);
    }
    console.log(`\n  Value: ${result.totalValue}\n`);
  } catch (e) {
    handleError(e, "Report");
  }
}
