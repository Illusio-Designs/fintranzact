/**
 * Upcoming features board: the one-time seed of the starting roadmap.
 *
 * The seed runs the first time the board is opened. It inserts ROADMAP_SEED
 * only when the table is empty, and records in system_config that it ran, so
 * a board the admins later empty on purpose stays empty.
 */

import { count, eq, sql } from "drizzle-orm";
import { controlDb, roadmapItems, systemConfig } from "@fintranzact/db";
import { ROADMAP_SEED } from "./roadmap-seed.js";

export const ROADMAP_SEEDED_KEY = "roadmap_seeded";

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
    const [marker] = await tx.select({ key: systemConfig.key }).from(systemConfig).where(eq(systemConfig.key, ROADMAP_SEEDED_KEY));
    if (marker) return 0;
    const [existing] = await tx.select({ n: count() }).from(roadmapItems);
    let inserted = 0;
    if ((existing?.n ?? 0) === 0) {
      const rows = await tx
        .insert(roadmapItems)
        .values(
          ROADMAP_SEED.map((item, i) => ({
            title: item.title,
            description: item.description,
            category: item.category,
            status: item.status,
            priority: item.priority,
            launchStage: item.launchStage,
            phase: item.phase,
            sortOrder: i,
            billing: item.billing,
            priceNote: item.priceNote,
            checklist: item.checklist.map((text) => ({ text, done: false })),
          })),
        )
        .returning({ id: roadmapItems.id });
      inserted = rows.length;
    }
    await tx
      .insert(systemConfig)
      .values({ key: ROADMAP_SEEDED_KEY, value: { at: new Date().toISOString(), items: inserted } })
      .onConflictDoNothing();
    return inserted;
  });
  seeded = true;
  return added;
}
