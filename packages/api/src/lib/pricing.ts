/**
 * Price levels: which selling price applies to a line.
 *
 * Precedence for a sale line:
 *   1. The price level: the one asked for, else the party's, else the
 *      business's default level. No level -> the item's own price.
 *   2. On that level, entries for the line's variant, then entries for the
 *      whole item (variant null); in the line's unit (an alternate unit, or
 *      the base unit). For an alternate unit with no entry of its own, the
 *      base-unit entry scaled by the conversion factor.
 *   3. Among matching entries, the latest revision (effectiveFrom) on or
 *      before the date, then the slab with the highest minQuantity that the
 *      quantity reaches.
 *   4. Nothing matches -> the variant's / alternate unit's / item's sale price.
 *
 * An entry with a rate sets the unit price; one with only a discount keeps
 * the item's own price and returns the discount for the line's discount
 * field (as Tally shows it). Levels only price sales; purchases keep using
 * the purchase price.
 */

import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { items, itemVariants, parties, priceLevels, priceListEntries } from "@fintranzact/db";
import { money } from "@fintranzact/shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type PriceLine = {
  itemId: string;
  variantId?: string | null;
  unit?: string | null;
  quantity?: string | number | null;
};

export type ResolvedPrice = {
  itemId: string;
  variantId: string | null;
  unit: string | null;
  /** Unit price for the line, in the line's unit; null when the item has no price at all. */
  unitPrice: string | null;
  /** Discount % from the level, if the entry carries one. */
  discountPercent: string | null;
  /** Price after the level's discount. */
  netPrice: string | null;
  /** "level" when a price level entry set it, "item" for the item's own price. */
  source: "level" | "item";
  minQuantity: string | null;
  mrp: string | null;
};

type Entry = typeof priceListEntries.$inferSelect;
type UnitVariant = { unit: string; conversionFactor: number; salePrice: string };

/** The level a party's sales are priced at: its own, else the default, else none. */
export async function levelForParty(db: Db, businessId: string, partyId?: string | null) {
  if (partyId) {
    const [party] = await db
      .select({ priceLevelId: parties.priceLevelId })
      .from(parties)
      .where(and(eq(parties.id, partyId), eq(parties.businessId, businessId)))
      .limit(1);
    if (party?.priceLevelId) {
      const [level] = await db.select().from(priceLevels)
        .where(and(eq(priceLevels.id, party.priceLevelId), eq(priceLevels.businessId, businessId))).limit(1);
      if (level) return level as typeof priceLevels.$inferSelect;
    }
  }
  const [def] = await db.select().from(priceLevels)
    .where(and(eq(priceLevels.businessId, businessId), eq(priceLevels.isDefault, true))).limit(1);
  return (def ?? null) as typeof priceLevels.$inferSelect | null;
}

/** Throws unless the level belongs to the business. */
export async function assertPriceLevel(db: Db, businessId: string, priceLevelId: string | null | undefined) {
  if (!priceLevelId) return;
  const [level] = await db.select({ id: priceLevels.id }).from(priceLevels)
    .where(and(eq(priceLevels.id, priceLevelId), eq(priceLevels.businessId, businessId))).limit(1);
  if (!level) throw new TRPCError({ code: "BAD_REQUEST", message: "Price level not found" });
}

/** YYYY-MM-DD of a date string (date or ISO timestamp); today when missing. */
export function dayOf(date?: string | null): string {
  if (date && /^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

/**
 * Of the entries for one variant/unit, the one that applies: latest revision
 * on or before `day`, then the highest slab the quantity reaches.
 */
export function pickEntry(entries: Entry[], day: string, quantity: number): Entry | null {
  const live = entries.filter((e) => !e.effectiveFrom || e.effectiveFrom <= day);
  if (live.length === 0) return null;
  const latest = live.reduce<string>((m, e) => ((e.effectiveFrom ?? "") > m ? (e.effectiveFrom ?? "") : m), "");
  const revision = live.filter((e) => (e.effectiveFrom ?? "") === latest);
  let best: Entry | null = null;
  for (const e of revision) {
    const min = parseFloat(e.minQuantity);
    if (min <= quantity + 1e-9 && (!best || min > parseFloat(best.minQuantity))) best = e;
  }
  return best;
}

function net(price: string | null, discount: string | null): string | null {
  if (price == null) return null;
  if (!discount) return money.add(price, 0);
  return money.sub(price, money.percent(price, discount));
}

/** Prices for sale lines on one level (or none), as of a date. */
export async function resolvePrices(
  db: Db,
  businessId: string,
  levelId: string | null,
  lines: PriceLine[],
  date?: string | null,
): Promise<ResolvedPrice[]> {
  const day = dayOf(date);
  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  if (itemIds.length === 0) return [];

  const itemRows = (await db
    .select({ id: items.id, unit: items.unit, salePrice: items.salePrice, mrp: items.mrp, unitVariants: items.unitVariants })
    .from(items)
    .where(and(eq(items.businessId, businessId), inArray(items.id, itemIds)))) as Array<{
    id: string; unit: string; salePrice: string | null; mrp: string | null; unitVariants: UnitVariant[] | null;
  }>;
  const itemById = new Map(itemRows.map((i) => [i.id, i]));

  const variantIds = [...new Set(lines.map((l) => l.variantId).filter((v): v is string => !!v))];
  const variantRows = variantIds.length
    ? ((await db
        .select({ id: itemVariants.id, itemId: itemVariants.itemId, salePrice: itemVariants.salePrice, mrp: itemVariants.mrp })
        .from(itemVariants)
        .where(inArray(itemVariants.id, variantIds))) as Array<{ id: string; itemId: string; salePrice: string | null; mrp: string | null }>)
    : [];
  const variantById = new Map(variantRows.map((v) => [v.id, v]));

  const entries: Entry[] = levelId
    ? await db.select().from(priceListEntries)
        .where(and(eq(priceListEntries.businessId, businessId), eq(priceListEntries.priceLevelId, levelId), inArray(priceListEntries.itemId, itemIds)))
    : [];

  return lines.map((line): ResolvedPrice => {
    const item = itemById.get(line.itemId);
    const variant = line.variantId ? variantById.get(line.variantId) : undefined;
    const variantId = variant && variant.itemId === line.itemId ? variant.id : null;
    const qtyRaw = parseFloat(String(line.quantity ?? "1"));
    const qty = Number.isFinite(qtyRaw) ? qtyRaw : 1;
    const out = (p: Partial<ResolvedPrice>): ResolvedPrice => ({
      itemId: line.itemId, variantId, unit: line.unit ?? null,
      unitPrice: null, discountPercent: null, netPrice: null, source: "item", minQuantity: null, mrp: null, ...p,
    });
    if (!item) return out({});

    const alt = line.unit && line.unit !== item.unit
      ? (item.unitVariants ?? []).find((u) => u.unit === line.unit)
      : undefined;
    const factor = alt ? alt.conversionFactor : 1;
    const baseSale = variant?.salePrice ?? item.salePrice;
    const ownPrice = alt
      ? (alt.salePrice ? money.add(alt.salePrice, 0) : baseSale != null ? money.mul(baseSale, factor) : null)
      : baseSale;
    const baseMrp = (variantId ? variant?.mrp : null) ?? item.mrp;
    const mrp = baseMrp != null ? (alt ? money.mul(baseMrp, factor) : money.add(baseMrp, 0)) : null;

    const isBase = (e: Entry) => !e.unit || e.unit === item.unit;
    const forItem = entries.filter((e) => e.itemId === item.id);
    const tries: Array<{ match: (e: Entry) => boolean; scale: number }> = [];
    for (const v of variantId ? [variantId, null] : [null]) {
      const vMatch = (e: Entry) => (e.variantId ?? null) === v;
      if (alt) tries.push({ match: (e) => vMatch(e) && e.unit === alt.unit, scale: 1 });
      else tries.push({ match: (e) => vMatch(e) && isBase(e), scale: 1 });
    }
    if (alt) {
      for (const v of variantId ? [variantId, null] : [null]) {
        tries.push({ match: (e) => (e.variantId ?? null) === v && isBase(e), scale: factor });
      }
    }

    for (const t of tries) {
      const hit = pickEntry(forItem.filter(t.match), day, qty * t.scale);
      if (!hit) continue;
      const unitPrice = hit.price != null ? money.mul(hit.price, t.scale) : ownPrice;
      const discountPercent = hit.discountPercent != null && parseFloat(hit.discountPercent) > 0 ? hit.discountPercent : null;
      return out({
        unitPrice,
        discountPercent,
        netPrice: net(unitPrice, discountPercent),
        source: "level",
        minQuantity: hit.minQuantity,
        mrp,
      });
    }
    return out({ unitPrice: ownPrice, netPrice: net(ownPrice, null), mrp });
  });
}

/** Active entries of a level for the grid/report: base unit, whole item or per variant. */
export async function levelEntries(db: Db, businessId: string, levelIds: string[]) {
  if (levelIds.length === 0) return [] as Entry[];
  return (await db.select().from(priceListEntries)
    .where(and(eq(priceListEntries.businessId, businessId), inArray(priceListEntries.priceLevelId, levelIds)))) as Entry[];
}
