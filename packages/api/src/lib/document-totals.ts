import { and, asc, eq } from "drizzle-orm";
import { businesses, invoiceItems, parties, type TenantDatabase } from "@fintranzact/db";
import { isIntraStateSupply, type AllocatedLine, type GstStateParty } from "@fintranzact/shared";

/**
 * Whether a document between the business and `party` (a party id, or its
 * state fields already in hand) is an intra-state supply — CGST + SGST, so
 * its totals take calcInvoiceTotals' intraState (each half rounded on its
 * own). Same place-of-supply rule as the GST returns, ledger and PDFs
 * (isIntraStateSupply: an unknown buyer state is intra-state).
 */
export async function documentIsIntraState(
  tx: Pick<TenantDatabase, "select">,
  businessId: string,
  party: string | GstStateParty | null | undefined,
): Promise<boolean> {
  const [biz] = await tx
    .select({ stateCode: businesses.stateCode, state: businesses.state, gstin: businesses.gstin })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  let buyer: GstStateParty = {};
  if (typeof party === "string") {
    const [row] = await tx
      .select({ stateCode: parties.stateCode, state: parties.state, gstin: parties.gstin })
      .from(parties)
      .where(and(eq(parties.id, party), eq(parties.businessId, businessId)))
      .limit(1);
    buyer = row ?? {};
  } else if (party) {
    buyer = party;
  }
  return isIntraStateSupply(biz ?? {}, buyer);
}

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
