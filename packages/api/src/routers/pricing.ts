/**
 * Sale-line pricing from price levels (see lib/pricing.ts for the precedence).
 */

import { z } from "zod";
import { router, viewerProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { levelForParty, resolvePrices } from "../lib/pricing.js";
import { getLevel } from "./priceLevel.js";

export const pricingRouter = router({
  /**
   * Unit price for sale lines: the given level, else the party's, else the
   * default level; best slab on the date; else the item's own sale price.
   */
  resolve: viewerProcedure
    .input(z.object({
      partyId: z.string().uuid().nullable().optional(),
      priceLevelId: z.string().uuid().nullable().optional(),
      date: z.string().max(40).nullable().optional(),
      lines: z.array(z.object({
        itemId: z.string().uuid(),
        variantId: z.string().uuid().nullable().optional(),
        unit: z.string().max(50).nullable().optional(),
        quantity: z.union([z.string().max(30), z.number()]).nullable().optional(),
      })).max(500),
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Item");
      let level: { id: string; name: string } | null = null;
      if (input.priceLevelId) {
        level = await getLevel(ctx.db, ctx.businessId, input.priceLevelId);
      } else {
        level = await levelForParty(ctx.db, ctx.businessId, input.partyId);
      }
      const lines = await resolvePrices(ctx.db, ctx.businessId, level?.id ?? null, input.lines, input.date);
      return { priceLevel: level ? { id: level.id, name: level.name } : null, lines };
    }),
});
