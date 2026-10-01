import { and, eq, asc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import {
    premises,
    warehouses,
    warehouseLocations,
    inventorySettings,
    warehousePermissions,
    businessMembers,
    controlDb,
    tenantMembers,
    users,
} from "@fintranzact/db";

import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { mapDbRole, requireCan } from "../lib/permissions.js";
import { withAudit } from "../lib/audit.js";

/** Roles that manage every warehouse without per-warehouse grants (as stock.ts). */
const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * Whether a warehouse is a default for some operation, whether it has ever
 * held stock, and what it holds now. A default can't be deactivated or
 * deleted (documents would have nowhere to post), and a warehouse with stock
 * history can't be deleted (its history and balances would go with it).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function warehouseUsage(db: any, businessId: string, warehouseId: string) {
    const [row] = (await db.execute(sql`
        SELECT
          EXISTS (
            SELECT 1 FROM inventory_settings
            WHERE business_id = ${businessId}
              AND ${warehouseId} IN (sales_warehouse_id, purchase_warehouse_id, sales_return_warehouse_id,
                                    purchase_return_warehouse_id, production_warehouse_id, stock_adjustment_warehouse_id)
          ) AS "isDefault",
          EXISTS (SELECT 1 FROM stock_movements WHERE warehouse_id = ${warehouseId}) AS "hasHistory",
          COALESCE((SELECT SUM(ABS(quantity::numeric)) FROM stock_balances WHERE warehouse_id = ${warehouseId}), 0)::text AS "stock"
    `)) as Array<{ isDefault: boolean; hasHistory: boolean; stock: string }>;
    return { isDefault: !!row?.isDefault, hasHistory: !!row?.hasHistory, holdsStock: parseFloat(row?.stock ?? "0") > 0.0005 };
}

export const warehouseRouter = router({
    // ============================================================
    // PREMISES
    // ============================================================

    premiseList: viewerProcedure.query(async ({ ctx }) => {
        requireCan(ctx.ability, "read", "Item");
        if (!ctx.businessId) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Business context is required",
            });
        }

        const businessId = ctx.businessId;

        return ctx.db
            .select()
            .from(premises)
            .where(eq(premises.businessId, businessId))
            .orderBy(asc(premises.name));
    }),

    premiseGet: viewerProcedure
        .input(
            z.object({
                id: z.string().uuid(),
            }),
        )
        .query(async ({ input, ctx }) => {
        requireCan(ctx.ability, "read", "Item");
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

            const [premise] = await ctx.db
                .select()
                .from(premises)
                .where(
                    and(
                        eq(premises.id, input.id),
                        eq(premises.businessId, businessId),
                    ),
                )
                .limit(1);

            if (!premise) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Premise not found",
                });
            }

            return premise;
        }),

    premiseCreate: memberProcedure
        .input(
            z.object({
                name: z.string().min(1).max(255),
                code: z.string().min(1).max(100),
                address: z.string().max(1000).optional().nullable(),
                state: z.string().max(100).optional().nullable(),
                city: z.string().max(100).optional().nullable(),
                status: z.string().max(50).default("active"),
            }),
        )
        .mutation(withAudit(async ({ input, ctx }) => {
        requireCan(ctx.ability, "manage", "Business");
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

            const [existing] = await ctx.db
                .select({ id: premises.id })
                .from(premises)
                .where(
                    and(
                        eq(premises.businessId, businessId),
                        eq(premises.code, input.code),
                    ),
                )
                .limit(1);

            if (existing) {
                throw new TRPCError({
                    code: "CONFLICT",
                    message: "A premise with this code already exists",
                });
            }

            const [premise] = await ctx.db
                .insert(premises)
                .values({
                    businessId,
                    name: input.name,
                    code: input.code,
                    address: input.address ?? null,
                    state: input.state ?? null,
                    city: input.city ?? null,
                    status: input.status,
                })
                .returning();

            return premise;
        }, (r) => ({ action: "warehouse.premiseCreate", entityType: "premise", entityId: r.id, metadata: { name: r.name, code: r.code } }))),

    premiseUpdate: memberProcedure
        .input(
            z.object({
                id: z.string().uuid(),
                name: z.string().min(1).max(255).optional(),
                code: z.string().min(1).max(100).optional(),
                address: z.string().max(1000).optional().nullable(),
                state: z.string().max(100).optional().nullable(),
                city: z.string().max(100).optional().nullable(),
                status: z.string().max(50).optional(),
            }),
        )
        .mutation(withAudit(async ({ input, ctx }) => {
        requireCan(ctx.ability, "manage", "Business");
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

            const [existing] = await ctx.db
                .select({ id: premises.id })
                .from(premises)
                .where(
                    and(
                        eq(premises.id, input.id),
                        eq(premises.businessId, businessId),
                    ),
                )
                .limit(1);

            if (!existing) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Premise not found",
                });
            }

            if (input.code) {
                const [duplicate] = await ctx.db
                    .select({ id: premises.id })
                    .from(premises)
                    .where(
                        and(
                            eq(premises.businessId, businessId),
                            eq(premises.code, input.code),
                        ),
                    )
                    .limit(1);

                if (duplicate && duplicate.id !== input.id) {
                    throw new TRPCError({
                        code: "CONFLICT",
                        message: "A premise with this code already exists",
                    });
                }
            }

            const { id: _id, ...data } = input;

            const [updated] = await ctx.db
                .update(premises)
                .set({
                    ...data,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(premises.id, input.id),
                        eq(premises.businessId, businessId),
                    ),
                )
                .returning();

            return updated;
        }, (r, input) => ({ action: "warehouse.premiseUpdate", entityType: "premise", entityId: input.id, metadata: { ...input } }))),

    premiseDelete: memberProcedure
        .input(
            z.object({
                id: z.string().uuid(),
            }),
        )
        .mutation(withAudit(async ({ input, ctx }) => {
        requireCan(ctx.ability, "manage", "Business");
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

            // Warehouses reference their premise (ON DELETE RESTRICT): say so
            // instead of failing in the database.
            const [inUse] = await ctx.db
                .select({ id: warehouses.id })
                .from(warehouses)
                .where(and(eq(warehouses.premiseId, input.id), eq(warehouses.businessId, businessId)))
                .limit(1);
            if (inUse) {
                throw new TRPCError({
                    code: "PRECONDITION_FAILED",
                    message: "This premise still has warehouses. Move or delete them first.",
                });
            }

            const [deleted] = await ctx.db
                .delete(premises)
                .where(
                    and(
                        eq(premises.id, input.id),
                        eq(premises.businessId, businessId),
                    ),
                )
                .returning({ id: premises.id });

            if (!deleted) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Premise not found",
                });
            }

            return {
                success: true,
                id: deleted.id,
            };
        }, (_r, input) => ({ action: "warehouse.premiseDelete", entityType: "premise", entityId: input.id }))),

    // ============================================================
    // WAREHOUSES
    // ============================================================

    warehouseList: viewerProcedure
        .input(
            z
                .object({
                    premiseId: z.string().uuid().optional(),
                })
                .optional(),
        )
        .query(async ({ input, ctx }) => {
        requireCan(ctx.ability, "read", "Item");
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

            const conditions = [
                eq(warehouses.businessId, businessId),
            ];

            if (input?.premiseId) {
                conditions.push(
                    eq(warehouses.premiseId, input.premiseId),
                );
            }

            return ctx.db
                .select()
                .from(warehouses)
                .where(and(...conditions))
                .orderBy(asc(warehouses.name));
        }),

    warehouseGet: viewerProcedure
        .input(
            z.object({
                id: z.string().uuid(),
            }),
        )
        .query(async ({ input, ctx }) => {
        requireCan(ctx.ability, "read", "Item");
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

            const [warehouse] = await ctx.db
                .select()
                .from(warehouses)
                .where(
                    and(
                        eq(warehouses.id, input.id),
                        eq(warehouses.businessId, businessId),
                    ),
                )
                .limit(1);

            if (!warehouse) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Warehouse not found",
                });
            }

            return warehouse;
        }),

    warehouseCreate: memberProcedure
        .input(
            z.object({
                premiseId: z.string().uuid(),
                name: z.string().min(1).max(255),
                code: z.string().min(1).max(100),
                warehouseType: z.string().min(1).max(50),
                address: z.string().max(1000).optional().nullable(),
                status: z.string().max(50).default("active"),
            }),
        )
        .mutation(withAudit(async ({ input, ctx }) => {
        requireCan(ctx.ability, "manage", "Business");
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

            const [premise] = await ctx.db
                .select({ id: premises.id })
                .from(premises)
                .where(
                    and(
                        eq(premises.id, input.premiseId),
                        eq(premises.businessId, businessId),
                    ),
                )
                .limit(1);

            if (!premise) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Premise does not belong to this business",
                });
            }

            const [existing] = await ctx.db
                .select({ id: warehouses.id })
                .from(warehouses)
                .where(
                    and(
                        eq(warehouses.businessId, businessId),
                        eq(warehouses.code, input.code),
                    ),
                )
                .limit(1);

            if (existing) {
                throw new TRPCError({
                    code: "CONFLICT",
                    message: "A warehouse with this code already exists",
                });
            }

            const [warehouse] = await ctx.db
                .insert(warehouses)
                .values({
                    businessId,
                    premiseId: input.premiseId,
                    name: input.name,
                    code: input.code,
                    warehouseType: input.warehouseType,
                    address: input.address ?? null,
                    status: input.status,
                })
                .returning();

            return warehouse;
        }, (r) => ({ action: "warehouse.warehouseCreate", entityType: "warehouse", entityId: r.id, metadata: { name: r.name, code: r.code } }))),

    warehouseUpdate: memberProcedure
        .input(
            z.object({
                id: z.string().uuid(),
                premiseId: z.string().uuid().optional(),
                name: z.string().min(1).max(255).optional(),
                code: z.string().min(1).max(100).optional(),
                warehouseType: z.string().min(1).max(50).optional(),
                address: z.string().max(1000).optional().nullable(),
                status: z.string().max(50).optional(),
            }),
        )
        .mutation(withAudit(async ({ input, ctx }) => {
        requireCan(ctx.ability, "manage", "Business");
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

            if (input.status && input.status !== "active") {
                const usage = await warehouseUsage(ctx.db, businessId, input.id);
                if (usage.isDefault) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message: "This is a default warehouse. Choose another default before making it inactive.",
                    });
                }
                if (usage.holdsStock) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message: "This warehouse still holds stock. Transfer it out before making it inactive.",
                    });
                }
            }

            const [existing] = await ctx.db
                .select()
                .from(warehouses)
                .where(
                    and(
                        eq(warehouses.id, input.id),
                        eq(warehouses.businessId, businessId),
                    ),
                )
                .limit(1);

            if (!existing) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Warehouse not found",
                });
            }

            if (input.premiseId) {
                const [premise] = await ctx.db
                    .select({ id: premises.id })
                    .from(premises)
                    .where(
                        and(
                            eq(premises.id, input.premiseId),
                            eq(premises.businessId, businessId),
                        ),
                    )
                    .limit(1);

                if (!premise) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message: "Premise does not belong to this business",
                    });
                }
            }

            if (input.code) {
                const [duplicate] = await ctx.db
                    .select({ id: warehouses.id })
                    .from(warehouses)
                    .where(
                        and(
                            eq(warehouses.businessId, businessId),
                            eq(warehouses.code, input.code),
                        ),
                    )
                    .limit(1);

                if (duplicate && duplicate.id !== input.id) {
                    throw new TRPCError({
                        code: "CONFLICT",
                        message: "A warehouse with this code already exists",
                    });
                }
            }

            const { id: _id, ...data } = input;

            const [updated] = await ctx.db
                .update(warehouses)
                .set({
                    ...data,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(warehouses.id, input.id),
                        eq(warehouses.businessId, businessId),
                    ),
                )
                .returning();

            return updated;
        }, (_r, input) => ({ action: "warehouse.warehouseUpdate", entityType: "warehouse", entityId: input.id, metadata: { ...input } }))),

    warehouseDelete: memberProcedure
        .input(
            z.object({
                id: z.string().uuid(),
            }),
        )
        .mutation(withAudit(async ({ input, ctx }) => {
        requireCan(ctx.ability, "manage", "Business");
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

            const usage = await warehouseUsage(ctx.db, businessId, input.id);
            if (usage.isDefault) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "This is a default warehouse. Choose another default before deleting it.",
                });
            }
            if (usage.hasHistory) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "This warehouse has stock history, so it can't be deleted. Mark it inactive instead.",
                });
            }

            const [deleted] = await ctx.db
                .delete(warehouses)
                .where(
                    and(
                        eq(warehouses.id, input.id),
                        eq(warehouses.businessId, businessId),
                    ),
                )
                .returning({ id: warehouses.id });

            if (!deleted) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Warehouse not found",
                });
            }

            return {
                success: true,
                id: deleted.id,
            };
        }, (_r, input) => ({ action: "warehouse.warehouseDelete", entityType: "warehouse", entityId: input.id }))),

    // ============================================================
    // WAREHOUSE LOCATIONS
    // ============================================================

    locationList: viewerProcedure
        .input(
            z.object({
                warehouseId: z.string().uuid(),
            }),
        )
        .query(async ({ input, ctx }) => {
        requireCan(ctx.ability, "read", "Item");
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

            const [warehouse] = await ctx.db
                .select({ id: warehouses.id })
                .from(warehouses)
                .where(
                    and(
                        eq(warehouses.id, input.warehouseId),
                        eq(warehouses.businessId, businessId),
                    ),
                )
                .limit(1);

            if (!warehouse) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Warehouse not found",
                });
            }

            return ctx.db
                .select()
                .from(warehouseLocations)
                .where(
                    eq(
                        warehouseLocations.warehouseId,
                        input.warehouseId,
                    ),
                )
                .orderBy(asc(warehouseLocations.name));
        }),

    locationCreate: memberProcedure
        .input(
            z.object({
                warehouseId: z.string().uuid(),
                parentId: z.string().uuid().optional().nullable(),
                locationType: z.enum([
                    "AREA",
                    "RACK",
                    "SHELF",
                    "BIN",
                ]),
                name: z.string().min(1).max(255),
                code: z.string().min(1).max(100),
                status: z.string().max(50).default("active"),
            }),
        )
        .mutation(withAudit(async ({ input, ctx }) => {
        requireCan(ctx.ability, "manage", "Business");
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

            const [warehouse] = await ctx.db
                .select({ id: warehouses.id })
                .from(warehouses)
                .where(
                    and(
                        eq(warehouses.id, input.warehouseId),
                        eq(warehouses.businessId, businessId),
                    ),
                )
                .limit(1);

            if (!warehouse) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Warehouse does not belong to this business",
                });
            }

            if (input.parentId) {
                const [parent] = await ctx.db
                    .select({ id: warehouseLocations.id })
                    .from(warehouseLocations)
                    .where(
                        and(
                            eq(
                                warehouseLocations.id,
                                input.parentId,
                            ),
                            eq(
                                warehouseLocations.warehouseId,
                                input.warehouseId,
                            ),
                        ),
                    )
                    .limit(1);

                if (!parent) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message:
                            "Parent location does not belong to this warehouse",
                    });
                }
            }

            const [existing] = await ctx.db
                .select({ id: warehouseLocations.id })
                .from(warehouseLocations)
                .where(
                    and(
                        eq(
                            warehouseLocations.warehouseId,
                            input.warehouseId,
                        ),
                        eq(
                            warehouseLocations.code,
                            input.code,
                        ),
                    ),
                )
                .limit(1);

            if (existing) {
                throw new TRPCError({
                    code: "CONFLICT",
                    message: "A location with this code already exists",
                });
            }

            const [location] = await ctx.db
                .insert(warehouseLocations)
                .values({
                    warehouseId: input.warehouseId,
                    parentId: input.parentId ?? null,
                    locationType: input.locationType,
                    name: input.name,
                    code: input.code,
                    status: input.status,
                })
                .returning();

            return location;
        }, (r) => ({ action: "warehouse.locationCreate", entityType: "warehouseLocation", entityId: r.id, metadata: { name: r.name, code: r.code, warehouseId: r.warehouseId } }))),

    locationUpdate: memberProcedure
        .input(
            z.object({
                id: z.string().uuid(),
                parentId: z.string().uuid().optional().nullable(),
                locationType: z
                    .enum([
                        "AREA",
                        "RACK",
                        "SHELF",
                        "BIN",
                    ])
                    .optional(),
                name: z.string().min(1).max(255).optional(),
                code: z.string().min(1).max(100).optional(),
                status: z.string().max(50).optional(),
            }),
        )
        .mutation(withAudit(async ({ input, ctx }) => {
        requireCan(ctx.ability, "manage", "Business");
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

            const [existing] = await ctx.db
                .select({
                    id: warehouseLocations.id,
                    warehouseId: warehouseLocations.warehouseId,
                })
                .from(warehouseLocations)
                .innerJoin(
                    warehouses,
                    eq(
                        warehouseLocations.warehouseId,
                        warehouses.id,
                    ),
                )
                .where(
                    and(
                        eq(warehouseLocations.id, input.id),
                        eq(warehouses.businessId, businessId),
                    ),
                )
                .limit(1);

            if (!existing) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Location not found",
                });
            }

            if (input.parentId) {
                if (input.parentId === input.id) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message: "A location cannot be its own parent",
                    });
                }

                const [parent] = await ctx.db
                    .select({ id: warehouseLocations.id })
                    .from(warehouseLocations)
                    .where(
                        and(
                            eq(
                                warehouseLocations.id,
                                input.parentId,
                            ),
                            eq(
                                warehouseLocations.warehouseId,
                                existing.warehouseId,
                            ),
                        ),
                    )
                    .limit(1);

                if (!parent) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message:
                            "Parent location does not belong to this warehouse",
                    });
                }

                // Walk up from the new parent: meeting this location means
                // it would sit under one of its own sub-locations.
                const all = await ctx.db
                    .select({ id: warehouseLocations.id, parentId: warehouseLocations.parentId })
                    .from(warehouseLocations)
                    .where(eq(warehouseLocations.warehouseId, existing.warehouseId));
                const parentOf = new Map(all.map((l) => [l.id, l.parentId]));
                const seen = new Set<string>();
                for (let at: string | null | undefined = input.parentId; at && !seen.has(at); at = parentOf.get(at)) {
                    if (at === input.id) {
                        throw new TRPCError({
                            code: "BAD_REQUEST",
                            message: "A location can't be moved under one of its own sub-locations",
                        });
                    }
                    seen.add(at);
                }
            }

            if (input.code) {
                const [duplicate] = await ctx.db
                    .select({ id: warehouseLocations.id })
                    .from(warehouseLocations)
                    .where(
                        and(
                            eq(
                                warehouseLocations.warehouseId,
                                existing.warehouseId,
                            ),
                            eq(
                                warehouseLocations.code,
                                input.code,
                            ),
                        ),
                    )
                    .limit(1);

                if (duplicate && duplicate.id !== input.id) {
                    throw new TRPCError({
                        code: "CONFLICT",
                        message: "A location with this code already exists",
                    });
                }
            }

            const { id: _id, ...data } = input;

            const [updated] = await ctx.db
                .update(warehouseLocations)
                .set({
                    ...data,
                    updatedAt: new Date(),
                })
                .where(eq(warehouseLocations.id, input.id))
                .returning();

            return updated;
        }, (_r, input) => ({ action: "warehouse.locationUpdate", entityType: "warehouseLocation", entityId: input.id, metadata: { ...input } }))),

    locationDelete: memberProcedure
        .input(
            z.object({
                id: z.string().uuid(),
            }),
        )
        .mutation(withAudit(async ({ input, ctx }) => {
        requireCan(ctx.ability, "manage", "Business");
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

            const [existing] = await ctx.db
                .select({
                    id: warehouseLocations.id,
                })
                .from(warehouseLocations)
                .innerJoin(
                    warehouses,
                    eq(
                        warehouseLocations.warehouseId,
                        warehouses.id,
                    ),
                )
                .where(
                    and(
                        eq(warehouseLocations.id, input.id),
                        eq(warehouses.businessId, businessId),
                    ),
                )
                .limit(1);

            if (!existing) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Location not found",
                });
            }

            const [deleted] = await ctx.db
                .delete(warehouseLocations)
                .where(eq(warehouseLocations.id, input.id))
                .returning({ id: warehouseLocations.id });

            if (!deleted) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Location not found",
                });
            }

            return {
                success: true,
                id: deleted.id,
            };
        }, (_r, input) => ({ action: "warehouse.locationDelete", entityType: "warehouseLocation", entityId: input.id }))),

    warehousePermissionCreate: memberProcedure
        .input(
            z.object({
                warehouseId: z.string().uuid(),
                canView: z.boolean().default(true),
                canReceive: z.boolean().default(false),
                canIssue: z.boolean().default(false),
                canTransfer: z.boolean().default(false),
                canAdjust: z.boolean().default(false),
            }),
        )
        .mutation(withAudit(async ({ input, ctx }) => {
        requireCan(ctx.ability, "manage", "Business");
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

            const [businessMember] = await ctx.db
                .select({
                    id: businessMembers.id,
                })
                .from(businessMembers)
                .where(
                    and(
                        eq(businessMembers.businessId, businessId),
                        eq(businessMembers.userId, ctx.user!.id),
                    ),
                )
                .limit(1);

            if (!businessMember) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "You do not have access to this business",
                });
            }

            const [warehouse] = await ctx.db
                .select({
                    id: warehouses.id,
                })
                .from(warehouses)
                .where(
                    and(
                        eq(warehouses.id, input.warehouseId),
                        eq(warehouses.businessId, businessId),
                    ),
                )
                .limit(1);

            if (!warehouse) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Warehouse does not belong to this business",
                });
            }

            const [existing] = await ctx.db
                .select({
                    id: warehousePermissions.id,
                })
                .from(warehousePermissions)
                .where(
                    and(
                        eq(
                            warehousePermissions.businessMemberId,
                            businessMember.id,
                        ),
                        eq(warehousePermissions.warehouseId, input.warehouseId),
                    ),
                )
                .limit(1);

            if (existing) {
                throw new TRPCError({
                    code: "CONFLICT",
                    message: "Warehouse permission already exists",
                });
            }

            const [permission] = await ctx.db
                .insert(warehousePermissions)
                .values({
                    businessId,
                    businessMemberId: businessMember.id,
                    warehouseId: input.warehouseId,
                    canView: input.canView,
                    canReceive: input.canReceive,
                    canIssue: input.canIssue,
                    canTransfer: input.canTransfer,
                    canAdjust: input.canAdjust,
                })
                .returning();

            return permission;
        }, (r) => ({ action: "warehouse.permissionCreate", entityType: "warehousePermission", entityId: r.id, metadata: { warehouseId: r.warehouseId, businessMemberId: r.businessMemberId } }))),

    // ============================================================
    // INVENTORY SETTINGS
    // ============================================================

    inventorySettingsGet: viewerProcedure.query(async ({ ctx }) => {
        requireCan(ctx.ability, "read", "Item");
        if (!ctx.businessId) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Business context is required",
            });
        }

        const businessId = ctx.businessId;

        const [settings] = await ctx.db
            .select()
            .from(inventorySettings)
            .where(eq(inventorySettings.businessId, businessId))
            .limit(1);

        return settings ?? null;
    }),

    inventorySettingsUpdate: memberProcedure
        .input(
            z.object({
                salesWarehouseId: z.string().uuid().nullable().optional(),
                purchaseWarehouseId: z.string().uuid().nullable().optional(),
                salesReturnWarehouseId: z.string().uuid().nullable().optional(),
                purchaseReturnWarehouseId: z.string().uuid().nullable().optional(),
                productionWarehouseId: z.string().uuid().nullable().optional(),
                stockAdjustmentWarehouseId: z.string().uuid().nullable().optional(),
            }),
        )
        .mutation(withAudit(async ({ input, ctx }) => {
        requireCan(ctx.ability, "manage", "Business");
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

            const warehouseIds = [
                input.salesWarehouseId,
                input.purchaseWarehouseId,
                input.salesReturnWarehouseId,
                input.purchaseReturnWarehouseId,
                input.productionWarehouseId,
                input.stockAdjustmentWarehouseId,
            ].filter((id): id is string => Boolean(id));

            if (warehouseIds.length > 0) {
                const validWarehouses = await ctx.db
                    .select({
                        id: warehouses.id,
                    })
                    .from(warehouses)
                    .where(
                        and(
                            eq(warehouses.businessId, businessId),
                        ),
                    );

                const validWarehouseIds = new Set(
                    validWarehouses.map((warehouse) => warehouse.id),
                );

                const invalidWarehouseId = warehouseIds.find(
                    (id) => !validWarehouseIds.has(id),
                );

                if (invalidWarehouseId) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message:
                            "One or more selected warehouses do not belong to the current business",
                    });
                }
            }

            const [existing] = await ctx.db
                .select({
                    id: inventorySettings.id,
                })
                .from(inventorySettings)
                .where(eq(inventorySettings.businessId, businessId))
                .limit(1);

            // Only the defaults that were sent change; leaving one out keeps
            // it, so a screen showing some of them can't clear the others.
            const keys = [
                "salesWarehouseId",
                "purchaseWarehouseId",
                "salesReturnWarehouseId",
                "purchaseReturnWarehouseId",
                "productionWarehouseId",
                "stockAdjustmentWarehouseId",
            ] as const;
            const data = {
                ...Object.fromEntries(
                    keys.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]),
                ),
                updatedAt: new Date(),
            };

            if (existing) {
                const [updated] = await ctx.db
                    .update(inventorySettings)
                    .set(data)
                    .where(eq(inventorySettings.id, existing.id))
                    .returning();

                return updated;
            }

            const [created] = await ctx.db
                .insert(inventorySettings)
                .values({
                    businessId,
                    ...data,
                })
                .returning();

            return created;
        }, (r, input) => ({ action: "warehouse.inventorySettingsUpdate", entityType: "inventorySettings", entityId: r?.id ?? null, metadata: { ...input } }))),

    // ============================================================
    // PER-MEMBER WAREHOUSE ACCESS
    // ============================================================

    /**
     * Team members of this business with what they may do in one warehouse.
     * Owners and admins manage every warehouse; everyone else needs a grant
     * to transfer or adjust stock there.
     */
    accessList: viewerProcedure
        .input(z.object({ warehouseId: z.string().uuid() }))
        .query(async ({ input, ctx }) => {
            requireCan(ctx.ability, "manage", "Business");
            const members = await ctx.db
                .select({ id: businessMembers.id, userId: businessMembers.userId, role: businessMembers.role })
                .from(businessMembers)
                .where(eq(businessMembers.businessId, ctx.businessId));
            if (members.length === 0) return [];

            const userIds = members.map((m) => m.userId);
            const [people, roles, grants] = await Promise.all([
                controlDb
                    .select({ id: users.id, name: users.name, email: users.email })
                    .from(users)
                    .where(inArray(users.id, userIds)),
                ctx.tenantId
                    ? controlDb
                        .select({ userId: tenantMembers.userId, role: tenantMembers.role })
                        .from(tenantMembers)
                        .where(and(eq(tenantMembers.tenantId, ctx.tenantId), inArray(tenantMembers.userId, userIds)))
                    : Promise.resolve([] as Array<{ userId: string; role: string }>),
                ctx.db
                    .select()
                    .from(warehousePermissions)
                    .where(and(
                        eq(warehousePermissions.businessId, ctx.businessId),
                        eq(warehousePermissions.warehouseId, input.warehouseId),
                    )),
            ]);
            const person = new Map(people.map((p) => [p.id, p]));
            const role = new Map(roles.map((r) => [r.userId, r.role as string]));
            const grant = new Map(grants.map((g) => [g.businessMemberId, g]));

            return members.map((m) => {
                const g = grant.get(m.id);
                // The role they act with here, resolved as in trpc.ts.
                const tenantRole = mapDbRole(role.get(m.userId) ?? "member");
                const r = m.role === "admin" ? (tenantRole === "superadmin" ? "superadmin" : "admin") : tenantRole;
                return {
                    businessMemberId: m.id,
                    name: person.get(m.userId)?.name ?? null,
                    email: person.get(m.userId)?.email ?? null,
                    role: r,
                    fullAccess: ADMIN_ROLES.has(r),
                    canView: g?.canView ?? false,
                    canReceive: g?.canReceive ?? false,
                    canIssue: g?.canIssue ?? false,
                    canTransfer: g?.canTransfer ?? false,
                    canAdjust: g?.canAdjust ?? false,
                };
            });
        }),

    /** Grant or change one member's access to a warehouse; all false removes it. */
    accessSet: memberProcedure
        .input(z.object({
            warehouseId: z.string().uuid(),
            businessMemberId: z.string().uuid(),
            canView: z.boolean(),
            canReceive: z.boolean(),
            canIssue: z.boolean(),
            canTransfer: z.boolean(),
            canAdjust: z.boolean(),
        }))
        .mutation(withAudit(async ({ input, ctx }) => {
            requireCan(ctx.ability, "manage", "Business");
            const [[warehouse], [member]] = await Promise.all([
                ctx.db.select({ id: warehouses.id }).from(warehouses)
                    .where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.businessId, ctx.businessId)))
                    .limit(1),
                ctx.db.select({ id: businessMembers.id }).from(businessMembers)
                    .where(and(eq(businessMembers.id, input.businessMemberId), eq(businessMembers.businessId, ctx.businessId)))
                    .limit(1),
            ]);
            if (!warehouse) throw new TRPCError({ code: "NOT_FOUND", message: "Warehouse not found" });
            if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Team member not found" });

            const where = and(
                eq(warehousePermissions.businessMemberId, input.businessMemberId),
                eq(warehousePermissions.warehouseId, input.warehouseId),
            );
            const flags = {
                canView: input.canView,
                canReceive: input.canReceive,
                canIssue: input.canIssue,
                canTransfer: input.canTransfer,
                canAdjust: input.canAdjust,
            };
            if (!Object.values(flags).some(Boolean)) {
                await ctx.db.delete(warehousePermissions).where(where);
                return { ok: true };
            }
            const [existing] = await ctx.db.select({ id: warehousePermissions.id }).from(warehousePermissions).where(where).limit(1);
            if (existing) {
                await ctx.db.update(warehousePermissions).set(flags).where(eq(warehousePermissions.id, existing.id));
            } else {
                await ctx.db.insert(warehousePermissions).values({
                    businessId: ctx.businessId,
                    businessMemberId: input.businessMemberId,
                    warehouseId: input.warehouseId,
                    ...flags,
                });
            }
            return { ok: true };
        }, (_r, input) => ({ action: "warehouse.accessSet", entityType: "warehousePermission", entityId: input.warehouseId, metadata: { ...input } }))),
});