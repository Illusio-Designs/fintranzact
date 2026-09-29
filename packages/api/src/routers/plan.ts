import { router, publicProcedure } from "../trpc.js";
import { listPublicPlans } from "../lib/public-plans.js";

/** Public plan catalogue — no sign-in needed; read by the pricing and sign-up pages. */
export const planRouter = router({
  list: publicProcedure.query(() => listPublicPlans()),
});
