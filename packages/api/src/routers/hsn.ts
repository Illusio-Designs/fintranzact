import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { hsnSearchSchema } from "@fintranzact/shared";
import { searchHsn, describeHsn, validateHsnForTurnover } from "../lib/hsn-data.js";

export const hsnRouter = router({
  search: publicProcedure
    .input(hsnSearchSchema)
    .query(({ input }) => {
      return searchHsn(input.query, { type: input.type, limit: input.limit });
    }),

  validate: publicProcedure
    .input(z.object({ hsn: z.string().min(2).max(8) }))
    .query(({ input }) => {
      const details = describeHsn(input.hsn);
      return details ? { valid: true as const, details } : { valid: false as const };
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
