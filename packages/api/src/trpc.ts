import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context.js";
import { getTenantDb, type TenantDatabase, controlDb, businesses, businessMembers, tenantMembers } from "@fintranzact/db";
import { backfillLegacyBusinessMembers } from "./lib/business-membership.js";
import { eq, and } from "drizzle-orm";
import { defineAbilityFor, mapDbRole, type AppAbility } from "./lib/permissions.js";
import { getMaintenanceStatus } from "./lib/maintenance-cache.js";
import { isFirstPartyRequestedWith } from "./lib/client-headers.js";
import { entitlementDataOf, entitlementError } from "./lib/entitlement-error.js";
import { getEntitlements } from "./lib/entitlements.js";
import { gateDecision } from "./lib/entitlement-exempt.js";

// ── Middleware context shape interfaces ────────────────────────
// These represent the enriched context after each middleware runs.
// Using typed casts (as unknown as TenantCtx) instead of (as any) so
// TypeScript can catch shape mismatches at the cast sites.

interface TenantCtx extends Context {
  user: NonNullable<Context["user"]>;
  tenantId: string;
  db: TenantDatabase;
}

/** "customerName" / "items.0.qty" -> "Customer name" / "Qty" */
function fieldLabel(path: ReadonlyArray<string | number>): string {
  const last = [...path].reverse().find((part) => typeof part === "string") as string | undefined;
  if (!last) return "";
  const words = last.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Zod's stock wording ("Required", "Expected string, received number") means nothing to a user. */
const GENERIC_ZOD_MESSAGE = /^(invalid|required|expected|string must|number must|array must|too (small|big)|unrecognized)/i;

/**
 * A readable one-line message for a failed input check, never the raw list of
 * Zod issues. Messages we wrote ourselves ("Enter a valid email") pass through.
 */
function friendlyZodMessage(cause: unknown): string | null {
  const issues = (cause as { issues?: Array<{ path: Array<string | number>; message: string }> } | undefined)?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const issue = issues[0];
  const label = fieldLabel(issue.path);
  if (!GENERIC_ZOD_MESSAGE.test(issue.message)) return issue.message;
  return label ? `Please check "${label}" and try again.` : "Please check the details you entered and try again.";
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Never expose internal error details (DB errors, stack traces) to clients
    const isInternal = error.code === "INTERNAL_SERVER_ERROR";
    const zodMessage = error.code === "BAD_REQUEST" ? friendlyZodMessage(error.cause) : null;
    const entitlement = entitlementDataOf(error);
    return {
      ...shape,
      message: isInternal ? "Something went wrong. Please try again." : (zodMessage ?? shape.message),
      data: {
        ...shape.data,
        zodError: error.cause instanceof Error ? undefined : null,
        // Why a plan / trial / add-on / read-only check refused (see lib/entitlement-error.ts).
        ...(entitlement ? { entitlement } : {}),
      },
    };
  },
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

// ── CSRF check (tRPC layer) ───────────────────────────────────────────────────
// Mirrors the Hono-level CSRF middleware in `lib/csrf-middleware.ts`, but
// runs inside the tRPC request pipeline so rejections become proper
// `TRPCError`s — the tRPC HTTP link on the client can then deserialize
// the error envelope (superjson-shaped `{error: {json: {...}}}`) and
// surface a readable message instead of "Unable to transform response
// from server".
//
// WHY THIS IS NEEDED IN ADDITION TO THE HONO-LEVEL CHECK:
// The Hono middleware returns `c.json({error: "..."}, 403)`, whose shape
// the tRPC client cannot parse. Keeping that shape for non-tRPC routes
// (store REST, webhooks) is correct, but every tRPC call needs to go
// through a tRPC-aware path so the error formatter produces a
// client-parseable envelope for batched queries, mutations, and
// subscriptions alike.
//
// SAFETY MODEL (must match csrf-middleware.ts):
//   - GET/HEAD/OPTIONS: exempt (side-effect-free per HTTP convention).
//   - Bearer-authenticated (Authorization header): exempt — Bearer
//     tokens are not vulnerable to CSRF and React Native's native
//     cookie jar replays stale `session_id` cookies that must not
//     trip this check.
//   - No session cookie: exempt — nothing to protect.
//   - Otherwise: require `X-Requested-With: fintranzact`
//     or throw TRPCError({code: "FORBIDDEN"}).
const csrfCheck = t.middleware(({ ctx, next }) => {
  const req = ctx.req;
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return next();
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return next();
  }

  const cookieHeader = req.headers.get("cookie");
  const hasSessionCookie = cookieHeader?.includes("session_id=") ?? false;
  if (!hasSessionCookie) {
    return next();
  }

  const xrw = req.headers.get("x-requested-with");
  if (!isFirstPartyRequestedWith(xrw)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "CSRF validation failed",
    });
  }

  return next();
});

// Base procedure with CSRF enforcement — every procedure below inherits
// from this so the check runs on every tRPC call, including public
// endpoints like `auth.login` that are otherwise unauthenticated.
const baseProcedure = t.procedure.use(csrfCheck);

export const publicProcedure = baseProcedure;

// Middleware: requires authenticated user
const isAuthenticated = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "You must be logged in" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// Middleware: requires tenant + injects ctx.db
const hasTenantAccess = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (!ctx.tenantId) throw new TRPCError({ code: "BAD_REQUEST", message: "No organization selected" });

  const db = await getTenantDb(ctx.tenantId);

  // Check system maintenance mode — blocks ALL users during maintenance
  const maintenance = await getMaintenanceStatus();
  if (maintenance.enabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: maintenance.message || "System is under maintenance. Please try again later.",
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      tenantId: ctx.tenantId,
      db,
    },
  });
});

// Middleware: requires business selected and validates it exists in tenant DB
// AND that the business belongs to the caller's tenant (critical in self-hosted
// mode where all tenants share a single database).
const hasBusinessAccess = t.middleware(async ({ ctx, next }) => {
  if (!ctx.businessId) {
    if (process.env.NODE_ENV === "development") console.log("[hasBusinessAccess] FAIL: no businessId in ctx. Headers received x-business-id:", ctx.req.headers.get("x-business-id"));
    throw new TRPCError({ code: "BAD_REQUEST", message: "No business selected" });
  }

  // Verify business exists in this tenant's database (ctx.db injected by hasTenantAccess)
  const [biz] = await (ctx as unknown as TenantCtx).db.select({
    id: businesses.id,
    createdByUserId: businesses.createdByUserId,
  })
    .from(businesses)
    .where(eq(businesses.id, ctx.businessId))
    .limit(1);

  if (!biz) {
    if (process.env.NODE_ENV === "development") console.log("[hasBusinessAccess] FAIL: business not found in tenant DB. businessId:", ctx.businessId, "tenantId:", ctx.tenantId);
    throw new TRPCError({ code: "FORBIDDEN", message: "Business not found" });
  }

  // In self-hosted mode all businesses live in the same DB. Verify the business
  // creator is a member of the caller's tenant to prevent cross-tenant access;
  // business membership alone is not tied to a tenant.
  const [creatorMembership] = await controlDb
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(and(
      eq(tenantMembers.tenantId, ctx.tenantId as string),
      eq(tenantMembers.userId, biz.createdByUserId),
    ))
    .limit(1);

  if (!creatorMembership) {
    if (process.env.NODE_ENV === "development") console.log("[hasBusinessAccess] FAIL: creator not a tenant member. businessId:", ctx.businessId, "createdByUserId:", biz.createdByUserId, "tenantId:", ctx.tenantId);
    throw new TRPCError({ code: "FORBIDDEN", message: "Business not found" });
  }

  // Verify that the current user is assigned to this business.
  // business_members lives in the tenant DB, while users live in the
  // control DB, so userId is stored as a plain UUID.
  const findMembership = () => (ctx as unknown as TenantCtx).db
    .select({
      userId: businessMembers.userId,
      role: businessMembers.role,
    })
    .from(businessMembers)
    .where(and(
      eq(businessMembers.businessId, ctx.businessId as string),
      eq(businessMembers.userId, ctx.user?.id as string),
    ))
    .limit(1);

  let [businessMembership] = await findMembership();
  if (!businessMembership) {
    await backfillLegacyBusinessMembers((ctx as unknown as TenantCtx).db, ctx.tenantId as string);
    [businessMembership] = await findMembership();
  }

  if (!businessMembership) {
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[hasBusinessAccess] FAIL: user is not a member of business.",
        "businessId:", ctx.businessId,
        "userId:", ctx.user?.id,
      );
    }

    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this business",
    });
  }

  return next({
    ctx: {
      ...ctx,
      businessId: ctx.businessId as string,
    },
  });
});

// Middleware: plan / trial / read-only / suspended enforcement. Appended LAST
// to each tenant-scoped base (never inserted earlier: the sweep helpers match a
// procedure to its base by middleware prefix). Reads pass; writes are refused
// by default while the organisation is read-only unless allowlisted. All the
// logic is the pure gateDecision in lib/entitlement-exempt.ts. Organisations
// that never had a subscription (forever_free, legacy, fixtures) are never
// read-only, so this never refuses them.
const entitlementGate = t.middleware(async ({ ctx, type, path, next }) => {
  if (!ctx.tenantId) return next();
  const entitlements = await getEntitlements(ctx.tenantId);
  const decision = gateDecision({ type, path, entitlements });
  if (!decision.allow) throw entitlementError(decision.reason);
  return next();
});

export const protectedProcedure = baseProcedure.use(isAuthenticated);
export const tenantProcedure = baseProcedure.use(isAuthenticated).use(hasTenantAccess).use(entitlementGate);
export const businessProcedure = baseProcedure.use(isAuthenticated).use(hasTenantAccess).use(hasBusinessAccess).use(entitlementGate);

// ── CASL-based permission middleware ──────────────────────────────────────────
// Resolves permissions from the user's role inside the selected business.
// Tenant membership proves the user belongs to the tenant;
// business_members determines what they can do inside the selected business.
function withPermissions() {
  return t.middleware(async ({ ctx, next }) => {
    const user = ctx.user as NonNullable<Context["user"]>;
    const tenantId = ctx.tenantId as string;
    const businessId = ctx.businessId as string;

    // The business membership was already validated by hasBusinessAccess.
    // Resolve the user's business-level role here for CASL.
    const [businessMembership] = await (ctx as unknown as TenantCtx).db
      .select({
        role: businessMembers.role,
      })
      .from(businessMembers)
      .where(and(
        eq(businessMembers.businessId, businessId),
        eq(businessMembers.userId, user.id),
      ))
      .limit(1);

    if (!businessMembership) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "No business membership found",
      });
    }

    // Business membership decides whether the user can open the business; the
    // role they act with inside it comes from:
    //   business admin  -> admin (superadmin for tenant owners/superadmins)
    //   business member -> their tenant role (seller, accountant, ...), the
    //                      same role the web/mobile navigation is built from.
    // Keep the mapping centralized through mapDbRole so CASL remains
    // responsible for the actual permission definitions.
    const [tenantMembership] = await controlDb
      .select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, user.id)))
      .limit(1);
    const tenantRole = mapDbRole(tenantMembership?.role ?? "member");
    const permissionRole = businessMembership.role === "admin"
      ? (tenantRole === "superadmin" ? "superadmin" : "admin")
      : tenantRole;

    const ability = defineAbilityFor({
      userId: user.id,
      role: permissionRole,
    });

    return next({
      ctx: {
        ...ctx,
        user,
        tenantId,
        businessId,
        role: permissionRole,
        ability,
      },
    });
  });
}

// All procedures that need CASL: get ability + role in context.
// Permission checks happen per-endpoint via requireCan().
export const authorizedProcedure = baseProcedure
  .use(isAuthenticated)
  .use(hasTenantAccess)
  .use(hasBusinessAccess)
  .use(withPermissions())
  .use(entitlementGate);

// Keep old names as aliases for backward compatibility (avoids changing every router import)
export const viewerProcedure = authorizedProcedure;
export const memberProcedure = authorizedProcedure;
export const adminProcedure = authorizedProcedure;

// Re-export permission types so routers can import requireCan + types from trpc.js
export type { AppAbility };

// Re-export TenantDatabase type for use in lib functions
export type { TenantDatabase };
