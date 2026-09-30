import { and, eq, inArray } from "drizzle-orm";
import { itemBatches } from "@fintranzact/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type LineBatch = {
  id: string;
  batchNumber: string;
  mfgDate: string | null;
  expiryDate: string | null;
  mrp: string | null;
};

/** Batch number, dates and MRP for the batches a document's lines name. */
export async function lineBatchDetails(
  db: Db,
  businessId: string,
  lines: Array<{ batchId?: string | null }>,
): Promise<Map<string, LineBatch>> {
  const ids = [...new Set(lines.map((l) => l.batchId).filter((v): v is string => !!v))];
  const map = new Map<string, LineBatch>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({
      id: itemBatches.id,
      batchNumber: itemBatches.batchNumber,
      mfgDate: itemBatches.mfgDate,
      expiryDate: itemBatches.expiryDate,
      mrp: itemBatches.mrp,
    })
    .from(itemBatches)
    .where(and(eq(itemBatches.businessId, businessId), inArray(itemBatches.id, ids)));
  for (const r of rows) map.set(r.id, r);
  return map;
}
