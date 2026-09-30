/**
 * Price levels (Tally "Price Levels / Price Lists"): named selling-price
 * levels, the prices and quantity slabs of each item on them, and the
 * resolver the entry forms use to price a sale line for a party.
 */

import { and, asc, eq, ilike, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { items, itemVariants, parties, priceLevels, priceListEntries } from "@fintranzact/db";
import { money, priceSlabSchema, decimalStr } from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";
import { escapeLike } from "../lib/escape-like.js";
import { dayOf, resolvePrices } from "../lib/pricing.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const levelFields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
};

export async function getLevel(db: Db, businessId: string, id: string) {
  const [level] = await db.select().from(priceLevels)
    .where(and(eq(priceLevels.id, id), eq(priceLevels.businessId, businessId))).limit(1);
  if (!level) throw new TRPCError({ code: "NOT_FOUND", message: "Price level not found" });
  return level as typeof priceLevels.$inferSelect;
}

async function getItem(db: Db, businessId: string, itemId: string) {
  const [item] = await db.select({ id: items.id, unit: items.unit, unitVariants: items.unitVariants })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.businessId, businessId), isNull(items.deletedAt))).limit(1);
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
  return item as { id: string; unit: string; unitVariants: Array<{ unit: string }> | null };
}

async function assertVariant(db: Db, itemId: string, variantId: string | null | undefined) {
  if (!variantId) return;
  const [v] = await db.select({ id: itemVariants.id }).from(itemVariants)
    .where(and(eq(itemVariants.id, variantId), eq(itemVariants.itemId, itemId))).limit(1);
  if (!v) throw new TRPCError({ code: "BAD_REQUEST", message: "Variant not found on this item" });
}

/** Clear the default flag on the business's other levels (only one default). */
async function clearOtherDefaults(tx: Db, businessId: string, keepId: string | null) {
  await tx.update(priceLevels)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(eq(priceLevels.businessId, businessId), eq(priceLevels.isDefault, true), keepId ? ne(priceLevels.id, keepId) : undefined));
}

function uniqueViolation(err: unknown) {
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

/** Match the rows of one level/item/variant/unit/effective date. */
function revisionWhere(businessId: string, r: {
  priceLevelId: string; itemId: string; variantId?: string | null; unit?: string | null; effectiveFrom?: string | null;
}) {
  return and(
    eq(priceListEntries.businessId, businessId),
    eq(priceListEntries.priceLevelId, r.priceLevelId),
    eq(priceListEntries.itemId, r.itemId),
    r.variantId ? eq(priceListEntries.variantId, r.variantId) : isNull(priceListEntries.variantId),
    r.unit ? eq(priceListEntries.unit, r.unit) : isNull(priceListEntries.unit),
    r.effectiveFrom ? eq(priceListEntries.effectiveFrom, r.effectiveFrom) : isNull(priceListEntries.effectiveFrom),
  );
}

/** Set (or with price null, remove) the plain price: no slab, base unit, no date. */
async function setBasePrice(tx: Db, businessId: string, cell: {
  priceLevelId: string; itemId: string; variantId?: string | null; price: string | null;
}) {
  const where = and(
    revisionWhere(businessId, { ...cell, unit: null, effectiveFrom: null }),
    eq(priceListEntries.minQuantity, "0"),
  );
  if (!cell.price) {
    await tx.delete(priceListEntries).where(where);
    return;
  }
  const [existing] = await tx.select({ id: priceListEntries.id }).from(priceListEntries).where(where).limit(1);
  if (existing) {
    await tx.update(priceListEntries)
      .set({ price: cell.price, updatedAt: new Date() })
      .where(eq(priceListEntries.id, existing.id));
  } else {
    await tx.insert(priceListEntries).values({
      businessId,
      priceLevelId: cell.priceLevelId,
      itemId: cell.itemId,
      variantId: cell.variantId ?? null,
      unit: null,
      minQuantity: "0",
      price: cell.price,
      effectiveFrom: null,
    });
  }
}

function adjust(price: string, percent: number, round: "none" | "rupee") {
  const v = money.add(price, money.percent(price, percent));
  if (round === "rupee") return money.add(Math.round(parseFloat(v)), 0);
  return v;
}

export const priceLevelRouter = router({
  list: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "Item");
    return ctx.db
      .select({
        id: priceLevels.id,
        name: priceLevels.name,
        description: priceLevels.description,
        isDefault: priceLevels.isDefault,
        sortOrder: priceLevels.sortOrder,
        entryCount: sql<number>`(select count(*)::int from ${priceListEntries} where ${priceListEntries.priceLevelId} = ${priceLevels.id})`,
        partyCount: sql<number>`(select count(*)::int from ${parties} where ${parties.priceLevelId} = ${priceLevels.id})`,
      })
      .from(priceLevels)
      .where(eq(priceLevels.businessId, ctx.businessId))
      .orderBy(asc(priceLevels.sortOrder), asc(priceLevels.name));
  }),

  create: memberProcedure.input(z.object(levelFields)).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "update", "Item");
    try {
      const level = await ctx.db.transaction(async (tx) => {
        if (input.isDefault) await clearOtherDefaults(tx, ctx.businessId, null);
        const [created] = await tx.insert(priceLevels).values({
          businessId: ctx.businessId,
          name: input.name,
          description: input.description ?? null,
          isDefault: input.isDefault ?? false,
          sortOrder: input.sortOrder ?? 0,
        }).returning();
        return created;
      });
      logAudit(ctx.db, {
        businessId: ctx.businessId, userId: ctx.user.id, action: "priceLevel.create",
        entityType: "priceLevel", entityId: level.id, metadata: { name: level.name }, ipAddress: ctx.ipAddress,
      });
      return level;
    } catch (err) {
      if (uniqueViolation(err)) throw new TRPCError({ code: "CONFLICT", message: "A price level with this name already exists" });
      throw err;
    }
  }),

  update: memberProcedure
    .input(z.object({ id: z.string().uuid(), data: z.object(levelFields).partial() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");
      await getLevel(ctx.db, ctx.businessId, input.id);
      try {
        return await ctx.db.transaction(async (tx) => {
          if (input.data.isDefault) await clearOtherDefaults(tx, ctx.businessId, input.id);
          const [updated] = await tx.update(priceLevels)
            .set({ ...input.data, updatedAt: new Date() })
            .where(and(eq(priceLevels.id, input.id), eq(priceLevels.businessId, ctx.businessId)))
            .returning();
          return updated;
        });
      } catch (err) {
        if (uniqueViolation(err)) throw new TRPCError({ code: "CONFLICT", message: "A price level with this name already exists" });
        throw err;
      }
    }),

  /** Delete a level with its prices; its parties fall back to the default level. */
  delete: memberProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "delete", "Item");
    const level = await getLevel(ctx.db, ctx.businessId, input.id);
    await ctx.db.delete(priceLevels).where(and(eq(priceLevels.id, input.id), eq(priceLevels.businessId, ctx.businessId)));
    logAudit(ctx.db, {
      businessId: ctx.businessId, userId: ctx.user.id, action: "priceLevel.delete",
      entityType: "priceLevel", entityId: level.id, metadata: { name: level.name }, ipAddress: ctx.ipAddress,
    });
    return { success: true };
  }),

  /** Every entry of an item on every level (slabs, units, variants, dates). */
  itemEntries: viewerProcedure.input(z.object({ itemId: z.string().uuid() })).query(async ({ input, ctx }) => {
    requireCan(ctx.ability, "read", "Item");
    return ctx.db.select().from(priceListEntries)
      .where(and(eq(priceListEntries.businessId, ctx.businessId), eq(priceListEntries.itemId, input.itemId)))
      .orderBy(asc(priceListEntries.priceLevelId), asc(priceListEntries.effectiveFrom), asc(priceListEntries.minQuantity));
  }),

  /**
   * Replace the slabs of one level/item/variant/unit revision (the entries
   * sharing an effective date). No slabs removes that revision.
   */
  setItemPrices: memberProcedure
    .input(z.object({
      priceLevelId: z.string().uuid(),
      itemId: z.string().uuid(),
      variantId: z.string().uuid().nullable().optional(),
      unit: z.string().min(1).max(50).nullable().optional(),
      effectiveFrom: dateStr.nullable().optional(),
      slabs: z.array(priceSlabSchema).max(50),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");
      await getLevel(ctx.db, ctx.businessId, input.priceLevelId);
      const item = await getItem(ctx.db, ctx.businessId, input.itemId);
      await assertVariant(ctx.db, item.id, input.variantId);
      // The base unit is stored as null so an item's unit can be renamed.
      const unit = input.unit && input.unit !== item.unit ? input.unit : null;
      if (unit && !(item.unitVariants ?? []).some((u) => u.unit === unit)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${unit} is not a unit of this item` });
      }
      const mins = input.slabs.map((s) => parseFloat(s.minQuantity));
      if (new Set(mins).size !== mins.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Two slabs start at the same quantity" });
      }
      return ctx.db.transaction(async (tx) => {
        await tx.delete(priceListEntries).where(revisionWhere(ctx.businessId, { ...input, unit }));
        if (input.slabs.length === 0) return [];
        return tx.insert(priceListEntries).values(input.slabs.map((s) => ({
          businessId: ctx.businessId,
          priceLevelId: input.priceLevelId,
          itemId: item.id,
          variantId: input.variantId ?? null,
          unit,
          minQuantity: s.minQuantity,
          price: s.price || null,
          discountPercent: s.discountPercent || null,
          effectiveFrom: input.effectiveFrom ?? null,
        }))).returning();
      });
    }),

  /**
   * Items (and variants) with their plain price on each level: the grid on
   * the Price Levels page. `slabCount` counts the other entries (slabs,
   * alternate units, dated revisions) that the grid doesn't show.
   */
  grid: viewerProcedure
    .input(z.object({ search: z.string().max(100).optional(), category: z.string().max(100).optional() }).optional())
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Item");
      const levels = await ctx.db.select().from(priceLevels)
        .where(eq(priceLevels.businessId, ctx.businessId))
        .orderBy(asc(priceLevels.sortOrder), asc(priceLevels.name));
      const conds = [eq(items.businessId, ctx.businessId), isNull(items.deletedAt), eq(items.itemType, "product")];
      if (input?.category) conds.push(eq(items.category, input.category));
      if (input?.search) conds.push(ilike(items.name, `%${escapeLike(input.search)}%`));
      const itemRows = await ctx.db.select({
        id: items.id, name: items.name, unit: items.unit, category: items.category,
        itemMode: items.itemMode, salePrice: items.salePrice, mrp: items.mrp,
      }).from(items).where(and(...conds)).orderBy(asc(items.name)).limit(1000);
      const ids = itemRows.map((i) => i.id);
      const variants = ids.length
        ? await ctx.db.select({
            id: itemVariants.id, itemId: itemVariants.itemId, attributeValues: itemVariants.attributeValues,
            salePrice: itemVariants.salePrice, mrp: itemVariants.mrp,
          }).from(itemVariants)
            .where(and(inArray(itemVariants.itemId, ids), isNull(itemVariants.deletedAt)))
        : [];
      const entries = ids.length
        ? await ctx.db.select().from(priceListEntries)
            .where(and(eq(priceListEntries.businessId, ctx.businessId), inArray(priceListEntries.itemId, ids)))
        : [];

      const rows: Array<{
        itemId: string; variantId: string | null; name: string; unit: string; category: string | null;
        salePrice: string | null; mrp: string | null;
        prices: Record<string, string | null>; slabCount: Record<string, number>;
      }> = [];
      const cell = (itemId: string, variantId: string | null) => {
        const prices: Record<string, string | null> = {};
        const slabCount: Record<string, number> = {};
        for (const l of levels) {
          const mine = entries.filter((e) => e.itemId === itemId && e.priceLevelId === l.id && (e.variantId ?? null) === variantId);
          const plain = mine.find((e) => !e.unit && !e.effectiveFrom && parseFloat(e.minQuantity) === 0);
          prices[l.id] = plain?.price ?? null;
          slabCount[l.id] = mine.length - (plain ? 1 : 0);
        }
        return { prices, slabCount };
      };
      for (const it of itemRows) {
        const itemVars = variants.filter((v) => v.itemId === it.id);
        rows.push({ itemId: it.id, variantId: null, name: it.name, unit: it.unit, category: it.category, salePrice: it.salePrice, mrp: it.mrp, ...cell(it.id, null) });
        for (const v of itemVars) {
          rows.push({
            itemId: it.id, variantId: v.id,
            name: `${it.name} (${Object.values(v.attributeValues ?? {}).join(" / ")})`,
            unit: it.unit, category: it.category,
            salePrice: v.salePrice ?? it.salePrice, mrp: v.mrp ?? it.mrp,
            ...cell(it.id, v.id),
          });
        }
      }
      return { levels, rows };
    }),

  /** Save grid cells: each sets (or with a null price, clears) a plain price. */
  setGridPrices: memberProcedure
    .input(z.object({
      cells: z.array(z.object({
        priceLevelId: z.string().uuid(),
        itemId: z.string().uuid(),
        variantId: z.string().uuid().nullable().optional(),
        price: decimalStr.nullable(),
      })).min(1).max(2000),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");
      const levelIds = [...new Set(input.cells.map((c) => c.priceLevelId))];
      const itemIds = [...new Set(input.cells.map((c) => c.itemId))];
      const okLevels = await ctx.db.select({ id: priceLevels.id }).from(priceLevels)
        .where(and(eq(priceLevels.businessId, ctx.businessId), inArray(priceLevels.id, levelIds)));
      const okItems = await ctx.db.select({ id: items.id }).from(items)
        .where(and(eq(items.businessId, ctx.businessId), inArray(items.id, itemIds)));
      if (okLevels.length !== levelIds.length || okItems.length !== itemIds.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Price level or item not found" });
      }
      await ctx.db.transaction(async (tx) => {
        for (const c of input.cells) await setBasePrice(tx, ctx.businessId, c);
      });
      return { updated: input.cells.length };
    }),

  /**
   * Raise or lower a level's prices by a percentage: its existing rates
   * ("current"), or the items' sale prices ("salePrice", which sets each
   * item's plain price on the level).
   */
  bulkUpdate: memberProcedure
    .input(z.object({
      priceLevelId: z.string().uuid(),
      basis: z.enum(["current", "salePrice"]),
      percent: z.number().min(-100).max(1000),
      round: z.enum(["none", "rupee"]).default("none"),
      category: z.string().max(100).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");
      const level = await getLevel(ctx.db, ctx.businessId, input.priceLevelId);
      const itemConds = [eq(items.businessId, ctx.businessId), isNull(items.deletedAt)];
      if (input.category) itemConds.push(eq(items.category, input.category));

      const count = await ctx.db.transaction(async (tx) => {
        if (input.basis === "current") {
          const rows = await tx.select({ id: priceListEntries.id, price: priceListEntries.price })
            .from(priceListEntries)
            .innerJoin(items, eq(items.id, priceListEntries.itemId))
            .where(and(eq(priceListEntries.priceLevelId, level.id), ...itemConds));
          let n = 0;
          for (const r of rows) {
            if (r.price == null) continue;
            await tx.update(priceListEntries)
              .set({ price: money.max0(adjust(r.price, input.percent, input.round)), updatedAt: new Date() })
              .where(eq(priceListEntries.id, r.id));
            n++;
          }
          return n;
        }
        const itemRows = await tx.select({ id: items.id, salePrice: items.salePrice, itemMode: items.itemMode })
          .from(items).where(and(...itemConds));
        const ids = itemRows.map((i) => i.id);
        const variants = ids.length
          ? await tx.select({ id: itemVariants.id, itemId: itemVariants.itemId, salePrice: itemVariants.salePrice })
              .from(itemVariants).where(and(inArray(itemVariants.itemId, ids), isNull(itemVariants.deletedAt)))
          : [];
        let n = 0;
        for (const it of itemRows) {
          if (it.salePrice != null) {
            await setBasePrice(tx, ctx.businessId, {
              priceLevelId: level.id, itemId: it.id, price: money.max0(adjust(it.salePrice, input.percent, input.round)),
            });
            n++;
          }
          for (const v of variants.filter((x) => x.itemId === it.id && x.salePrice != null)) {
            await setBasePrice(tx, ctx.businessId, {
              priceLevelId: level.id, itemId: it.id, variantId: v.id, price: money.max0(adjust(v.salePrice!, input.percent, input.round)),
            });
            n++;
          }
        }
        return n;
      });
      logAudit(ctx.db, {
        businessId: ctx.businessId, userId: ctx.user.id, action: "priceLevel.bulkUpdate",
        entityType: "priceLevel", entityId: level.id,
        metadata: { name: level.name, basis: input.basis, percent: input.percent, count }, ipAddress: ctx.ipAddress,
      });
      return { updated: count };
    }),

  /**
   * Price List report: every item (and variant) with its price on each level
   * as of a date, for one unit at the first slab.
   */
  priceList: viewerProcedure
    .input(z.object({ date: dateStr.optional(), category: z.string().max(100).optional() }).optional())
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Item");
      const day = dayOf(input?.date);
      const levels = await ctx.db.select({ id: priceLevels.id, name: priceLevels.name, isDefault: priceLevels.isDefault })
        .from(priceLevels).where(eq(priceLevels.businessId, ctx.businessId))
        .orderBy(asc(priceLevels.sortOrder), asc(priceLevels.name));
      const conds = [eq(items.businessId, ctx.businessId), isNull(items.deletedAt)];
      if (input?.category) conds.push(eq(items.category, input.category));
      const itemRows = await ctx.db.select({
        id: items.id, name: items.name, unit: items.unit, category: items.category, salePrice: items.salePrice, mrp: items.mrp, hsn: items.hsn,
      }).from(items).where(and(...conds)).orderBy(asc(items.name));
      const ids = itemRows.map((i) => i.id);
      const variants = ids.length
        ? await ctx.db.select({ id: itemVariants.id, itemId: itemVariants.itemId, attributeValues: itemVariants.attributeValues })
            .from(itemVariants).where(and(inArray(itemVariants.itemId, ids), isNull(itemVariants.deletedAt)))
        : [];
      const lines = itemRows.flatMap((it) => [
        { itemId: it.id, variantId: null as string | null, quantity: 1 },
        ...variants.filter((v) => v.itemId === it.id).map((v) => ({ itemId: it.id, variantId: v.id as string | null, quantity: 1 })),
      ]);
      const own = await resolvePrices(ctx.db, ctx.businessId, null, lines, day);
      const byLevel = await Promise.all(levels.map((l) => resolvePrices(ctx.db, ctx.businessId, l.id, lines, day)));
      const itemById = new Map(itemRows.map((i) => [i.id, i]));
      const variantById = new Map(variants.map((v) => [v.id, v]));
      const rows = lines.map((line, i) => {
        const it = itemById.get(line.itemId)!;
        const v = line.variantId ? variantById.get(line.variantId) : undefined;
        const prices: Record<string, string | null> = {};
        levels.forEach((l, li) => {
          const r = byLevel[li][i];
          prices[l.id] = r.source === "level" ? r.netPrice : null;
        });
        return {
          itemId: it.id,
          variantId: line.variantId,
          name: v ? `${it.name} (${Object.values(v.attributeValues ?? {}).join(" / ")})` : it.name,
          hsn: it.hsn,
          category: it.category,
          unit: it.unit,
          salePrice: own[i].unitPrice,
          mrp: own[i].mrp,
          prices,
        };
      });
      return { date: day, levels, rows };
    }),
});
