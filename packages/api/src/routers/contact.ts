/**
 * Public enquiry forms on the marketing site: /contact and /partners.
 *
 * Anyone can call `contact.submit` without signing in, so it is guarded by:
 *   - strict zod validation (lengths capped, email checked),
 *   - a per-IP limit of ENQUIRY_LIMIT submissions per ENQUIRY_WINDOW_MS,
 *     on top of the general per-IP tRPC limit in server.ts,
 *   - Cloudflare Turnstile whenever TURNSTILE_SECRET_KEY is configured
 *     (same rule as sign-up and the online store),
 *   - a hidden honeypot field that real visitors never fill in.
 *
 * The enquiry is emailed to CONTACT_INBOX (default support@fintranzact.com)
 * with Reply-To set to the visitor. Without RESEND_API_KEY it is logged.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import { emailService } from "../lib/email.js";
import { verifyTurnstile } from "../lib/turnstile.js";
import { createFixedWindowLimiter } from "../lib/fixed-window-limiter.js";
import { supportBadges } from "../lib/support-badges.js";

export const ENQUIRY_LIMIT = 5;
export const ENQUIRY_WINDOW_MS = 15 * 60 * 1000;

const DEFAULT_INBOX = "support@fintranzact.com";

export const PARTNER_PROGRAMMES = {
  accountant: "Accountants & CA firms",
  reseller: "Resellers & consultants",
  technology: "Technology partners",
} as const;

const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    // Header-injection guard: these values end up in the subject line.
    .refine((v) => !/[\r\n]/.test(v), "Must be a single line");

const common = {
  name: oneLine(100).pipe(z.string().min(2, "Please enter your name")),
  email: z.string().trim().toLowerCase().email("Please enter a valid email").max(255),
  turnstileToken: z.string().max(4096).optional(),
  /** Honeypot: hidden from people, so anything here came from a bot. */
  website: z.string().max(500).optional(),
};

export const enquiryInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("contact"),
    ...common,
    message: z.string().trim().min(10, "Please write a little more").max(5000),
  }),
  z.object({
    kind: z.literal("partner"),
    ...common,
    programme: z.enum(["accountant", "reseller", "technology"]),
    company: oneLine(150).optional(),
    phone: oneLine(30).optional(),
    city: oneLine(100).optional(),
    message: z.string().trim().max(5000).optional(),
  }),
]);

export type EnquiryInput = z.infer<typeof enquiryInputSchema>;

const limiter = createFixedWindowLimiter({ limit: ENQUIRY_LIMIT, windowMs: ENQUIRY_WINDOW_MS });

/** Tests only: start every case with a fresh window. */
export function resetEnquiryRateLimit() {
  limiter.clear();
}

export const contactRouter = router({
  submit: publicProcedure.input(enquiryInputSchema).mutation(async ({ input, ctx }) => {
    const ip = ctx.ipAddress ?? null;

    // The e2e escape hatch (server.ts) covers this limiter too, outside production.
    const limitOff = process.env.DISABLE_RATE_LIMIT === "1" && process.env.NODE_ENV !== "production";
    if (!limitOff && !limiter.hit(ip ?? "unknown")) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many messages from your network. Please try again in a few minutes, or email us.",
      });
    }

    if (process.env.TURNSTILE_SECRET_KEY && !input.turnstileToken) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Turnstile verification required" });
    }
    if (input.turnstileToken) {
      const valid = await verifyTurnstile(input.turnstileToken, ip);
      if (!valid) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Verification failed. Please refresh and try again." });
      }
    }

    // A filled honeypot is a bot: report success so it moves on, send nothing.
    if (input.website) return { success: true };

    const to = process.env.CONTACT_INBOX || DEFAULT_INBOX;

    // A signed-in customer writing in: tell the team which plan support they have
    // (Priority support / Onboarding help included come from the plan flags). Anonymous visitors have none.
    const badges = input.kind === "contact" && ctx.tenantId && ctx.user ? await supportBadges(ctx.tenantId) : null;

    try {
      if (input.kind === "contact") {
        await emailService.sendEnquiry({
          to,
          replyTo: input.email,
          subject: `${badges?.priority ? "[Priority] " : ""}Website enquiry from ${input.name}`,
          fields: [
            ["Name", input.name],
            ["Email", input.email],
            ...(badges && badges.labels.length ? [["Plan support", badges.labels.join(", ")] as [string, string]] : []),
            ["IP", ip ?? ""],
          ],
          message: input.message,
        });
      } else {
        const programme = PARTNER_PROGRAMMES[input.programme];
        await emailService.sendEnquiry({
          to,
          replyTo: input.email,
          subject: `Partner application (${programme}): ${input.company || input.name}`,
          fields: [
            ["Programme", programme],
            ["Name", input.name],
            ["Company / firm", input.company ?? ""],
            ["Email", input.email],
            ["Phone", input.phone ?? ""],
            ["City", input.city ?? ""],
            ["IP", ip ?? ""],
          ],
          message: input.message ?? "",
        });
      }
    } catch (err) {
      console.error("[contact] could not send enquiry:", err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "We couldn't send your message right now.",
      });
    }

    return { success: true };
  }),
});
