import { and, eq, inArray, notExists } from "drizzle-orm";
import { controlDb, businesses, businessMembers, tenantMembers, type TenantDatabase } from "@fintranzact/db";

const ADMIN_TENANT_ROLES = new Set(["owner", "admin", "superadmin"]);

/**
 * Businesses created before per-business membership existed have no
 * business_members rows, so nobody could list or open them. For those
 * businesses only, apply the previous rule — a business belongs to a tenant
 * when its creator is a member of that tenant — and give every member of the
 * tenant a membership, so the whole team keeps the access it had. Tenant
 * owners/admins become business admins; everyone else becomes a member.
 *
 * Businesses that already have any member are left alone, so access set up
 * per business is never widened. Cheap no-op once a tenant is migrated.
 */
export async function backfillLegacyBusinessMembers(db: TenantDatabase, tenantId: string): Promise<void> {
  const team = await controlDb
    .select({ userId: tenantMembers.userId, role: tenantMembers.role })
    .from(tenantMembers)
    .where(eq(tenantMembers.tenantId, tenantId));
  if (team.length === 0) return;

  const legacyBusinesses = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(
      inArray(businesses.createdByUserId, team.map((m) => m.userId)),
      notExists(
        db.select({ id: businessMembers.id })
          .from(businessMembers)
          .where(eq(businessMembers.businessId, businesses.id)),
      ),
    ));
  if (legacyBusinesses.length === 0) return;

  await db
    .insert(businessMembers)
    .values(legacyBusinesses.flatMap((biz) => team.map((m) => ({
      businessId: biz.id,
      userId: m.userId,
      role: ADMIN_TENANT_ROLES.has(m.role) ? ("admin" as const) : ("member" as const),
    }))))
    .onConflictDoNothing();
}
