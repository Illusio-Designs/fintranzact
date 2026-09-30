/**
 * Stock groups (Tally "Stock Groups"): a per-business tree that items hang
 * off. They replace the free-text `items.category`, which is kept and set to
 * the group's name so older readers (CLI, mobile, the online store) still
 * see a category.
 */
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { stockGroups } from "@fintranzact/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type StockGroupRow = { id: string; name: string; parentId: string | null };

/** Ids of a group and every group under it, as a SQL subquery. */
export function groupSubtreeSql(groupId: string) {
  // UNION (not UNION ALL) so a cycle, should one ever slip in, still ends.
  return sql`(
    WITH RECURSIVE sub AS (
      SELECT id FROM stock_groups WHERE id = ${groupId}
      UNION
      SELECT g.id FROM stock_groups g JOIN sub ON g.parent_id = sub.id
    )
    SELECT id FROM sub
  )`;
}

/** Ids of a group and all its descendants, from an in-memory list. */
export function descendantIds(groups: StockGroupRow[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const g of groups) {
    if (!g.parentId) continue;
    const list = children.get(g.parentId) ?? [];
    list.push(g.id);
    children.set(g.parentId, list);
  }
  const out = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    for (const c of children.get(queue.shift()!) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        queue.push(c);
      }
    }
  }
  return out;
}

/** Groups in tree order (parents before children, siblings by name), with depth. */
export function orderTree<T extends StockGroupRow>(groups: T[]): Array<T & { depth: number }> {
  const byParent = new Map<string | null, T[]>();
  const ids = new Set(groups.map((g) => g.id));
  for (const g of groups) {
    // A parent outside the list is treated as the root.
    const key = g.parentId && ids.has(g.parentId) ? g.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(g);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  const out: Array<T & { depth: number }> = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const g of byParent.get(parent) ?? []) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      out.push({ ...g, depth });
      walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export async function getGroup(db: Db, businessId: string, id: string): Promise<StockGroupRow> {
  const [group] = await db
    .select({ id: stockGroups.id, name: stockGroups.name, parentId: stockGroups.parentId })
    .from(stockGroups)
    .where(and(eq(stockGroups.id, id), eq(stockGroups.businessId, businessId)))
    .limit(1);
  if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "Stock group not found" });
  return group;
}

/** Find a group by name, creating it at the top level when there is none. */
export async function findOrCreateGroup(db: Db, businessId: string, name: string): Promise<StockGroupRow> {
  await db.insert(stockGroups).values({ businessId, name }).onConflictDoNothing();
  const [group] = await db
    .select({ id: stockGroups.id, name: stockGroups.name, parentId: stockGroups.parentId })
    .from(stockGroups)
    .where(and(eq(stockGroups.businessId, businessId), eq(stockGroups.name, name)))
    .limit(1);
  return group;
}

/**
 * The stockGroupId/category pair to write on an item, from what the caller
 * sent. A group id wins and sets the category to its name. Callers that only
 * know about categories (CLI, mobile, imports) send a category name, which is
 * matched to a group of that name, or a new one. Blank or null clears both.
 * Returns {} when neither was sent.
 */
export async function resolveItemGroup(
  db: Db,
  businessId: string,
  input: { stockGroupId?: string | null; category?: string | null },
): Promise<{ stockGroupId?: string | null; category?: string | null }> {
  if (input.stockGroupId !== undefined) {
    if (!input.stockGroupId) return { stockGroupId: null, category: null };
    const group = await getGroup(db, businessId, input.stockGroupId);
    return { stockGroupId: group.id, category: group.name };
  }
  if (input.category !== undefined) {
    const name = input.category?.trim();
    if (!name) return { stockGroupId: null, category: null };
    const group = await findOrCreateGroup(db, businessId, name);
    return { stockGroupId: group.id, category: group.name };
  }
  return {};
}

/**
 * Give every item that has a category but no group a group of that name.
 * The same statements as the stock_groups migration's backfill, scoped to one
 * business; used after bulk imports that write `category` directly.
 */
export async function linkCategoriesToGroups(db: Db, businessId: string) {
  await db.execute(sql`
    INSERT INTO stock_groups (business_id, name)
    SELECT DISTINCT i.business_id, btrim(i.category)
    FROM items i
    WHERE i.business_id = ${businessId} AND i.stock_group_id IS NULL
      AND i.category IS NOT NULL AND btrim(i.category) <> '' AND i.deleted_at IS NULL
    ON CONFLICT (business_id, name) DO NOTHING
  `);
  await db.execute(sql`
    UPDATE items i SET stock_group_id = g.id, category = g.name
    FROM stock_groups g
    WHERE i.business_id = ${businessId} AND i.stock_group_id IS NULL
      AND g.business_id = i.business_id AND g.name = btrim(i.category)
  `);
}
