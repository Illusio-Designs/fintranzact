/**
 * assertions.ts — small shared helpers for router integration tests.
 *
 *   expectCode(promise, "NOT_FOUND")  — the call fails with that tRPC code
 *   waitForAudit(businessId, action)  — logAudit() is not awaited by most
 *                                       routers, so poll briefly for the row
 *   callerFor(world, who)             — a caller for one of the world's users
 */
import { expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog } from "@fintranzact/db";
import { getTenantTestDb } from "./test-db.js";
import { createTestCaller } from "./create-test-caller.js";
import type { TestWorld } from "./fixtures.js";

export async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

export async function waitForAudit(
  businessId: string,
  action: string,
  entityId?: string,
): Promise<Array<typeof auditLog.$inferSelect>> {
  const db = getTenantTestDb();
  for (let i = 0; i < 40; i++) {
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(
        eq(auditLog.businessId, businessId),
        eq(auditLog.action, action),
        ...(entityId ? [eq(auditLog.entityId, entityId)] : []),
      ));
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 25));
  }
  return [];
}

export function callerFor(
  world: TestWorld,
  who: "ramesh" | "suresh" | "kiran" = "ramesh",
): ReturnType<typeof createTestCaller> {
  const user = world[who];
  const tenant = who === "kiran" ? world.tenant2 : world.tenant1;
  const business = who === "kiran" ? world.business2 : world.business1;
  return createTestCaller({
    userId: user.id,
    email: user.email,
    name: user.name ?? null,
    tenantId: tenant.id,
    businessId: business.id,
  });
}
