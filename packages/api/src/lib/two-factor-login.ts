/**
 * two-factor-login.ts — the sign-in challenge, trusted devices and the cookie
 * rules around them.
 *
 * Flow: auth.login checks the password, then calls `decideSignIn`. A user with
 * two-factor on and no valid trusted-device token gets a short-lived challenge
 * (no session, no cookie). auth.verifyTwoFactor calls `verifySignInChallenge`
 * (limiters, single-use challenge, `verifySecondFactor`, attempt cap) and the
 * router then mints the session through the same helper login uses.
 *
 * Persistence goes through the injected TwoFactorLoginStore; the shared
 * second-factor verifier, events and lockout come from TwoFactorDeps.
 *
 * Error codes: BAD_REQUEST / TOO_MANY_REQUESTS / FORBIDDEN. Never
 * UNAUTHORIZED: the web client redirects to /login on it.
 */

import { TRPCError } from "@trpc/server";
import { CHALLENGE_TTL_MS, MAX_CHALLENGE_ATTEMPTS, TRUSTED_DEVICE_DAYS } from "@fintranzact/shared";
import { hashOpaqueToken, newOpaqueToken } from "./two-factor-codes.js";
import { throwForFailure, verifySecondFactor, type EventContext, type TwoFactorDeps } from "./two-factor.js";

export const TRUSTED_DEVICE_COOKIE = "ftz_td";
export const TRUSTED_DEVICE_MAX_AGE_S = TRUSTED_DEVICE_DAYS * 24 * 60 * 60;
export const CHALLENGE_METHODS = ["totp", "backup_code"] as const;

export const CHALLENGE_EXPIRED_MESSAGE = "This sign-in has expired. Enter your password again.";

export type ClientKind = "web" | "mobile" | "desktop" | "cli";

// ── Data layer ──────────────────────────────────────────────────────────────

export interface ChallengeRow {
  id: string;
  userId: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  clientKind: string | null;
}

export interface TrustedDeviceRow {
  id: string;
  userId: string;
  label: string | null;
  ip: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface TwoFactorLoginStore {
  createChallenge(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    clientKind: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<void>;
  /** Housekeeping: delete challenges that expired before `now`. */
  deleteExpiredChallenges(now: Date): Promise<void>;
  getChallengeByHash(tokenHash: string): Promise<ChallengeRow | null>;
  /** Atomic single use: true only for the one caller that flips consumed_at (still unconsumed and unexpired). */
  consumeChallenge(id: string, now: Date): Promise<boolean>;
  /** Atomic: attempts++, and when it reaches `max` the challenge is consumed too. Returns the new state. */
  recordChallengeFailure(id: string, max: number, now: Date): Promise<{ attempts: number; killed: boolean }>;
  /** A device that is bound to this user, not revoked and not expired. */
  findTrustedDevice(userId: string, tokenHash: string, now: Date): Promise<TrustedDeviceRow | null>;
  touchTrustedDevice(id: string, now: Date): Promise<void>;
  createTrustedDevice(input: {
    userId: string;
    tokenHash: string;
    label: string;
    ip: string | null;
    userAgent: string | null;
    expiresAt: Date;
  }): Promise<{ id: string }>;
  /** Active (not revoked, not expired) devices, newest first. Includes tokenHash for the "current" mark. */
  listTrustedDevices(userId: string, now: Date): Promise<Array<TrustedDeviceRow & { tokenHash: string }>>;
  /** Only the owner's own device; true when a row was revoked. */
  revokeTrustedDevice(userId: string, id: string, now: Date): Promise<boolean>;
  /** Returns the number of devices revoked. */
  revokeAllTrustedDevices(userId: string, now: Date): Promise<number>;
}

export interface FixedWindowHit {
  hit(key: string): boolean;
}

export interface TwoFactorLoginDeps {
  base: TwoFactorDeps;
  store: TwoFactorLoginStore;
  ipLimiter: FixedWindowHit;
  challengeLimiter: FixedWindowHit;
  newToken(): string;
}

// ── Client and device helpers ───────────────────────────────────────────────

const KNOWN_CLIENTS: readonly string[] = ["web", "mobile", "desktop", "cli"];

/**
 * Which kind of client is signing in. The X-Fintranzact-Client header wins,
 * then the `client` input, then "web". It ONLY decides where a trusted-device
 * token is delivered (cookie vs body) and whether remembering is allowed. It
 * never changes session semantics.
 */
export function resolveClientKind(headerKind: string | null | undefined, inputClient: string | null | undefined): ClientKind {
  if (headerKind && KNOWN_CLIENTS.includes(headerKind)) return headerKind as ClientKind;
  if (inputClient && KNOWN_CLIENTS.includes(inputClient)) return inputClient as ClientKind;
  return "web";
}

/** CLI sessions are never remembered. */
export function canRememberDevice(client: ClientKind): boolean {
  return client !== "cli";
}

/** Short device name for the trusted-devices list, from the user agent. */
export function deviceLabel(userAgent: string | null | undefined, client: ClientKind = "web"): string {
  if (client === "desktop") return "Fintranzact desktop app";
  if (client === "mobile") return "Fintranzact mobile app";
  const ua = userAgent ?? "";
  if (!ua) return "Unknown device";
  let browser = "Browser";
  const edge = ua.match(/Edg\/(\d+)/);
  const opera = ua.match(/OPR\/(\d+)/);
  const chrome = ua.match(/Chrome\/(\d+)/);
  const safari = ua.match(/Version\/(\d+)/);
  const firefox = ua.match(/Firefox\/(\d+)/);
  if (edge) browser = `Edge ${edge[1]}`;
  else if (opera) browser = `Opera ${opera[1]}`;
  else if (chrome) browser = `Chrome ${chrome[1]}`;
  else if (ua.includes("Safari/") && safari) browser = `Safari ${safari[1]}`;
  else if (firefox) browser = `Firefox ${firefox[1]}`;
  let os = "";
  if (ua.includes("Windows NT")) os = "Windows";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  else if (ua.includes("Mac OS X")) os = "macOS";
  else if (ua.includes("CrOS")) os = "ChromeOS";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("Linux")) os = "Linux";
  return os ? `${browser} on ${os}` : browser;
}

// ── Cookie helpers (pure) ───────────────────────────────────────────────────

/** The `ftz_td` Set-Cookie value. HttpOnly, SameSite=Lax, 30 days, Secure on https. */
export function trustedDeviceSetCookie(token: string, secure: boolean): string {
  return `${TRUSTED_DEVICE_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=${TRUSTED_DEVICE_MAX_AGE_S}`;
}

export function trustedDeviceClearCookie(secure: boolean): string {
  return `${TRUSTED_DEVICE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=0`;
}

/**
 * Add Set-Cookie values WITHOUT replacing the ones already on the response
 * (the session cookie is written with `.set`, so `.set` here would clobber it).
 */
export function appendSetCookies(headers: Headers, cookies: readonly string[]): void {
  for (const c of cookies) headers.append("Set-Cookie", c);
}

/** Read the trusted-device token from a Cookie header. */
export function readTrustedDeviceCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${TRUSTED_DEVICE_COOKIE}=([^;]*)`));
  return m && m[1] ? m[1] : null;
}

export interface DeviceDelivery {
  /** Set-Cookie values to append (web). */
  setCookies: string[];
  /** Token to return in the response body (desktop / mobile). */
  bodyToken?: string;
}

/** Where a freshly issued trusted-device token goes: cookie for web, body for desktop/mobile. */
export function planTrustedDeviceDelivery(client: ClientKind, token: string, secure: boolean): DeviceDelivery {
  if (client === "web") return { setCookies: [trustedDeviceSetCookie(token, secure)] };
  if (client === "desktop" || client === "mobile") return { setCookies: [], bodyToken: token };
  return { setCookies: [] };
}

/** The token to test at login: web uses the cookie, others the input. */
export function presentedTrustedDeviceToken(
  client: ClientKind,
  cookieHeader: string | null | undefined,
  input: string | null | undefined,
): string | null {
  if (client === "web") return readTrustedDeviceCookie(cookieHeader) ?? null;
  if (client === "cli") return null;
  return input || null;
}

// ── Sign-in decision ────────────────────────────────────────────────────────

export type SignInDecision =
  | { kind: "session"; method: "none" | "trusted_device" }
  | { kind: "challenge"; challengeToken: string; expiresAt: Date; methods: typeof CHALLENGE_METHODS };

export interface SignInInput {
  userId: string;
  twoFactorEnabled: boolean;
  /** Trusted-device token presented by the client (cookie or input); already resolved by the caller. */
  trustedDeviceToken: string | null;
  client: ClientKind;
  event: EventContext;
}

/**
 * Called only AFTER the password is verified. A user without 2FA proceeds as
 * before. Otherwise a valid trusted device skips the challenge; anything else
 * creates one.
 */
export async function decideSignIn(deps: TwoFactorLoginDeps, input: SignInInput): Promise<SignInDecision> {
  if (!input.twoFactorEnabled) return { kind: "session", method: "none" };

  const now = new Date(deps.base.now());

  if (input.trustedDeviceToken) {
    const device = await deps.store.findTrustedDevice(input.userId, hashOpaqueToken(input.trustedDeviceToken), now);
    if (device) {
      await deps.store.touchTrustedDevice(device.id, now);
      await deps.base.record({
        userId: input.userId,
        ip: input.event.ip ?? null,
        userAgent: input.event.userAgent ?? null,
        type: "2fa.verified",
        metadata: { method: "trusted_device", purpose: "login", deviceId: device.id },
      });
      return { kind: "session", method: "trusted_device" };
    }
  }

  // Housekeeping; never blocks sign-in.
  deps.store.deleteExpiredChallenges(now).catch(() => {});

  const challengeToken = deps.newToken();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  await deps.store.createChallenge({
    userId: input.userId,
    tokenHash: hashOpaqueToken(challengeToken),
    expiresAt,
    clientKind: input.client,
    ip: input.event.ip ?? null,
    userAgent: input.event.userAgent ?? null,
  });
  return { kind: "challenge", challengeToken, expiresAt, methods: CHALLENGE_METHODS };
}

// ── Challenge verification ──────────────────────────────────────────────────

function expiredError(): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message: CHALLENGE_EXPIRED_MESSAGE });
}

export interface VerifiedChallenge {
  userId: string;
  method: "totp" | "backup_code";
}

/**
 * Check a code against a sign-in challenge. On success the challenge is
 * consumed (single use) and the caller creates the session. On failure the
 * challenge's attempt counter goes up and the fifth wrong code kills it.
 */
export async function verifySignInChallenge(
  deps: TwoFactorLoginDeps,
  input: { challengeToken: string; code: string; ipKey: string; event: EventContext },
): Promise<VerifiedChallenge> {
  const { store } = deps;
  const now = new Date(deps.base.now());

  // First line of defence, before any database work.
  if (!deps.ipLimiter.hit(input.ipKey)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many attempts. Please wait a few minutes and try again." });
  }

  const tokenHash = hashOpaqueToken(input.challengeToken);
  const challenge = await store.getChallengeByHash(tokenHash);
  if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= now.getTime()) throw expiredError();

  if (!deps.challengeLimiter.hit(tokenHash)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many attempts. Please wait a few minutes and try again." });
  }

  const result = await verifySecondFactor(deps.base, challenge.userId, input.code, {
    allowBackup: true,
    purpose: "login",
    event: input.event,
  });

  if (!result.ok || !result.method) {
    const state = await store.recordChallengeFailure(challenge.id, MAX_CHALLENGE_ATTEMPTS, now);
    if (result.reason === "locked") throwForFailure(deps.base, result, "");
    if (state.killed) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Too many wrong codes. Enter your password again to start over.",
      });
    }
    throwForFailure(deps.base, result, "That code is not right. Check your authenticator app (or use a backup code) and try again.");
  }

  // Single use: only one caller flips consumed_at.
  if (!(await store.consumeChallenge(challenge.id, now))) throw expiredError();
  return { userId: challenge.userId, method: result.method };
}

// ── Trusted devices ─────────────────────────────────────────────────────────

export interface IssuedDevice {
  id: string;
  token: string;
  expiresAt: Date;
}

/** Create a trusted device: random token (only its hash is stored), FIXED 30-day expiry (not sliding). */
export async function issueTrustedDevice(
  deps: TwoFactorLoginDeps,
  input: { userId: string; client: ClientKind; event: EventContext },
): Promise<IssuedDevice> {
  const now = new Date(deps.base.now());
  const token = newOpaqueToken();
  const expiresAt = new Date(now.getTime() + TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1000);
  const { id } = await deps.store.createTrustedDevice({
    userId: input.userId,
    tokenHash: hashOpaqueToken(token),
    label: deviceLabel(input.event.userAgent, input.client),
    ip: input.event.ip ?? null,
    userAgent: input.event.userAgent ?? null,
    expiresAt,
  });
  await deps.base.record({
    userId: input.userId,
    ip: input.event.ip ?? null,
    userAgent: input.event.userAgent ?? null,
    type: "2fa.device_trusted",
    metadata: { deviceId: id, expiresAt: expiresAt.toISOString() },
  });
  return { id, token, expiresAt };
}

export interface TrustedDeviceView {
  id: string;
  label: string | null;
  ip: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  current: boolean;
}

export async function listTrustedDevices(
  deps: TwoFactorLoginDeps,
  userId: string,
  currentToken: string | null,
): Promise<TrustedDeviceView[]> {
  const rows = await deps.store.listTrustedDevices(userId, new Date(deps.base.now()));
  const currentHash = currentToken ? hashOpaqueToken(currentToken) : null;
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    ip: r.ip,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    expiresAt: r.expiresAt,
    current: currentHash !== null && r.tokenHash === currentHash,
  }));
}

export async function revokeTrustedDevice(
  deps: TwoFactorLoginDeps,
  userId: string,
  id: string,
  event: EventContext = {},
): Promise<{ success: true }> {
  const ok = await deps.store.revokeTrustedDevice(userId, id, new Date(deps.base.now()));
  if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "Trusted device not found." });
  await deps.base.record({ userId, ip: event.ip, userAgent: event.userAgent, type: "2fa.device_revoked", metadata: { deviceId: id } });
  return { success: true };
}

export async function revokeAllTrustedDevices(
  deps: TwoFactorLoginDeps,
  userId: string,
  event: EventContext = {},
  reason = "user_request",
): Promise<{ revoked: number }> {
  const revoked = await deps.store.revokeAllTrustedDevices(userId, new Date(deps.base.now()));
  if (revoked > 0) {
    await deps.base.record({ userId, ip: event.ip, userAgent: event.userAgent, type: "2fa.device_revoked", metadata: { all: true, count: revoked, reason } });
  }
  return { revoked };
}
