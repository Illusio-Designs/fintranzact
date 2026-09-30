/**
 * Stock groups: the tree items are filed under (see lib/stock-groups).
 */
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { items, stockGroups } from "@fintranzact/db";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";
import { descendantIds, getGroup, orderTree } from "../lib/stock-groups.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const groupName = z.string().trim().min(1).max(100);

/** Refuse a name another group of this business already has (ignoring case). */
async function assertNameFree(db: Db, businessId: string, name: string, exceptId?: string) {
  const [clash] = await db
    .select({ id: stockGroups.id })
    .from(stockGroups)
    .where(and(
      eq(stockGroups.businessId, businessId),
      sql`lower(${stockGroups.name}) = lower(${name})`,
      ...(exceptId ? [ne(stockGroups.id, exceptId)] : []),
    ))
    .limit(1);
  if (clash) throw new TRPCError({ code: "CONFLICT", message: `A stock group named "${name}" already exists` });
}

async function allGroups(db: Db, businessId: string) {
  return db
    .select({ id: stockGroups.id, name: stockGroups.name, parentId: stockGroups.parentId })
    .from(stockGroups)
    .where(eq(stockGroups.businessId, businessId)) as Promise<Array<{ id: string; name: string; parentId: string | null }>>;
}

export const stockGroupRouter = router({
  /**
   * Every group in tree order, with its depth and item counts. `itemCount`
   * includes items in groups below it; `directItemCount` does not.
   */
  list: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "Item");
    const [groups, counts, [ungrouped]] = await Promise.all([
      allGroups(ctx.db, ctx.businessId),
      ctx.db
        .select({ groupId: items.stockGroupId, count: sql<number>`count(*)::int` })
        .from(items)
        .where(and(eq(items.businessId, ctx.businessId), isNull(items.deletedAt)))
        .groupBy(items.stockGroupId),
      ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(items)
        .where(and(eq(items.businessId, ctx.businessId), isNull(items.deletedAt), isNull(items.stockGroupId))),
    ]);
    const direct = new Map(counts.filter((c) => c.groupId).map((c) => [c.groupId as string, c.count]));
    const childCount = new Map<string, number>();
    for (const g of groups) {
      if (g.parentId) childCount.set(g.parentId, (childCount.get(g.parentId) ?? 0) + 1);
    }

    const data = orderTree(groups).map((g) => {
      let itemCount = 0;
      for (const id of descendantIds(groups, g.id)) itemCount += direct.get(id) ?? 0;
      return {
        ...g,
        directItemCount: direct.get(g.id) ?? 0,
        itemCount,
        childCount: childCount.get(g.id) ?? 0,
      };
    });
    return { data, ungroupedItemCount: ungrouped?.count ?? 0 };
  }),

  create: memberProcedure
    .input(z.object({ name: groupName, parentId: z.string().uuid().nullish() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "create", "Item");
      if (input.parentId) await getGroup(ctx.db, ctx.businessId, input.parentId);
      await assertNameFree(ctx.db, ctx.businessId, input.name);
      const [group] = await ctx.db
        .insert(stockGroups)
        .values({ businessId: ctx.businessId, name: input.name, parentId: input.parentId ?? null })
        .returning();
      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "stockGroup.create",
        entityType: "stock_group",
        entityId: group.id,
        metadata: { name: group.name },
        ipAddress: ctx.ipAddress,
      });
      return group;
    }),

  /** Rename a group. Its items' category follows. */
  rename: memberProcedure
    .input(z.object({ id: z.string().uuid(), name: groupName }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");
      const before = await getGroup(ctx.db, ctx.businessId, input.id);
      await assertNameFree(ctx.db, ctx.businessId, input.name, input.id);
      const group = await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(stockGroups)
          .set({ name: input.name, updatedAt: new Date() })
          .where(and(eq(stockGroups.id, input.id), eq(stockGroups.businessId, ctx.businessId)))
          .returning();
        await tx
          .update(items)
          .set({ category: input.name, updatedAt: new Date() })
          .where(and(eq(items.stockGroupId, input.id), eq(items.businessId, ctx.businessId)));
        return updated;
      });
      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "stockGroup.rename",
        entityType: "stock_group",
        entityId: group.id,
        metadata: { from: before.name, to: group.name },
        ipAddress: ctx.ipAddress,
      });
      return group;
    }),

  /** Put a group under another one (or at the top with null). */
  move: memberProcedure
    .input(z.object({ id: z.string().uuid(), parentId: z.string().uuid().nullable() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Item");
      await getGroup(ctx.db, ctx.businessId, input.id);
      if (input.parentId) {
        await getGroup(ctx.db, ctx.businessId, input.parentId);
        // A group can't sit under itself or anything below it.
        const below = descendantIds(await allGroups(ctx.db, ctx.businessId), input.id);
        if (below.has(input.parentId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A stock group can't be moved under itself or one of its sub-groups" });
        }
      }
      const [group] = await ctx.db
        .update(stockGroups)
        .set({ parentId: input.parentId, updatedAt: new Date() })
        .where(and(eq(stockGroups.id, input.id), eq(stockGroups.businessId, ctx.businessId)))
        .returning();
      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "stockGroup.move",
        entityType: "stock_group",
        entityId: group.id,
        metadata: { name: group.name, parentId: input.parentId },
        ipAddress: ctx.ipAddress,
      });
      return group;
    }),

  /**
   * Delete a group. Without `reassignItemsTo` it must be empty: no items and
   * no sub-groups. With it, its items move to that group (or become
   * ungrouped when null) and its sub-groups move up to its parent.
   */
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid(), reassignItemsTo: z.string().uuid().nullish() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Item");
      const group = await getGroup(ctx.db, ctx.businessId, input.id);
      const reassign = input.reassignItemsTo !== undefined;
      if (input.reassignItemsTo === input.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a different group to move the items to" });
      }
      const target = input.reassignItemsTo ? await getGroup(ctx.db, ctx.businessId, input.reassignItemsTo) : null;

      await ctx.db.transaction(async (tx) => {
        const [usage] = (await tx.execute(sql`
          SELECT
            (SELECT count(*)::int FROM items WHERE stock_group_id = ${input.id} AND deleted_at IS NULL) AS "itemCount",
            (SELECT count(*)::int FROM stock_groups WHERE parent_id = ${input.id}) AS "childCount"
        `)) as Array<{ itemCount: number; childCount: number }>;
        if (!reassign && (usage.itemCount > 0 || usage.childCount > 0)) {
          const parts = [
            usage.itemCount > 0 ? `${usage.itemCount} item${usage.itemCount === 1 ? "" : "s"}` : null,
            usage.childCount > 0 ? `${usage.childCount} sub-group${usage.childCount === 1 ? "" : "s"}` : null,
          ].filter(Boolean);
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `"${group.name}" still has ${parts.join(" and ")}. Move them first or choose a group to move them to.`,
          });
        }

        // Deleted items too, so none keeps pointing at (or naming) the old group.
        await tx
          .update(items)
          .set({ stockGroupId: target?.id ?? null, category: target?.name ?? null, updatedAt: new Date() })
          .where(and(eq(items.stockGroupId, input.id), eq(items.businessId, ctx.businessId)));
        await tx
          .update(stockGroups)
          .set({ parentId: group.parentId, updatedAt: new Date() })
          .where(and(eq(stockGroups.parentId, input.id), eq(stockGroups.businessId, ctx.businessId)));
        await tx.delete(stockGroups).where(and(eq(stockGroups.id, input.id), eq(stockGroups.businessId, ctx.businessId)));
      });

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "stockGroup.delete",
        entityType: "stock_group",
        entityId: input.id,
        metadata: { name: group.name, reassignItemsTo: target?.name ?? null },
        ipAddress: ctx.ipAddress,
      });
      return { success: true };
    }),
});
