import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { controlDb, partners } from "@fintranzact/db";
import { partnerApplicationSchema } from "@fintranzact/shared";
import { getPartnerStats } from "../lib/partner-program.js";
import { router, publicProcedure } from "../trpc.js";
import { verifyTurnstile } from "../lib/turnstile.js";
import { logger } from "../lib/logger.js";

/**
 * Public side of the partner programme: the "Become a partner" form and the
 * directory of approved partners. Reviewing applications is in
 * platform.partners / platform.updatePartner (platform admins only).
 */
export const partnerRouter = router({
  submitApplication: publicProcedure.input(partnerApplicationSchema).mutation(async ({ input, ctx }) => {
    if (process.env.TURNSTILE_SECRET_KEY) {
      const ok = input.turnstileToken
        ? await verifyTurnstile(input.turnstileToken, ctx.ipAddress)
        : false;
      if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "Verification failed. Please refresh and try again." });
    }

    const [pending] = await controlDb
      .select({ id: partners.id })
      .from(partners)
      .where(and(eq(partners.email, input.email), eq(partners.status, "pending")))
      .limit(1);
    if (pending) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "We already have an application from this email. We'll be in touch soon.",
      });
    }

    const { turnstileToken: _token, ...application } = input;
    const [row] = await controlDb.insert(partners).values(application).returning({ id: partners.id });
    logger.info({ partnerId: row?.id, partnerType: input.partnerType }, "Partner application received");
    return { received: true };
  }),

  /** Approved partners who agreed to be listed, with their badge. Contact details stay private. */
  directory: publicProcedure.query(async () => {
    const rows = await controlDb
      .select({
        commissionPercent: partners.commissionPercent,
        id: partners.id,
        companyName: partners.companyName,
        city: partners.city,
        state: partners.state,
        website: partners.website,
        partnerType: partners.partnerType,
      })
      .from(partners)
      .where(and(eq(partners.status, "approved"), eq(partners.listPublicly, true)))
      .orderBy(asc(partners.companyName));
    const stats = await getPartnerStats(rows);
    return rows.map(({ commissionPercent: _c, ...p }) => ({ ...p, badge: stats.get(p.id)!.badge.id }));
  }),
});
