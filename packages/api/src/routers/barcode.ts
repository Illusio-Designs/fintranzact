/**
 * Barcode setup for the business (Settings → Barcodes) and the extra codes an
 * item can carry when the business uses "many barcodes per item".
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { businesses, itemBarcodes, items, itemVariants } from "@fintranzact/db";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import QRCode from "qrcode";
import { requireCan } from "../lib/permissions.js";
import { encodeCode128, encodeEan13, isValidEan13 } from "../lib/barcode.js";
import { logAudit } from "../lib/audit.js";
import {
  BARCODE_MODES,
  BARCODE_TYPES,
  LABEL_SIZES,
  assertCodeFree,
  getBarcodeSetup,
  isPrintableCode,
  mintBarcode,
  requireBarcodesEnabled,
} from "../lib/barcode-setup.js";

const codeSchema = z
  .string()
  .trim()
  .min(1, "Enter a barcode")
  .max(64)
  .refine(isPrintableCode, "Barcode may only contain printable characters");

const packQtySchema = z.string().regex(/^\d{1,9}(\.\d{1,3})?$/, "Pack quantity must be a number");

export const barcodeRouter = router({
  /** The business's barcode setup plus the fixed label size for its type. */
  setup: viewerProcedure.query(async ({ ctx }) => {
    requireCan(ctx.ability, "read", "Business");
    const setup = await getBarcodeSetup(ctx.db, ctx.businessId);
    return { ...setup, label: LABEL_SIZES[setup.type] };
  }),

  /**
   * Change the setup. On/off and auto-create can change any time; type and
   * mode only until the setup is locked.
   */
  update: memberProcedure
    .input(z.object({
      enabled: z.boolean().optional(),
      autoGenerate: z.boolean().optional(),
      type: z.enum(BARCODE_TYPES).optional(),
      mode: z.enum(BARCODE_MODES).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireCan(ctx.ability, "manage", "Business");
      const current = await getBarcodeSetup(ctx.db, ctx.businessId);
      const changesLocked =
        (input.type !== undefined && input.type !== current.type) ||
        (input.mode !== undefined && input.mode !== current.mode);
      if (current.lockedAt && changesLocked) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Barcode type and barcodes-per-item are locked for this business",
        });
      }
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (input.enabled !== undefined) set.barcodesEnabled = input.enabled;
      if (input.autoGenerate !== undefined) set.autoGenerateBarcodes = input.autoGenerate;
      if (input.type !== undefined) set.barcodeType = input.type;
      if (input.mode !== undefined) set.barcodeMode = input.mode;
      await ctx.db.update(businesses).set(set).where(eq(businesses.id, ctx.businessId));
      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "barcode.updateSetup",
        entityType: "business",
        entityId: ctx.businessId,
        metadata: input,
        ipAddress: ctx.ipAddress,
      });
      const setup = await getBarcodeSetup(ctx.db, ctx.businessId);
      return { ...setup, label: LABEL_SIZES[setup.type] };
    }),

  /** Fix the barcode type and barcodes-per-item for good. */
  lock: memberProcedure
    .input(z.object({ type: z.enum(BARCODE_TYPES), mode: z.enum(BARCODE_MODES) }))
    .mutation(async ({ ctx, input }) => {
      requireCan(ctx.ability, "manage", "Business");
      const [row] = await ctx.db
        .update(businesses)
        .set({
          barcodeType: input.type,
          barcodeMode: input.mode,
          barcodesEnabled: true,
          barcodeSetupLockedAt: new Date(),
          barcodeSetupLockedBy: ctx.user.name ?? ctx.user.email ?? null,
          updatedAt: new Date(),
        })
        // Locking twice must not silently change a locked setup.
        .where(and(eq(businesses.id, ctx.businessId), isNull(businesses.barcodeSetupLockedAt)))
        .returning({ id: businesses.id });
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Barcode setup is already locked" });
      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user.id,
        action: "barcode.lockSetup",
        entityType: "business",
        entityId: ctx.businessId,
        metadata: input,
        ipAddress: ctx.ipAddress,
      });
      const setup = await getBarcodeSetup(ctx.db, ctx.businessId);
      return { ...setup, label: LABEL_SIZES[setup.type] };
    }),

  /** Extra codes on one item (or one variant). */
  itemCodes: viewerProcedure
    .input(z.object({ itemId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      requireCan(ctx.ability, "read", "Item");
      return ctx.db
        .select({
          id: itemBarcodes.id,
          variantId: itemBarcodes.variantId,
          code: itemBarcodes.code,
          packQty: itemBarcodes.packQty,
          label: itemBarcodes.label,
          source: itemBarcodes.source,
        })
        .from(itemBarcodes)
        .where(and(eq(itemBarcodes.businessId, ctx.businessId), eq(itemBarcodes.itemId, input.itemId)))
        .orderBy(asc(itemBarcodes.createdAt));
    }),

  addItemCode: memberProcedure
    .input(z.object({
      itemId: z.string().uuid(),
      variantId: z.string().uuid().nullish(),
      code: codeSchema.optional(),
      /** Create a new code in the business's type instead of typing one. */
      generate: z.boolean().optional(),
      packQty: packQtySchema.default("1"),
      label: z.string().trim().max(60).optional(),
      source: z.enum(["supplier", "manual", "old"]).default("manual"),
    }))
    .mutation(async ({ ctx, input }) => {
      requireCan(ctx.ability, "update", "Item");
      const setup = await getBarcodeSetup(ctx.db, ctx.businessId);
      requireBarcodesEnabled(setup);
      if (setup.mode !== "multi") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This business uses one barcode per item",
        });
      }
      if (parseFloat(input.packQty) <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Pack quantity must be more than 0" });
      }
      if (!input.code && !input.generate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a barcode" });
      }

      return ctx.db.transaction(async (tx) => {
        const [item] = await tx
          .select({ id: items.id, sku: items.sku })
          .from(items)
          .where(and(eq(items.id, input.itemId), eq(items.businessId, ctx.businessId), isNull(items.deletedAt)))
          .limit(1);
        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
        if (input.variantId) {
          const [variant] = await tx
            .select({ id: itemVariants.id })
            .from(itemVariants)
            .where(and(eq(itemVariants.id, input.variantId), eq(itemVariants.itemId, item.id), isNull(itemVariants.deletedAt)))
            .limit(1);
          if (!variant) throw new TRPCError({ code: "NOT_FOUND", message: "Variant not found" });
        }

        const code = input.code ?? (await mintBarcode(tx, ctx.businessId, setup.type, null));
        await assertCodeFree(tx, ctx.businessId, code, {});
        const [row] = await tx
          .insert(itemBarcodes)
          .values({
            businessId: ctx.businessId,
            itemId: item.id,
            variantId: input.variantId ?? null,
            code,
            packQty: input.packQty,
            label: input.label || null,
            source: input.code ? input.source : "generated",
          })
          .returning();
        return row;
      });
    }),

  removeItemCode: memberProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireCan(ctx.ability, "update", "Item");
      const [row] = await ctx.db
        .delete(itemBarcodes)
        .where(and(eq(itemBarcodes.id, input.id), eq(itemBarcodes.businessId, ctx.businessId)))
        .returning({ id: itemBarcodes.id });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Barcode not found" });
      return row;
    }),

  /** A new code in the business's type, for the item form's "Create code" button. */
  generate: memberProcedure
    .input(z.object({ sku: z.string().max(50).nullish() }))
    .mutation(async ({ ctx, input }) => {
      requireCan(ctx.ability, "update", "Item");
      const setup = await getBarcodeSetup(ctx.db, ctx.businessId);
      requireBarcodesEnabled(setup);
      const code = await ctx.db.transaction((tx) => mintBarcode(tx, ctx.businessId, setup.type, input.sku));
      return { code };
    }),

  /**
   * Bars or QR modules for on-screen previews, drawn by the same encoders the
   * printed labels use. `type` defaults to the business's barcode type; an
   * EAN-13 business shows a non-EAN code as Code 128, as the label does.
   */
  symbol: viewerProcedure
    .input(z.object({ code: codeSchema, type: z.enum(BARCODE_TYPES).optional() }))
    .query(async ({ ctx, input }) => {
      requireCan(ctx.ability, "read", "Item");
      const type = input.type ?? (await getBarcodeSetup(ctx.db, ctx.businessId)).type;
      try {
        if (type === "qr") {
          const qr = QRCode.create(input.code, { errorCorrectionLevel: "M" });
          const size = qr.modules.size;
          const rows: string[] = [];
          for (let r = 0; r < size; r++) {
            let row = "";
            for (let c = 0; c < size; c++) row += qr.modules.get(r, c) ? "1" : "0";
            rows.push(row);
          }
          return { kind: "matrix" as const, type, rows, text: input.code };
        }
        const ean = type === "ean13" && isValidEan13(input.code);
        const encoded = ean ? encodeEan13(input.code) : encodeCode128(input.code);
        const bits = Array<string>(encoded.modules).fill("0");
        for (const bar of encoded.bars) for (let k = 0; k < bar.width; k++) bits[bar.x + k] = "1";
        return {
          kind: "bars" as const,
          type: ean ? ("ean13" as const) : ("code128" as const),
          modules: bits.join(""),
          text: ean ? `${input.code[0]} ${input.code.slice(1, 7)} ${input.code.slice(7)}` : input.code,
        };
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "Cannot draw this code" });
      }
    }),
});
