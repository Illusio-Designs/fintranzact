/**
 * Upcoming features board: the one-time seed of the starting roadmap.
 *
 * The seed runs the first time the board is opened. It inserts ROADMAP_SEED
 * only when the table is empty, and records in system_config that it ran, so
 * a board the admins later empty on purpose stays empty.
 *
 * Batches added to the roadmap later (ROADMAP_ADDITIONS) reach a board that
 * was seeded before they existed: each is inserted once, skipping titles the
 * board already has, and marked done so deleting its items later sticks.
 */

import { count, inArray, max, sql } from "drizzle-orm";
import { controlDb, roadmapItems, systemConfig } from "@fintranzact/db";
import { ROADMAP_ADDITIONS, ROADMAP_SEED, type RoadmapSeedItem } from "./roadmap-seed.js";

export const ROADMAP_SEEDED_KEY = "roadmap_seeded";
export const roadmapAdditionKey = (key: string) => `roadmap_added:${key}`;

const toRow = (item: RoadmapSeedItem, sortOrder: number) => ({
  title: item.title,
  description: item.description,
  category: item.category,
  status: item.status,
  priority: item.priority,
  launchStage: item.launchStage,
  phase: item.phase,
  sortOrder,
  billing: item.billing,
  priceNote: item.priceNote,
  checklist: item.checklist.map((text) => ({ text, done: false })),
});

let seeded = false;

/** Test hook: forget that this process already checked the seed. */
export function resetRoadmapSeedCache(): void {
  seeded = false;
}

/** Inserts the starting roadmap once per server. Returns how many items it added. */
export async function ensureRoadmapSeeded(): Promise<number> {
  if (seeded) return 0;
  const added = await controlDb.transaction(async (tx) => {
    // Two admins opening the board at once must not seed it twice.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('roadmap_seed'))`);
    const markerKeys = [ROADMAP_SEEDED_KEY, ...ROADMAP_ADDITIONS.map((batch) => roadmapAdditionKey(batch.key))];
    const done = new Set(
      (await tx.select({ key: systemConfig.key }).from(systemConfig).where(inArray(systemConfig.key, markerKeys))).map((r) => r.key),
    );
    const at = new Date().toISOString();
    let inserted = 0;

    if (!done.has(ROADMAP_SEEDED_KEY)) {
      const [existing] = await tx.select({ n: count() }).from(roadmapItems);
      if ((existing?.n ?? 0) === 0) {
        const rows = await tx
          .insert(roadmapItems)
          .values(ROADMAP_SEED.map((item, i) => toRow(item, i)))
          .returning({ id: roadmapItems.id });
        inserted = rows.length;
      }
      // The full seed already holds every batch; a board that had items
      // when first opened is the admins' own and gets no batches either.
      await tx
        .insert(systemConfig)
        .values(markerKeys.map((key) => ({ key, value: { at, items: key === ROADMAP_SEEDED_KEY ? inserted : 0 } })))
        .onConflictDoNothing();
      return inserted;
    }

    for (const batch of ROADMAP_ADDITIONS) {
      const key = roadmapAdditionKey(batch.key);
      if (done.has(key)) continue;
      const have = new Set(
        (await tx.select({ title: roadmapItems.title }).from(roadmapItems).where(inArray(roadmapItems.title, batch.items.map((i) => i.title)))).map(
          (r) => r.title,
        ),
      );
      const fresh = batch.items.filter((item) => !have.has(item.title));
      if (fresh.length > 0) {
        const [last] = await tx.select({ n: max(roadmapItems.sortOrder) }).from(roadmapItems);
        const start = (last?.n ?? -1) + 1;
        await tx.insert(roadmapItems).values(fresh.map((item, i) => toRow(item, start + i)));
        inserted += fresh.length;
      }
      await tx.insert(systemConfig).values({ key, value: { at, items: fresh.length } }).onConflictDoNothing();
    }
    return inserted;
  });
  seeded = true;
  return added;
}
