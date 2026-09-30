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

/**
 * Ids of the businesses that belong to organisation `tenantId`.
 *
 * In cloud mode the tenant DB holds only this organisation's data. In
 * self-hosted mode every organisation shares one database, so a business
 * belongs to the organisation its creator is a member of — the same rule
 * hasBusinessAccess and verifyBusinessAccess apply.
 */
export async function tenantBusinessIds(db: TenantDatabase, tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ id: businesses.id, createdByUserId: businesses.createdByUserId })
    .from(businesses);
  if (process.env.MULTI_TENANT === "true") return rows.map((r) => r.id);
  const team = await controlDb
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(eq(tenantMembers.tenantId, tenantId));
  const members = new Set(team.map((m) => m.userId));
  return rows.filter((r) => members.has(r.createdByUserId)).map((r) => r.id);
}

/**
 * True when `userId` is a member of `businessId`. On a miss the legacy
 * backfill runs once and the lookup is retried, exactly as the
 * hasBusinessAccess tRPC middleware does, so a business created before
 * per-business membership still opens for its team.
 *
 * Shared by the non-tRPC endpoints (PDFs, labels) and the tenant-level
 * procedures that take a business id in their input.
 */
export async function isBusinessMember(
  db: TenantDatabase,
  tenantId: string,
  businessId: string,
  userId: string,
): Promise<boolean> {
  const find = () => db
    .select({ userId: businessMembers.userId })
    .from(businessMembers)
    .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.userId, userId)))
    .limit(1);

  let [membership] = await find();
  if (!membership) {
    await backfillLegacyBusinessMembers(db, tenantId);
    [membership] = await find();
  }
  return !!membership;
}

/**
 * Shared business access check for non-tRPC endpoints (invoice/ledger PDFs,
 * label sheets, business images). Mirrors the hasBusinessAccess middleware in
 * trpc.ts: the business exists in the tenant DB, (for self-hosted shared-DB
 * mode) its creator is a member of the caller's tenant, AND the caller is a
 * member of the business itself.
 */
export async function verifyBusinessAccess(
  db: TenantDatabase,
  businessId: string,
  tenantId: string,
  userId: string,
): Promise<{ ok: true; business: { id: string; createdByUserId: string } } | { ok: false; error: string }> {
  const [biz] = await db.select({ id: businesses.id, createdByUserId: businesses.createdByUserId })
    .from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz) return { ok: false, error: "Business not found" };

  // Self-hosted cross-tenant guard: verify the creator is a member of this tenant
  const [creatorMembership] = await controlDb
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, biz.createdByUserId)))
    .limit(1);
  if (!creatorMembership) return { ok: false, error: "Business not found" };

  // Tenant membership alone is not enough: the caller must be assigned to
  // this business, as hasBusinessAccess requires for tRPC.
  if (!(await isBusinessMember(db, tenantId, businessId, userId))) {
    return { ok: false, error: "You do not have access to this business" };
  }

  return { ok: true, business: biz };
}
