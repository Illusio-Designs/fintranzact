import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { hsnSearchSchema } from "@fintranzact/shared";
import { searchHsn, validateHsnForTurnover } from "../lib/hsn-data.js";
import { resolveHsn } from "../lib/hsn-lookup.js";

export const hsnRouter = router({
  search: publicProcedure
    .input(hsnSearchSchema)
    .query(({ input }) => {
      return searchHsn(input.query, { type: input.type, limit: input.limit });
    }),

  validate: publicProcedure
    .input(z.object({ hsn: z.string().min(2).max(8) }))
    .query(async ({ input }) => {
      // `valid` and `details` keep their bundled-list meaning (what an item
      // save accepts); the rest is additive Sandbox information.
      const r = await resolveHsn(input.hsn);
      const extra = {
        source: r.source,
        sandboxStatus: r.sandboxStatus,
        /** When source is "refreshed": when Sandbox last confirmed the code. */
        checkedAt: r.checkedAt,
        /** Sandbox's answer, live or (source "refreshed") from the last daily refresh. */
        sandbox: r.sandbox
          ? {
              description: r.sandbox.description,
              rate: r.rate,
              effectiveFrom: r.effectiveFrom,
              effectiveTo: r.effectiveTo,
              active: r.active,
              inactiveReason: r.sandbox.inactiveReason ?? null,
            }
          : null,
        ...(r.warning ? { warning: r.warning } : {}),
      };
      return r.bundled
        ? { valid: true as const, details: r.bundled, ...extra }
        : { valid: false as const, ...extra };
    }),

  validateForTurnover: publicProcedure
    .input(z.object({
      hsn: z.string().min(2).max(8),
      annualTurnover: z.string(),
    }))
    .query(({ input }) => {
      return validateHsnForTurnover(input.hsn, input.annualTurnover);
    }),
});
