import { eq, and, gt, lte, isNull, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { isPlatformAdmin } from "../lib/platform-admin.js";
import { controlDb, users, sessions, tenants, tenantMembers, emailChangeTokens, invitations, accessTokens, provisionTenantDatabase, cleanupTenantDatabase, type TenantDbConfig } from "@fintranzact/db";
import { normalizeReferralCode } from "@fintranzact/shared";
import { partnerForReferralCode } from "../lib/partner-program.js";
import { loginSchema, registerSchema, completeProfileSchema } from "@fintranzact/shared";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { emailService } from "../lib/email.js";
import { invalidateSessionCache, getSessionIdFromRequest, revokeAllUserSessions } from "../context.js";
import { verifyTurnstile } from "../lib/turnstile.js";
import { getClientKind } from "../lib/client-headers.js";
import { enforceSessionLimit } from "../lib/plan-limits.js";
import { createFixedWindowLimiter } from "../lib/fixed-window-limiter.js";
import { createTwoFactorDeps, createTwoFactorLoginDeps } from "../lib/two-factor-store.js";
import {
  appendSetCookies,
  canRememberDevice,
  decideSignIn,
  issueTrustedDevice,
  listTrustedDevices,
  planTrustedDeviceDelivery,
  presentedTrustedDeviceToken,
  readTrustedDeviceCookie,
  resolveClientKind,
  revokeAllTrustedDevices,
  revokeTrustedDevice,
  trustedDeviceClearCookie,
  verifySignInChallenge,
} from "../lib/two-factor-login.js";
import {
  beginTwoFactorSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
  getTwoFactorStatus,
  regenerateBackupCodes,
} from "../lib/two-factor.js";

// TTL for short-lived access tokens (15 minutes)
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const BEARER_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days sliding window
const BEARER_MAX_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30-day absolute cap

// Per-email rate limiting for login attempts
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const failedLoginAttempts = new Map<string, { count: number; firstAttempt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of failedLoginAttempts) {
    if (now - entry.firstAttempt > LOGIN_WINDOW_MS) failedLoginAttempts.delete(key);
  }
}, 5 * 60_000).unref();

// Wrong passwords typed into the two-factor security screens (disable,
// regenerate codes) are counted per USER, separately from the sign-in limiter
// above: someone holding a session but not the password must not be able to
// lock the real user out of signing in. Same policy: 5 failures per 15 minutes.
const passwordRecheckFailures = new Map<string, { count: number; firstAttempt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of passwordRecheckFailures) {
    if (now - entry.firstAttempt > LOGIN_WINDOW_MS) passwordRecheckFailures.delete(key);
  }
}, 5 * 60_000).unref();

const twoFactorDeps = createTwoFactorDeps({
  isBlocked(key) {
    const a = passwordRecheckFailures.get(key);
    return !!a && a.count >= LOGIN_MAX_ATTEMPTS && Date.now() - a.firstAttempt < LOGIN_WINDOW_MS;
  },
  recordFailure(key) {
    const prev = passwordRecheckFailures.get(key);
    if (prev && Date.now() - prev.firstAttempt < LOGIN_WINDOW_MS) prev.count++;
    else passwordRecheckFailures.set(key, { count: 1, firstAttempt: Date.now() });
  },
});

// Sign-in challenge: per-IP and per-challenge fixed windows are the first line
// of defence in front of the per-user lockout and the per-challenge attempt cap.
const twoFactorLoginDeps = createTwoFactorLoginDeps(twoFactorDeps, {
  ipLimiter: createFixedWindowLimiter({ limit: 30, windowMs: 15 * 60_000 }),
  challengeLimiter: createFixedWindowLimiter({ limit: 10, windowMs: 5 * 60_000 }),
});

const clientInput = z.enum(["web", "mobile", "desktop", "cli"]);

/** The client kind for this request: header first, then the `client` input, else web. */
function clientKindFor(req: Request, input?: string | null) {
  return resolveClientKind(getClientKind(req.headers), input);
}

// Starting setup mints a secret and renders a QR: 10 per hour per user is plenty.
const setupLimiter = createFixedWindowLimiter({ limit: 10, windowMs: 60 * 60_000 });

/** Two-factor settings need a real session (cookie, session Bearer or access token), never an API key. */
function requireSession(ctx: { authTokenKind?: "access" | "refresh" | "cookie" | null }): void {
  if (!ctx.authTokenKind) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Two-factor settings can only be changed from a signed-in session, not with an API key.",
    });
  }
}

/** The caller's own session id, so it survives the rotation. Access tokens map to their parent session. */
async function currentSessionId(ctx: { req: Request; authTokenKind?: string | null }): Promise<string | null> {
  const direct = getSessionIdFromRequest(ctx.req);
  if (direct) return direct;
  if (ctx.authTokenKind === "access") {
    const bearer = ctx.req.headers.get("authorization");
    const token = bearer?.startsWith("Bearer ") ? bearer.slice(7) : null;
    if (token?.startsWith("at_")) {
      const [row] = await controlDb
        .select({ sessionId: accessTokens.sessionId })
        .from(accessTokens)
        .where(eq(accessTokens.id, token))
        .limit(1);
      return row?.sessionId ?? null;
    }
  }
  return null;
}

function eventContext(ctx: { req: Request; ipAddress?: string | null }) {
  return { ip: ctx.ipAddress ?? null, userAgent: ctx.req.headers.get("user-agent") };
}

const twoFactorCodeInput = z.object({
  password: z.string().min(1).max(128),
  code: z.string().min(1).max(64),
});

function generateSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const suffix = nanoid(6);
  return `${base}-${suffix}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const IS_SECURE = (process.env.APP_URL || "").startsWith("https");

// Safe IP extraction from a raw Request — mirrors the logic in server.ts getClientIp().
// Prefers cf-connecting-ip (Cloudflare, strips spoofed values at CDN edge).
// Falls back to the LAST entry of x-forwarded-for (set by the closest trusted proxy).
function getClientIpFromRequest(req: Request): string | null {
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return null;
}

/**
 * Tauri desktop clients can't solve Cloudflare Turnstile challenges — the
 * widget rejects the `tauri.localhost` / `tauri://localhost` host. The web
 * bundle running inside Tauri sets `X-Fintranzact-Client: desktop` and we skip
 * the Turnstile gate here.
 *
 * Trade-off: the header is client-supplied and therefore spoofable. A
 * scripted attacker who sends this header bypasses Turnstile. We accept
 * that because (a) the desktop build is distributed as a signed binary,
 * (b) login already has per-email rate limiting, and (c) register
 * abuse is still bounded by email validation + session creation costs.
 * If abuse materialises, add per-IP rate limiting on these endpoints.
 */
function isDesktopClient(req: Request): boolean {
  return getClientKind(req.headers) === "desktop";
}

/**
 * Returns true when the session being minted will be consumed as a Bearer
 * token rather than a cookie. Mobile and desktop clients carry
 * `X-Fintranzact-Client: mobile | desktop`; they never rely on Set-Cookie.
 *
 * We use the client header (not the presence of an Authorization header) as
 * the signal because at session creation time there IS no existing Bearer
 * token yet — the whole point is we are minting the very first one.
 */
function isBearerClient(req: Request): boolean {
  const client = getClientKind(req.headers);
  return client === "mobile" || client === "desktop";
}

/** Case-insensitive match on users.email (sign-up stores it lowercase). */
function emailMatches(emailLower: string) {
  return sql`lower(${users.email}) = ${emailLower}`;
}

// ── Shared helper: self-hosted tenant assignment ─────────────────────
// Every new sign-up gets their own organization and becomes the owner.
type ControlTx = Parameters<Parameters<typeof controlDb.transaction>[0]>[0];

async function createTenantForUser(
  userId: string,
  displayName: string,
  parentTx?: ControlTx,
  referralCode: string | null = null,
): Promise<string> {
  const run = async (tx: ControlTx) => {
    const tenantName = `${displayName.trim() || "My Organization"}'s Organization`;
    const slug = generateSlug(tenantName);

    const [tenant] = await tx.insert(tenants).values({
      name: tenantName,
      slug,
      plan: "forever_free",
      // Self sign-up: the owner still has to choose a plan.
      planSelectedAt: null,
      referralCode: normalizeReferralCode(referralCode),
      partnerId: await partnerForReferralCode(tx, referralCode),
    }).returning({ id: tenants.id });

    await tx.insert(tenantMembers).values({
      tenantId: tenant.id,
      userId,
      role: "owner",
      acceptedAt: new Date(),
    });

    return tenant.id;
  };

  return parentTx ? run(parentTx) : controlDb.transaction(run);
}

// ── Shared helper: create session + resolve tenant ─────────────
async function createSessionForUser(
  userId: string,
  ctx: { req: Request; resHeaders: Headers },
  authMethod: "cookie" | "bearer" = "cookie",
): Promise<string> {
  const memberships = await controlDb
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, userId));

  const resolvedTenantId = memberships.length === 1 ? memberships[0].tenantId : null;

  // Evict oldest sessions if at plan limit (FIFO, never blocks login)
  await enforceSessionLimit(userId);

  const previousSessionId = getSessionIdFromRequest(ctx.req);
  if (previousSessionId && !previousSessionId.startsWith("fintranzact_key_")) {
    controlDb.delete(sessions).where(eq(sessions.id, previousSessionId)).catch(() => { });
    invalidateSessionCache(previousSessionId);
  }

  const now = Date.now();
  const sessionId = nanoid(64);

  // Bearer sessions use a 7-day sliding window with a 30-day absolute cap.
  // Cookie sessions keep the existing 30-day fixed expiry.
  const expiresAt = new Date(now + (authMethod === "bearer" ? BEARER_SESSION_DURATION_MS : SESSION_DURATION_MS));
  const maxExpiresAt = authMethod === "bearer" ? new Date(now + BEARER_MAX_SESSION_DURATION_MS) : null;

  await controlDb.insert(sessions).values({
    id: sessionId,
    userId,
    tenantId: resolvedTenantId,
    expiresAt,
    maxExpiresAt,
    authMethod,
    ipAddress: getClientIpFromRequest(ctx.req),
    userAgent: ctx.req.headers.get("user-agent") || null,
  });

  // Cookie clients always get Set-Cookie; Bearer clients hold the token in-app.
  if (authMethod === "cookie") {
    setSessionCookie(ctx.resHeaders, sessionId);
  }
  return sessionId;
}

// Session ID extraction uses the canonical getSessionIdFromRequest from context.ts
// which correctly skips API keys (fintranzact_key_ prefix).
function getSessionIdFromContext(ctx: { req: Request }): string | null {
  return getSessionIdFromRequest(ctx.req);
}

// ── Two-phase tenant provisioning for new users (MULTI_TENANT mode) ──
//
// CREATE DATABASE is non-transactional in Postgres, so we cannot provision a
// tenant database from inside a control-DB transaction and trust it to roll
// back. Instead we split the flow into two phases:
//
//   Phase 1 (outside any tx): provisionNewTenantForUser()
//     Creates the physical DB + role + schema. Returns a dbConfig + slug.
//     If it throws, provisionTenantDatabase's own catch already cleaned up.
//
//   Phase 2 (inside the caller's tx): writeNewTenantRows()
//     Inserts the tenants row (populated with dbConfig) + owner membership.
//
// If anything in the surrounding tx fails AFTER Phase 1 returned successfully
// (Phase 2 row inserts, user insert, session insert, enforceSessionLimit,
// COMMIT), the caller is responsible for calling
// cleanupTenantDatabase(dbConfig.dbName, dbConfig.dbUser) as compensation.
// Otherwise the physical DB + role orphan in the cluster forever.
//
// Callers must use the withProvisionedTenantCleanup() wrapper below, which
// encapsulates the compensation contract so it can't be forgotten.

interface ProvisionedTenant {
  tenantName: string;
  slug: string;
  dbConfig: TenantDbConfig;
}

async function provisionNewTenantForUser(displayName: string): Promise<ProvisionedTenant> {
  const tenantName = `${displayName}'s Organization`;
  const slug = generateSlug(tenantName);
  // provisionTenantDatabase currently uses tenantId only for log labels; the
  // real id is generated by the DB when we later insert the tenants row.
  const dbConfig = await provisionTenantDatabase(nanoid(), slug);
  return { tenantName, slug, dbConfig };
}

async function writeNewTenantRows(
  tx: ControlTx,
  userId: string,
  provisioned: ProvisionedTenant,
  referralCode: string | null = null,
): Promise<string> {
  const [tenant] = await tx.insert(tenants).values({
    name: provisioned.tenantName,
    slug: provisioned.slug,
    dbName: provisioned.dbConfig.dbName,
    dbHost: provisioned.dbConfig.dbHost,
    dbPort: provisioned.dbConfig.dbPort,
    dbUser: provisioned.dbConfig.dbUser,
    dbPassword: provisioned.dbConfig.dbPassword,
    plan: "forever_free",
    planSelectedAt: null,
    referralCode: normalizeReferralCode(referralCode),
    // A partner's code links the organisation to that partner (referrals,
    // badge and commission). Any other code is kept as typed.
    partnerId: await partnerForReferralCode(tx, referralCode),
  }).returning({ id: tenants.id });
  await tx.insert(tenantMembers).values({
    tenantId: tenant.id,
    userId,
    role: "owner",
    acceptedAt: new Date(),
  });
  return tenant.id;
}

/**
 * Runs `work` and guarantees that if a tenant was provisioned but not
 * ultimately used (either because `work` throws, or because `work` explicitly
 * marks the provisioned tenant unused via the `markUnused` callback), the
 * physical DB + role are cleaned up. This keeps the compensation contract in
 * one place so every sign-up path can't accidentally skip it.
 */
async function withProvisionedTenantCleanup<T>(
  provisioned: ProvisionedTenant | null,
  work: (markUsed: () => void) => Promise<T>,
): Promise<T> {
  let used = false;
  const markUsed = () => {
    used = true;
  };
  try {
    const result = await work(markUsed);
    if (provisioned && !used) {
      await cleanupTenantDatabase(
        provisioned.dbConfig.dbName,
        provisioned.dbConfig.dbUser,
      );
    }
    return result;
  } catch (err) {
    if (provisioned) {
      await cleanupTenantDatabase(
        provisioned.dbConfig.dbName,
        provisioned.dbConfig.dbUser,
      );
    }
    throw err;
  }
}

export const authRouter = router({
  // ── Password registration (keeps working for self-hosted) ────
  register: publicProcedure.input(registerSchema).mutation(async ({ input, ctx }) => {
    // Require Turnstile when secret key is configured (production).
    // Self-hosted / dev without the key can skip verification.
    // Desktop (Tauri) clients also skip — see isDesktopClient() doc comment.
    const registerAuthMethod: "cookie" | "bearer" = isBearerClient(ctx.req) ? "bearer" : "cookie";
    const desktop = isDesktopClient(ctx.req);
    if (process.env.TURNSTILE_SECRET_KEY && !input.turnstileToken && !desktop) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Turnstile verification required" });
    }
    if (input.turnstileToken) {
      const ip = getClientIpFromRequest(ctx.req);
      const valid = await verifyTurnstile(input.turnstileToken, ip);
      if (!valid) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Verification failed. Please refresh and try again." });
      }
    }

    // Emails are stored lowercase; older rows may not be, so match case-insensitively.
    const email = input.email.trim().toLowerCase();
    const existing = await controlDb.select({ id: users.id }).from(users).where(emailMatches(email)).limit(1);
    if (existing.length > 0) {
      throw new TRPCError({ code: "CONFLICT", message: "Email already registered" });
    }

    const username = (input.username ?? input.name ?? input.email.split("@")[0]).trim();
    const displayName = username || input.email.split("@")[0];

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    // ── Pre-tx peek: decide whether we need to provision a tenant DB ──
    // For brand-new registrations, we provision the physical DB OUTSIDE the
    // control-DB transaction (CREATE DATABASE is non-transactional). The
    // invitation peek is a dirty read — confirmed inside the tx below. If the
    // peek is wrong (invitation accepted mid-flight), withProvisionedTenantCleanup
    // drops the unused DB on its way out.
    const emailLower = email;
    const [pendingInvitePeek] = await controlDb.select({ id: invitations.id })
      .from(invitations)
      .where(and(
        eq(invitations.email, emailLower),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ))
      .limit(1);
    // By default, create a tenant for brand-new signups unless there's a
    // pending invite for this email. This makes interactive sign-up
    // tenant-first instead of creating a member on an existing org.
    // Only multi-tenant servers get a database per organisation; a
    // single-database server creates the tenant inside the transaction below
    // and must not need CREATE DATABASE rights (managed Postgres usually
    // refuses them).
    const needsAutoTenant = !pendingInvitePeek && process.env.MULTI_TENANT === "true";
    const provisioned: ProvisionedTenant | null = needsAutoTenant
      ? await provisionNewTenantForUser(displayName)
      : null;

    // Insert user, assign tenant, and create session in one outer transaction.
    // On any failure (including COMMIT failure), withProvisionedTenantCleanup
    // drops the orphan physical tenant DB.
    const { user, sessionToken } = await withProvisionedTenantCleanup(
      provisioned,
      async (markUsed) =>
        controlDb.transaction(async (tx) => {
          const [user] = await tx.insert(users).values({
            email,
            name: displayName,
            referralCode: input.referralCode?.trim() || null,
            passwordHash,
          }).returning({ id: users.id, email: users.email, name: users.name });

          // Re-check invitation inside the tx (actual state, not the peek)
          const [pendingInvite] = await tx.select({ id: invitations.id })
            .from(invitations)
            .where(and(
              eq(invitations.email, emailLower),
              isNull(invitations.acceptedAt),
              gt(invitations.expiresAt, new Date()),
            ))
            .limit(1);

          if (pendingInvite) {
            // Invitation exists — do NOT auto-create a tenant. If we
            // pre-provisioned one based on the peek, it will be cleaned up
            // because we never call markUsed().
          } else if (process.env.MULTI_TENANT === "true") {
            if (!provisioned) {
              // Peek said invitation pending but tx says no — this is a rare
              // race where the invitation expired between peek and tx. Rather
              // than provision inside the tx (impossible) and risk a deeper
              // orphan, throw a retryable conflict.
              throw new TRPCError({
                code: "CONFLICT",
                message: "Sign-up state changed — please try again.",
              });
            }
            await writeNewTenantRows(tx, user.id, provisioned, input.referralCode?.trim() || null);
            markUsed();
          } else {
            await createTenantForUser(user.id, displayName, tx, input.referralCode?.trim() || null);
          }

          const sessionId = nanoid(64);
          const memberships = await tx
            .select({ tenantId: tenantMembers.tenantId })
            .from(tenantMembers)
            .where(eq(tenantMembers.userId, user.id));
          const resolvedTenantId = memberships.length === 1 ? memberships[0].tenantId : null;

          await enforceSessionLimit(user.id, tx);

          const regNow = Date.now();
          const regExpiresAt = new Date(regNow + (registerAuthMethod === "bearer" ? BEARER_SESSION_DURATION_MS : SESSION_DURATION_MS));
          const regMaxExpiresAt = registerAuthMethod === "bearer" ? new Date(regNow + BEARER_MAX_SESSION_DURATION_MS) : null;

          await tx.insert(sessions).values({
            id: sessionId,
            userId: user.id,
            tenantId: resolvedTenantId,
            expiresAt: regExpiresAt,
            maxExpiresAt: regMaxExpiresAt,
            authMethod: registerAuthMethod,
            ipAddress: getClientIpFromRequest(ctx.req),
            userAgent: ctx.req.headers.get("user-agent") || null,
          });

          return { user, sessionToken: sessionId };
        }),
    );

    // Set-Cookie only after the tx has committed. If COMMIT fails, the error
    // bubbles out of withProvisionedTenantCleanup without ever reaching here,
    // so the client never gets a cookie for a rolled-back session.
    if (registerAuthMethod === "cookie") {
      setSessionCookie(ctx.resHeaders, sessionToken);
    }

    return { user: { id: user.id, email: user.email, name: user.name }, sessionToken };
  }),

  // ── Password login ───────────────────────────────────────────
  login: publicProcedure
    .input(loginSchema.extend({
      /** Mobile / desktop / CLI hand a remembered-device token back here; the web uses the ftz_td cookie. */
      trustedDeviceToken: z.string().max(200).optional(),
      /** Only decides where a trusted-device token is delivered. Never changes session semantics. */
      client: clientInput.optional(),
    }))
    .mutation(async ({ input, ctx }) => {
    // Per-email rate limiting: block after too many failed attempts
    const emailKey = input.email.trim().toLowerCase();
    const attempts = failedLoginAttempts.get(emailKey);
    if (attempts && attempts.count >= LOGIN_MAX_ATTEMPTS && Date.now() - attempts.firstAttempt < LOGIN_WINDOW_MS) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many failed login attempts. Please try again later." });
    }

    const [user] = await controlDb
      .select({ id: users.id, email: users.email, name: users.name, passwordHash: users.passwordHash, twoFactorEnabled: users.twoFactorEnabled })
      .from(users)
      .where(emailMatches(emailKey))
      .limit(1);

    if (!user) {
      const prev = failedLoginAttempts.get(emailKey);
      if (prev && Date.now() - prev.firstAttempt < LOGIN_WINDOW_MS) { prev.count++; }
      else { failedLoginAttempts.set(emailKey, { count: 1, firstAttempt: Date.now() }); }
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    }

    if (!user.passwordHash) {
      const prev = failedLoginAttempts.get(emailKey);
      if (prev && Date.now() - prev.firstAttempt < LOGIN_WINDOW_MS) { prev.count++; }
      else { failedLoginAttempts.set(emailKey, { count: 1, firstAttempt: Date.now() }); }
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    }

    const valid = await argon2.verify(user.passwordHash, input.password);
    if (!valid) {
      const prev = failedLoginAttempts.get(emailKey);
      if (prev && Date.now() - prev.firstAttempt < LOGIN_WINDOW_MS) { prev.count++; }
      else { failedLoginAttempts.set(emailKey, { count: 1, firstAttempt: Date.now() }); }
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
    }

    // Successful login — clear failed attempts
    failedLoginAttempts.delete(emailKey);

    const memberships = await controlDb
      .select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, user.id));

    // Platform admins (set by the server environment) may have no organisation
    // of their own; they sign in to use /platform.
    if (memberships.length === 0 && !(await isPlatformAdmin(user.id))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Account has no organization membership" });
    }

    // Two-factor is only mentioned AFTER the password has been verified (above).
    const client = clientKindFor(ctx.req, input.client);
    const decision = await decideSignIn(twoFactorLoginDeps, {
      userId: user.id,
      twoFactorEnabled: user.twoFactorEnabled,
      trustedDeviceToken: presentedTrustedDeviceToken(client, ctx.req.headers.get("cookie"), input.trustedDeviceToken),
      client,
      event: eventContext(ctx),
    });
    if (decision.kind === "challenge") {
      // No session and no Set-Cookie until the second factor is verified.
      return {
        twoFactorRequired: true as const,
        challengeToken: decision.challengeToken,
        expiresAt: decision.expiresAt,
        methods: [...decision.methods],
      };
    }

    const sessionToken = await createSessionForUser(user.id, ctx, isBearerClient(ctx.req) ? "bearer" : "cookie");

    return { twoFactorRequired: false as const, user: { id: user.id, email: user.email, name: user.name }, sessionToken };
  }),

  // ── Second step of sign-in ───────────────────────────────────
  // Public: there is no session yet. Errors are BAD_REQUEST / TOO_MANY_REQUESTS,
  // never UNAUTHORIZED (the web client redirects to /login on that).
  verifyTwoFactor: publicProcedure
    .input(z.object({
      challengeToken: z.string().min(1).max(200),
      code: z.string().min(1).max(64),
      rememberDevice: z.boolean().optional(),
      client: clientInput.optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const client = clientKindFor(ctx.req, input.client);
      const event = eventContext(ctx);
      const { userId } = await verifySignInChallenge(twoFactorLoginDeps, {
        challengeToken: input.challengeToken,
        code: input.code,
        ipKey: `2fa-ip:${ctx.ipAddress ?? getClientIpFromRequest(ctx.req) ?? "unknown"}`,
        event,
      });

      const [user] = await controlDb
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) throw new TRPCError({ code: "BAD_REQUEST", message: "This sign-in has expired. Enter your password again." });

      // Same session path as login: bearer/cookie decision, plan-limit eviction,
      // previous-session cleanup and the session cookie.
      const sessionToken = await createSessionForUser(user.id, ctx, isBearerClient(ctx.req) ? "bearer" : "cookie");

      let trustedDeviceToken: string | undefined;
      if (input.rememberDevice && canRememberDevice(client)) {
        const device = await issueTrustedDevice(twoFactorLoginDeps, { userId: user.id, client, event });
        const delivery = planTrustedDeviceDelivery(client, device.token, IS_SECURE);
        // APPEND: the session cookie was written with .set and must survive.
        appendSetCookies(ctx.resHeaders, delivery.setCookies);
        trustedDeviceToken = delivery.bodyToken;
      }

      return {
        user: { id: user.id, email: user.email, name: user.name },
        sessionToken,
        ...(trustedDeviceToken ? { trustedDeviceToken } : {}),
      };
    }),

  // ── Trusted devices ──────────────────────────────────────────
  // A trusted device only skips the sign-in challenge. Disabling 2FA and
  // regenerating backup codes never look at it: they need password + fresh code.
  listTrustedDevices: protectedProcedure
    .input(z.object({ trustedDeviceToken: z.string().max(200).optional() }).default({}))
    .query(async ({ input, ctx }) => {
      requireSession(ctx);
      const token = readTrustedDeviceCookie(ctx.req.headers.get("cookie")) ?? input.trustedDeviceToken ?? null;
      return listTrustedDevices(twoFactorLoginDeps, ctx.user.id, token);
    }),

  revokeTrustedDevice: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireSession(ctx);
      return revokeTrustedDevice(twoFactorLoginDeps, ctx.user.id, input.id, eventContext(ctx));
    }),

  revokeAllTrustedDevices: protectedProcedure.mutation(async ({ ctx }) => {
    requireSession(ctx);
    const r = await revokeAllTrustedDevices(twoFactorLoginDeps, ctx.user.id, eventContext(ctx));
    appendSetCookies(ctx.resHeaders, [trustedDeviceClearCookie(IS_SECURE)]);
    return r;
  }),

  // ── Complete profile ─────────────────────────────────────────
  completeProfile: protectedProcedure.input(completeProfileSchema).mutation(async ({ input, ctx }) => {
    await controlDb.update(users)
      .set({ name: input.name, updatedAt: new Date() })
      .where(eq(users.id, ctx.user!.id));

    // Invalidate ALL session cache entries for this user so `me` returns fresh data
    // (the cache stores by sessionId, so we need to find and clear the right entry)
    const sessionId = getSessionIdFromContext(ctx);
    if (sessionId) invalidateSessionCache(sessionId);

    return { success: true };
  }),

  // ── Update name ──────────────────────────────────────────────
  updateName: protectedProcedure
    .input(z.object({ name: z.string().min(2).max(100) }))
    .mutation(async ({ input, ctx }) => {
      await controlDb.update(users)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(users.id, ctx.user!.id));

      // Invalidate session cache so `me` returns fresh data
      const sessionId = getSessionIdFromContext(ctx);
      if (sessionId) invalidateSessionCache(sessionId);

      return { success: true };
    }),

  // ── Request email change ─────────────────────────────────────
  requestEmailChange: protectedProcedure
    .input(z.object({ newEmail: z.string().email().max(255) }))
    .mutation(async ({ input, ctx }) => {
      const email = input.newEmail.toLowerCase();

      // Check if new email is already taken
      const [existing] = await controlDb.select({ id: users.id })
        .from(users).where(eq(users.email, email)).limit(1);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
      }

      // Generate a token for email change verification
      const rawToken = crypto.randomUUID() + "-" + nanoid(32);
      const tokenHash = hashToken(rawToken);

      await controlDb.insert(emailChangeTokens).values({
        email: email, // Store the NEW email
        tokenHash,
        // Store the requesting user's ID so confirmEmailChange doesn't trust client-supplied userId
        userId: ctx.user!.id,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        ipAddress: getClientIpFromRequest(ctx.req),
      });

      // Send verification to new email — no userId in URL; it is bound to the token server-side
      const baseUrl = process.env.APP_URL || "http://localhost:5173";
      const verifyUrl = `${baseUrl}/auth/verify-email-change?token=${encodeURIComponent(rawToken)}`;

      await emailService.sendEmailChangeLink(email, verifyUrl);

      return { success: true };
    }),

  // ── Confirm email change ─────────────────────────────────────
  // userId is intentionally NOT accepted from client input — it is read from the
  // server-side token record to prevent account takeover via token substitution.
  confirmEmailChange: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      const tokenH = hashToken(input.token);

      // Atomic: find + mark-used
      const [tokenRow] = await controlDb.update(emailChangeTokens)
        .set({ usedAt: new Date() })
        .where(and(
          eq(emailChangeTokens.tokenHash, tokenH),
          gt(emailChangeTokens.expiresAt, new Date()),
          isNull(emailChangeTokens.usedAt),
        ))
        .returning();

      if (!tokenRow) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired link" });
      }

      // Require that this token was issued for an email-change request (has a bound userId)
      if (!tokenRow.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired link" });
      }

      // The address may have been taken since the request was made.
      const [taken] = await controlDb.select({ id: users.id })
        .from(users).where(eq(users.email, tokenRow.email)).limit(1);
      if (taken && taken.id !== tokenRow.userId) {
        throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
      }

      // Update the user's email using the userId stored in the token — never from client input
      await controlDb.update(users)
        .set({ email: tokenRow.email, emailVerified: true, updatedAt: new Date() })
        .where(eq(users.id, tokenRow.userId));

      return { success: true, newEmail: tokenRow.email };
    }),

  // ── Logout ───────────────────────────────────────────────────
  logout: protectedProcedure.mutation(async ({ ctx }) => {
    const sessionId = getSessionIdFromContext(ctx);

    if (sessionId) {
      await controlDb.delete(sessions).where(eq(sessions.id, sessionId));
      invalidateSessionCache(sessionId);
    }

    clearSessionCookie(ctx.resHeaders);
    return { success: true };
  }),

  // ── Logout all sessions ──────────────────────────────────────
  logoutAll: protectedProcedure.mutation(async ({ ctx }) => {
    // Fetch all session IDs before deleting so we can evict them from the in-memory cache
    const userSessions = await controlDb
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, ctx.user!.id));

    await controlDb.delete(sessions).where(eq(sessions.userId, ctx.user!.id));

    revokeAllUserSessions(ctx.user!.id);
    for (const s of userSessions) {
      invalidateSessionCache(s.id);
    }

    // Signing out everywhere also forgets every trusted device.
    await revokeAllTrustedDevices(twoFactorLoginDeps, ctx.user!.id, eventContext(ctx), "logout_all");

    clearSessionCookie(ctx.resHeaders);
    appendSetCookies(ctx.resHeaders, [trustedDeviceClearCookie(IS_SECURE)]);
    return { success: true };
  }),

  // ── List sessions (active or expired) ───────────────────────
  listSessions: protectedProcedure
    .input(z.object({ expired: z.boolean().default(false) }).default({}))
    .query(async ({ input, ctx }) => {
      const currentSessionId = getSessionIdFromContext(ctx);
      const now = new Date();
      const userSessions = await controlDb
        .select({
          id: sessions.id,
          ipAddress: sessions.ipAddress,
          userAgent: sessions.userAgent,
          createdAt: sessions.createdAt,
          lastUsedAt: sessions.lastUsedAt,
          expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .where(and(
          eq(sessions.userId, ctx.user!.id),
          input.expired ? lte(sessions.expiresAt, now) : gt(sessions.expiresAt, now),
        ))
        .orderBy(desc(sessions.createdAt));

      return userSessions.map((s) => ({
        ...s,
        isCurrent: !input.expired && s.id === currentSessionId,
      }));
    }),

  // ── Revoke a specific session ───────────────────────────────
  revokeSession: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const currentSessionId = getSessionIdFromContext(ctx);
      if (input.sessionId === currentSessionId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot revoke your current session. Use logout instead." });
      }

      const deleted = await controlDb
        .delete(sessions)
        .where(and(
          eq(sessions.id, input.sessionId),
          eq(sessions.userId, ctx.user!.id),
        ))
        .returning({ id: sessions.id });

      if (deleted.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }

      invalidateSessionCache(input.sessionId);
      return { success: true };
    }),

  // ── Issue short-lived access token ──────────────────────────
  //
  // Only callable with a refresh token (session_id Bearer) or a cookie
  // session. Calling with an access token (chained refresh) is rejected —
  // access tokens cannot mint other access tokens; this closes the chain.
  //
  // Cookie-method sessions (web) are also rejected: the web app uses
  // HttpOnly cookies and never needs access tokens. Issuing one would
  // create a JS-readable token from a cookie session, undermining the
  // XSS protection of the cookie-only flow.
  issueAccessToken: protectedProcedure.mutation(async ({ ctx }) => {
    // Reject if called via an access token (chained refresh = bad)
    if (ctx.authTokenKind === "access") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot issue an access token using another access token. Use the refresh token (session_id) instead.",
      });
    }

    // Reject cookie-method sessions — web uses cookies, not Bearer.
    // Issuing an access token here would create a JS-readable credential
    // from an HttpOnly-cookie session, defeating its XSS protection.
    if (ctx.authTokenKind === "cookie") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Access tokens are only issued for Bearer sessions (mobile/desktop). Web clients use HttpOnly cookies.",
      });
    }

    // Retrieve the session row to verify it is a bearer-method session
    // and to obtain the session ID.
    const sessionId = getSessionIdFromContext(ctx);
    if (!sessionId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "No session found" });
    }

    const [session] = await controlDb
      .select({ id: sessions.id, authMethod: sessions.authMethod })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Session not found" });
    }

    if (session.authMethod !== "bearer") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Access tokens are only issued for Bearer sessions.",
      });
    }

    // Generate a 64-char base64url random suffix for unguessability.
    // 48 random bytes → 64 base64url chars = 384 bits of entropy.
    const randomSuffix = randomBytes(48).toString("base64url");
    const accessTokenId = `at_${randomSuffix}`;
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);

    await controlDb.insert(accessTokens).values({
      id: accessTokenId,
      sessionId: session.id,
      expiresAt,
    });

    return { accessToken: accessTokenId, expiresAt };
  }),

  // ── Two-factor authentication (enrolment) ────────────────────
  // Session-only (never API keys). See docs/TWO-FACTOR.md.
  twoFactorStatus: protectedProcedure.query(async ({ ctx }) => {
    requireSession(ctx);
    return getTwoFactorStatus(twoFactorDeps, ctx.user.id);
  }),

  twoFactorBeginSetup: protectedProcedure.mutation(async ({ ctx }) => {
    requireSession(ctx);
    if (!setupLimiter.hit(ctx.user.id)) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many setup attempts. Please try again in an hour." });
    }
    return beginTwoFactorSetup(twoFactorDeps, ctx.user, eventContext(ctx));
  }),

  twoFactorConfirmSetup: protectedProcedure
    .input(z.object({ code: z.string().min(1).max(32) }))
    .mutation(async ({ input, ctx }) => {
      requireSession(ctx);
      return confirmTwoFactorSetup(twoFactorDeps, ctx.user.id, input.code, {
        currentSessionId: await currentSessionId(ctx),
        event: eventContext(ctx),
      });
    }),

  twoFactorDisable: protectedProcedure.input(twoFactorCodeInput).mutation(async ({ input, ctx }) => {
    requireSession(ctx);
    return disableTwoFactor(twoFactorDeps, ctx.user.id, input, {
      currentSessionId: await currentSessionId(ctx),
      event: eventContext(ctx),
    });
  }),

  regenerateBackupCodes: protectedProcedure.input(twoFactorCodeInput).mutation(async ({ input, ctx }) => {
    requireSession(ctx);
    return regenerateBackupCodes(twoFactorDeps, ctx.user.id, input, { event: eventContext(ctx) });
  }),

  // ── Me ───────────────────────────────────────────────────────
  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return { user: null, tenantId: null, tenantName: null, role: null, needsProfile: false, twoFactor: { enabled: false } };

    const [flag] = await controlDb
      .select({ enabled: users.twoFactorEnabled })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    let tenantName: string | null = null;
    let role: string | null = null;
    if (ctx.tenantId) {
      const [t] = await controlDb
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);
      tenantName = t?.name ?? null;

      const [membership] = await controlDb
        .select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.userId, ctx.user.id),
        ))
        .limit(1);
      role = membership?.role ?? null;
    }

    return { user: ctx.user, tenantId: ctx.tenantId, tenantName, role, needsProfile: !ctx.user.name, twoFactor: { enabled: flag?.enabled ?? false } };
  }),
});

function setSessionCookie(headers: Headers, sessionId: string) {
  const secure = IS_SECURE ? "; Secure" : "";
  headers.set(
    "Set-Cookie",
    `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${30 * 24 * 60 * 60}`
  );
}

function clearSessionCookie(headers: Headers) {
  const secure = IS_SECURE ? "; Secure" : "";
  headers.set("Set-Cookie", `session_id=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`);
}
