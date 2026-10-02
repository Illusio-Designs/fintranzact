import { inArray, isNull, sql, type SQL } from "drizzle-orm";
import { invoices } from "@fintranzact/db";
import { z } from "zod";

const CHANNELS = ["pos", "online_store", "webhook"] as const;
const SOURCES = ["manual", ...CHANNELS, "import"] as const;
type Source = (typeof SOURCES)[number];

/**
 * The "+ Filter" choices on invoice and document lists. Status, type, date
 * range and search have their own inputs; these are the extra filters.
 */
export const documentFilterSchema = {
  /** One or more parties. */
  partyIds: z.array(z.string().uuid()).max(50).nullish(),
  /** Grand total, inclusive. */
  minAmount: z.number().nonnegative().nullish(),
  maxAmount: z.number().nonnegative().nullish(),
  /** "Overdue" is a status chip, so it isn't repeated here. */
  due: z.enum(["next7", "next30", "none"]).nullish(),
  /** Where it came from: typed in the app, POS, online store, API, or imported (Tally, myBillBook…). */
  source: z.array(z.enum(SOURCES)).max(SOURCES.length).nullish(),
};

interface DocumentFilters {
  partyIds?: string[] | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  due?: "next7" | "next30" | "none" | null;
  source?: Source[] | null;
}

/** WHERE conditions for the filters that are set. */
export function documentFilterConditions(f: DocumentFilters): SQL[] {
  const out: SQL[] = [];
  if (f.partyIds?.length) out.push(inArray(invoices.partyId, f.partyIds));
  if (f.minAmount != null) out.push(sql`${invoices.totalAmount}::numeric >= ${f.minAmount}`);
  if (f.maxAmount != null) out.push(sql`${invoices.totalAmount}::numeric <= ${f.maxAmount}`);
  if (f.due === "none") out.push(isNull(invoices.dueDate));
  else if (f.due) {
    const days = f.due === "next7" ? 7 : 30;
    out.push(sql`${invoices.dueDate} >= date_trunc('day', NOW())`);
    out.push(sql`${invoices.dueDate} < date_trunc('day', NOW()) + make_interval(days => ${days + 1})`);
  }
  if (f.source?.length) {
    // Typed in the app = no source; imported = any source that isn't one of our channels.
    const parts: SQL[] = [];
    const channels = CHANNELS.filter((c) => f.source!.includes(c));
    if (f.source.includes("manual")) parts.push(sql`${invoices.source} IS NULL`);
    if (channels.length) parts.push(inArray(invoices.source, [...channels]));
    if (f.source.includes("import")) {
      parts.push(sql`(${invoices.source} IS NOT NULL AND ${invoices.source} NOT IN ('pos', 'online_store', 'webhook'))`);
    }
    out.push(sql`(${sql.join(parts, sql` OR `)})`);
  }
  return out;
}
