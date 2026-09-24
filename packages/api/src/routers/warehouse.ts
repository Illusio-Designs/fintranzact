import { and, eq, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import {
    premises,
    warehouses,
    warehouseLocations,
    inventorySettings,
    stockBalances,
    warehousePermissions,
    businessMembers,
} from "@hisaabo/db";

import { router, tenantProcedure } from "../trpc.js";
import { recordStockMovement } from "../lib/inventory-service.js";

export const warehouseRouter = router({
    // ============================================================
    // PREMISES
    // ============================================================

    premiseList: tenantProcedure.query(async ({ ctx }) => {
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

    premiseGet: tenantProcedure
        .input(
            z.object({
                id: z.string().uuid(),
            }),
        )
        .query(async ({ input, ctx }) => {
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

    premiseCreate: tenantProcedure
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
        .mutation(async ({ input, ctx }) => {
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
        }),

    premiseUpdate: tenantProcedure
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
        .mutation(async ({ input, ctx }) => {
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
        }),

    premiseDelete: tenantProcedure
        .input(
            z.object({
                id: z.string().uuid(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

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
        }),

    // ============================================================
    // WAREHOUSES
    // ============================================================

    warehouseList: tenantProcedure
        .input(
            z
                .object({
                    premiseId: z.string().uuid().optional(),
                })
                .optional(),
        )
        .query(async ({ input, ctx }) => {
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

    warehouseGet: tenantProcedure
        .input(
            z.object({
                id: z.string().uuid(),
            }),
        )
        .query(async ({ input, ctx }) => {
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

    warehouseCreate: tenantProcedure
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
        .mutation(async ({ input, ctx }) => {
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
        }),

    warehouseUpdate: tenantProcedure
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
        .mutation(async ({ input, ctx }) => {
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

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
        }),

    warehouseDelete: tenantProcedure
        .input(
            z.object({
                id: z.string().uuid(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            const businessId = ctx.businessId;

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
        }),

    // ============================================================
    // WAREHOUSE LOCATIONS
    // ============================================================

    locationList: tenantProcedure
        .input(
            z.object({
                warehouseId: z.string().uuid(),
            }),
        )
        .query(async ({ input, ctx }) => {
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

    locationCreate: tenantProcedure
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
        .mutation(async ({ input, ctx }) => {
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
        }),

    locationUpdate: tenantProcedure
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
        .mutation(async ({ input, ctx }) => {
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
        }),

    locationDelete: tenantProcedure
        .input(
            z.object({
                id: z.string().uuid(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
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
        }),

    warehousePermissionCreate: tenantProcedure
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
        .mutation(async ({ input, ctx }) => {
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
        }),

    stockTransfer: tenantProcedure
        .input(
            z.object({
                sourceWarehouseId: z.string().uuid(),
                destinationWarehouseId: z.string().uuid(),
                itemId: z.string().uuid(),
                variantId: z.string().uuid().optional(),
                quantity: z.string(),
                actorUserId: z.string().uuid().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            if (!ctx.businessId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Business context is required",
                });
            }

            if (input.sourceWarehouseId === input.destinationWarehouseId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Source and destination warehouse must be different",
                });
            }

            const quantity = Number(input.quantity);

            if (!Number.isFinite(quantity) || quantity <= 0) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Quantity must be greater than zero",
                });
            }

            const warehouseRows = await ctx.db
                .select({
                    id: warehouses.id,
                })
                .from(warehouses)
                .where(
                    and(
                        eq(warehouses.businessId, ctx.businessId),
                        sql`${warehouses.id} IN (${input.sourceWarehouseId}, ${input.destinationWarehouseId})`,
                    ),
                );

            const [businessMember] = await ctx.db
                .select({
                    id: businessMembers.id,
                })
                .from(businessMembers)
                .where(
                    and(
                        eq(businessMembers.businessId, ctx.businessId),
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

            const transferPermissions = await ctx.db
                .select({
                    warehouseId: warehousePermissions.warehouseId,
                    canTransfer: warehousePermissions.canTransfer,
                })
                .from(warehousePermissions)
                .where(
                    and(
                        eq(
                            warehousePermissions.businessMemberId,
                            businessMember.id,
                        ),
                        sql`${warehousePermissions.warehouseId} IN (${input.sourceWarehouseId}, ${input.destinationWarehouseId})`,
                    ),
                );

            if (
                transferPermissions.length !== 2 ||
                transferPermissions.some((permission) => !permission.canTransfer)
            ) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "You do not have transfer permission for both warehouses",
                });
            }

            if (warehouseRows.length !== 2) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Source or destination warehouse not found",
                });
            }

            return await ctx.db.transaction(async (tx) => {
                const sourceBalance = await tx
                    .select({
                        quantity: stockBalances.quantity,
                    })
                    .from(stockBalances)
                    .where(
                        and(
                            eq(stockBalances.businessId, ctx.businessId!),
                            eq(stockBalances.warehouseId, input.sourceWarehouseId),
                            eq(stockBalances.itemId, input.itemId),
                            input.variantId
                                ? eq(stockBalances.variantId, input.variantId)
                                : sql`${stockBalances.variantId} IS NULL`,
                            sql`${stockBalances.locationId} IS NULL`,
                        ),
                    )
                    .limit(1);

                const availableQuantity = Number(sourceBalance[0]?.quantity ?? 0);

                if (availableQuantity < quantity) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message: `Insufficient stock. Available: ${availableQuantity}`,
                    });
                }

                const referenceId = crypto.randomUUID();

                await recordStockMovement(tx, {
                    businessId: ctx.businessId!,
                    warehouseId: input.sourceWarehouseId,
                    itemId: input.itemId,
                    variantId: input.variantId,
                    referenceType: "STOCK_TRANSFER",
                    referenceId,
                    movementType: "TRANSFER_OUT",
                    quantity: sql<string>`-${input.quantity}::numeric`,
                    actorUserId: input.actorUserId ?? ctx.user!.id,
                });

                await recordStockMovement(tx, {
                    businessId: ctx.businessId!,
                    warehouseId: input.destinationWarehouseId,
                    itemId: input.itemId,
                    variantId: input.variantId,
                    referenceType: "STOCK_TRANSFER",
                    referenceId,
                    movementType: "TRANSFER_IN",
                    quantity: sql<string>`${input.quantity}::numeric`,
                    actorUserId: input.actorUserId ?? ctx.user!.id,
                });

                return {
                    success: true,
                    referenceId,
                    sourceWarehouseId: input.sourceWarehouseId,
                    destinationWarehouseId: input.destinationWarehouseId,
                    quantity: input.quantity,
                };
            });
        }),

    // ============================================================
    // INVENTORY SETTINGS
    // ============================================================

    inventorySettingsGet: tenantProcedure.query(async ({ ctx }) => {
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

    inventorySettingsUpdate: tenantProcedure
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
        .mutation(async ({ input, ctx }) => {
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

            const data = {
                salesWarehouseId: input.salesWarehouseId ?? null,
                purchaseWarehouseId: input.purchaseWarehouseId ?? null,
                salesReturnWarehouseId:
                    input.salesReturnWarehouseId ?? null,
                purchaseReturnWarehouseId:
                    input.purchaseReturnWarehouseId ?? null,
                productionWarehouseId:
                    input.productionWarehouseId ?? null,
                stockAdjustmentWarehouseId:
                    input.stockAdjustmentWarehouseId ?? null,
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
        }),

});