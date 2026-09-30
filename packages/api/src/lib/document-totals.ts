import { asc, eq } from "drizzle-orm";
import { invoiceItems, type TenantDatabase } from "@fintranzact/db";
import type { AllocatedLine } from "@fintranzact/shared";

/**
 * Line rows carry their share of the document discount: taxAmount is the tax
 * on the line's taxable value after that share, totalAmount the two together
 * (see calcInvoiceTotals). Set them on rows about to be inserted, in order.
 */
export function withAllocatedLines<T extends { taxAmount: string; totalAmount: string }>(
  rows: T[],
  lines: AllocatedLine[],
): T[] {
  return rows.map((row, i) => {
    const line = lines[i];
    return line ? { ...row, taxAmount: line.taxAmount, totalAmount: line.total } : row;
  });
}

/**
 * Re-save the allocated tax and total of a document's saved lines (in sort
 * order) after its discount, charges or lines changed.
 */
export async function saveAllocatedLines(
  tx: Pick<TenantDatabase, "select" | "update">,
  invoiceId: string,
  lines: AllocatedLine[],
) {
  const rows = await tx
    .select({ id: invoiceItems.id })
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId))
    .orderBy(asc(invoiceItems.sortOrder), asc(invoiceItems.id));
  for (let i = 0; i < rows.length && i < lines.length; i++) {
    await tx
      .update(invoiceItems)
      .set({ taxAmount: lines[i]!.taxAmount, totalAmount: lines[i]!.total })
      .where(eq(invoiceItems.id, rows[i]!.id));
  }
}
