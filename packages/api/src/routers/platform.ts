import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { controlDb, getTenantDb, tenants, tenantMembers, users, businesses } from "@fintranzact/db";
import { router, protectedProcedure } from "../trpc.js";
import { escapeLike } from "../lib/escape-like.js";
import { isPlatformAdmin } from "../lib/platform-admin.js";

/**
 * Platform admin: a read-only view of every organisation on this server.
 * Who is an admin is set by environment variables (see lib/platform-admin.ts).
 * Nothing here shows or changes a business's books (invoices, payments…).
 */
const platformAdminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!(await isPlatformAdmin(ctx.user.id))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Platform admin access only" });
  }
  return next();
});

const OWNER_ROLES = ["owner", "superadmin"] as const;

export const platformRouter = router({
  /** Whether the signed-in user is a platform admin (shows or hides the admin link). */
  me: protectedProcedure.query(async ({ ctx }) => ({
    isPlatformAdmin: await isPlatformAdmin(ctx.user.id),
  })),

  /** Headline numbers across the whole platform. */
  overview: platformAdminProcedure.query(async () => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [[tenantTotal], [userTotal], [newTenants], byPlan, byStatus] = await Promise.all([
      controlDb.select({ n: count() }).from(tenants),
      controlDb.select({ n: count() }).from(users),
      controlDb.select({ n: count() }).from(tenants).where(gte(tenants.createdAt, since)),
      controlDb.select({ plan: tenants.plan, n: count() }).from(tenants).groupBy(tenants.plan),
      controlDb.select({ status: tenants.status, n: count() }).from(tenants).groupBy(tenants.status),
    ]);
    return {
      tenants: tenantTotal?.n ?? 0,
      users: userTotal?.n ?? 0,
      tenantsLast30Days: newTenants?.n ?? 0,
      byPlan: byPlan.map((r) => ({ plan: r.plan, count: r.n })),
      byStatus: byStatus.map((r) => ({ status: r.status, count: r.n })),
    };
  }),

  /** Every organisation with its owner and member count, newest first. */
  tenants: platformAdminProcedure
    .input(z.object({
      search: z.string().trim().max(100).optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(25),
    }).default({}))
    .query(async ({ input }) => {
      const term = input.search ? `%${escapeLike(input.search)}%` : null;
      // Match the organisation's name/slug or any member's name/email.
      const where = term
        ? or(
            ilike(tenants.name, term),
            ilike(tenants.slug, term),
            // Written out in full: inside a subquery Drizzle renders
            // ${tenants.id} as a bare "id", which would bind to the member row.
            sql`EXISTS (SELECT 1 FROM tenant_members tm JOIN users u ON u.id = tm.user_id
                        WHERE tm.tenant_id = "tenants"."id" AND (u.email ILIKE ${term} OR u.name ILIKE ${term}))`,
          )
        : undefined;

      const [rows, [total]] = await Promise.all([
        controlDb
          .select({
            id: tenants.id,
            name: tenants.name,
            slug: tenants.slug,
            plan: tenants.plan,
            status: tenants.status,
            createdAt: tenants.createdAt,
            memberCount: sql<number>`(SELECT COUNT(*)::int FROM tenant_members tm WHERE tm.tenant_id = "tenants"."id")`,
          })
          .from(tenants)
          .where(where)
          .orderBy(desc(tenants.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit),
        controlDb.select({ n: count() }).from(tenants).where(where),
      ]);

      const ids = rows.map((r) => r.id);
      const owners = ids.length
        ? await controlDb
            .select({ tenantId: tenantMembers.tenantId, name: users.name, email: users.email })
            .from(tenantMembers)
            .innerJoin(users, eq(users.id, tenantMembers.userId))
            .where(and(inArray(tenantMembers.tenantId, ids), inArray(tenantMembers.role, [...OWNER_ROLES])))
            .orderBy(tenantMembers.createdAt)
        : [];
      const ownerOf = new Map<string, { name: string | null; email: string }>();
      for (const o of owners) if (!ownerOf.has(o.tenantId)) ownerOf.set(o.tenantId, { name: o.name, email: o.email });

      return {
        data: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), owner: ownerOf.get(r.id) ?? null })),
        total: total?.n ?? 0,
        page: input.page,
        limit: input.limit,
      };
    }),

  /** One organisation: its members and its businesses. */
  tenant: platformAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [tenant] = await controlDb
        .select({
          id: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
          plan: tenants.plan,
          status: tenants.status,
          createdAt: tenants.createdAt,
        })
        .from(tenants)
        .where(eq(tenants.id, input.id))
        .limit(1);
      if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Organisation not found" });

      const members = await controlDb
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          emailVerified: users.emailVerified,
          role: tenantMembers.role,
          joinedAt: tenantMembers.createdAt,
        })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(eq(tenantMembers.tenantId, input.id))
        .orderBy(tenantMembers.createdAt);

      // Businesses live in the tenant's database (the shared one when
      // self-hosted); scoping by creator keeps other tenants' rows out.
      const memberIds = members.map((m) => m.userId);
      const businessRows = memberIds.length
        ? await (await getTenantDb(input.id))
            .select({
              id: businesses.id,
              name: businesses.name,
              gstin: businesses.gstin,
              city: businesses.city,
              createdAt: businesses.createdAt,
            })
            .from(businesses)
            .where(inArray(businesses.createdByUserId, memberIds))
            .orderBy(businesses.createdAt)
        : [];

      return {
        ...tenant,
        createdAt: tenant.createdAt.toISOString(),
        members: members.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() })),
        businesses: businessRows.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() })),
      };
    }),
});
