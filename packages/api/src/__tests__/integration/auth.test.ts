/**
 * auth.test.ts — Integration tests for the auth router.
 *
 * These tests exercise the full tRPC middleware chain against a real PostgreSQL
 * test database. They cover:
 *   - auth.register: user creation, session issuance, Argon2id hashing, validation
 *   - auth.login: credential verification, no-enumeration invariant
 *   - auth.me: authenticated and unauthenticated responses
 *   - auth.logout: session invalidation
 *
 * Lifecycle:
 *   beforeAll  — nothing (each describe block sets up its own fixtures)
 *   afterEach  — nothing (rows accumulate within a describe, isolated by unique emails)
 *   afterAll   — truncate all tables so the next suite starts clean
 *
 * The test context bypasses cookies: session tokens are injected directly into
 * the tRPC context. Logout is tested using createTestContext with a cookie
 * header so the session-ID extraction path in auth.ts is exercised.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { users, sessions, tenants, tenantMembers, invitations } from "@fintranzact/db";
import { isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  createUser,
  createTenant,
  addMember,
  createSession,
} from "../helpers/fixtures.js";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestContext } from "../helpers/test-context.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";

// ── Caller factory ────────────────────────────────────────────────────────────

const _callerFactory = createCallerFactory(appRouter);

/**
 * Build a caller for a fully authenticated user who has a tenant session.
 * The session cookie is set on the synthetic request so that auth.logout and
 * auth.me exercise the real session-extraction code path.
 */
function callerWithSession(sessionId: string, userId: string, email: string, tenantId?: string) {
  const headers = new Headers({
    "content-type": "application/json",
    "cookie": `session_id=${sessionId}`,
    // The tRPC-layer CSRF middleware requires this sentinel on any
    // cookie-authenticated POST (see `packages/api/src/trpc.ts`). Real
    // web clients send it unconditionally; integration tests must match.
    "x-requested-with": "fintranzact",
    ...(tenantId ? {} : {}),
  });
  const req = new Request("http://localhost:3000/api/trpc/test", {
    method: "POST",
    headers,
  });
  const resHeaders = new Headers();
  const ctx = {
    user: { id: userId, email, name: null },
    tenantId: tenantId ?? null,
    businessId: null,
    req,
    resHeaders,
    ipAddress: null,
    authTokenKind: "cookie" as const,
  };
  return _callerFactory(ctx);
}

/**
 * Unauthenticated caller — no user, no session cookie.
 */
function unauthCaller() {
  return _callerFactory(createTestContext({}));
}

// ── Teardown ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ─────────────────────────────────────────────────────────────────────────────
// auth.register
// ─────────────────────────────────────────────────────────────────────────────

describe("auth.register", () => {
  const db = getControlDb();

  it("registers a new user with email and password — creates user, session, and default tenant membership", async () => {
    const caller = unauthCaller();

    const result = await caller.auth.register({
      email: "ramesh.new@vyapar.in",
      name: "Ramesh Kumar",
      password: "SecurePass1!",
      confirmPassword: "SecurePass1!",
    });

    // Returned shape is correct
    expect(result.user.email).toBe("ramesh.new@vyapar.in");
    expect(result.user.name).toBe("Ramesh Kumar");
    expect(result.user.id).toBeTruthy();
    expect(typeof result.sessionToken).toBe("string");
    expect(result.sessionToken.length).toBeGreaterThan(30);

    // User row persisted in control DB
    const [dbUser] = await db.select().from(users).where(eq(users.email, "ramesh.new@vyapar.in")).limit(1);
    expect(dbUser).toBeDefined();
    expect(dbUser!.email).toBe("ramesh.new@vyapar.in");

    // Password is NOT stored in plaintext — the hash must start with $argon2id$
    expect(dbUser!.passwordHash).not.toBe("SecurePass1!");
    expect(dbUser!.passwordHash).toMatch(/^\$argon2id\$/);

    // Session row created in control DB
    const [dbSession] = await db.select().from(sessions).where(eq(sessions.userId, dbUser!.id)).limit(1);
    expect(dbSession).toBeDefined();
    // Session expires ~30 days from now: check it's at least 29 days in the future
    const msUntilExpiry = dbSession!.expiresAt.getTime() - Date.now();
    expect(msUntilExpiry).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
  });

  it("registers on a single-database server without creating a database", async () => {
    // Managed Postgres (Railway) refuses CREATE DATABASE; point provisioning at
    // an unreachable server so any attempt to create one fails the sign-up.
    const saved = { multi: process.env.MULTI_TENANT, control: process.env.CONTROL_DATABASE_URL };
    delete process.env.MULTI_TENANT;
    process.env.CONTROL_DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/none";
    try {
      const result = await unauthCaller().auth.register({
        email: "single.db@vyapar.in",
        name: "Single DB",
        password: "SecurePass1!",
        confirmPassword: "SecurePass1!",
      });
      const memberships = await db.select().from(tenantMembers).where(eq(tenantMembers.userId, result.user.id));
      expect(memberships).toHaveLength(1);
      expect(memberships[0]!.role).toBe("owner");
    } finally {
      if (saved.multi === undefined) delete process.env.MULTI_TENANT;
      else process.env.MULTI_TENANT = saved.multi;
      if (saved.control === undefined) delete process.env.CONTROL_DATABASE_URL;
      else process.env.CONTROL_DATABASE_URL = saved.control;
    }
  });

  it("creates a fresh tenant for each self-hosted registration and makes the user the owner", async () => {
    const caller = unauthCaller();

    const first = await caller.auth.register({
      email: "owner-first@vyapar.in",
      name: "First Owner",
      password: "SecurePass1!",
      confirmPassword: "SecurePass1!",
    });

    const second = await caller.auth.register({
      email: "owner-second@vyapar.in",
      name: "Second Owner",
      password: "SecurePass1!",
      confirmPassword: "SecurePass1!",
    });

    const firstMemberships = await db.select().from(tenantMembers).where(eq(tenantMembers.userId, first.user.id));
    const secondMemberships = await db.select().from(tenantMembers).where(eq(tenantMembers.userId, second.user.id));

    expect(firstMemberships).toHaveLength(1);
    expect(firstMemberships[0]!.role).toBe("owner");
    expect(secondMemberships).toHaveLength(1);
    expect(secondMemberships[0]!.role).toBe("owner");
    expect(firstMemberships[0]!.tenantId).not.toBe(secondMemberships[0]!.tenantId);
  });

  it("rejects duplicate email registration — returns CONFLICT without creating a second user", async () => {
    const caller = unauthCaller();

    // First registration
    await caller.auth.register({
      email: "duplicate@vyapar.in",
      name: "First User",
      password: "SecurePass1!",
      confirmPassword: "SecurePass1!",
    });

    // Second registration with same email
    await expect(
      caller.auth.register({
        email: "duplicate@vyapar.in",
        name: "Second User",
        password: "SecurePass1!",
        confirmPassword: "SecurePass1!",
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Email already registered",
    });

    // Still only one user with this email
    const rows = await db.select().from(users).where(eq(users.email, "duplicate@vyapar.in"));
    expect(rows).toHaveLength(1);
  });

  it("rejects mismatched confirmPassword — Zod validation error on confirmPassword field", async () => {
    const caller = unauthCaller();

    await expect(
      caller.auth.register({
        email: "mismatch@vyapar.in",
        name: "Someone",
        password: "SecurePass1!",
        confirmPassword: "DifferentPass1!",
      })
    ).rejects.toSatisfy((err: unknown) => {
      // tRPC wraps Zod errors as BAD_REQUEST
      return err instanceof TRPCError && err.code === "BAD_REQUEST";
    });
  });

  it("rejects password shorter than 8 characters — Zod min(8) validation on password field", async () => {
    const caller = unauthCaller();

    await expect(
      caller.auth.register({
        email: "shortpw@vyapar.in",
        name: "Someone",
        password: "abc",
        confirmPassword: "abc",
      })
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof TRPCError && err.code === "BAD_REQUEST";
    });
  });

  it("rejects invalid email format — Zod email() validation", async () => {
    const caller = unauthCaller();

    await expect(
      caller.auth.register({
        email: "not-an-email",
        name: "Someone",
        password: "SecurePass1!",
        confirmPassword: "SecurePass1!",
      })
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof TRPCError && err.code === "BAD_REQUEST";
    });
  });

  it("rejects name shorter than 2 characters — Zod min(2) validation on name field", async () => {
    const caller = unauthCaller();

    await expect(
      caller.auth.register({
        email: "shortname@vyapar.in",
        name: "A",
        password: "SecurePass1!",
        confirmPassword: "SecurePass1!",
      })
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof TRPCError && err.code === "BAD_REQUEST";
    });
  });

  it("stores password as Argon2id hash — plaintext is never persisted in the users table", async () => {
    const caller = unauthCaller();
    const email = "argon2check@vyapar.in";

    await caller.auth.register({
      email,
      name: "Hash Checker",
      password: "PlainTextPassword1!",
      confirmPassword: "PlainTextPassword1!",
    });

    const [dbUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    expect(dbUser).toBeDefined();

    // Must start with Argon2id identifier
    expect(dbUser!.passwordHash).toMatch(/^\$argon2id\$/);
    // Must NOT contain the plaintext
    expect(dbUser!.passwordHash).not.toContain("PlainTextPassword1!");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// auth.login
// ─────────────────────────────────────────────────────────────────────────────

describe("auth.login", () => {
  // Pre-condition: user already exists in DB (via fixtures, no roundtrip through register)
  let loginUserId: string;

  beforeAll(async () => {
    // Create a user with a real Argon2id hash of "Test@1234!" using the auth.register
    // flow so we have a known password we can verify against.
    const caller = unauthCaller();
    const result = await caller.auth.register({
      email: "login.test@vyapar.in",
      name: "Login Tester",
      password: "Test@1234!",
      confirmPassword: "Test@1234!",
    });
    loginUserId = result.user.id;
  });

  it("succeeds with correct email and password — returns user object and session token", async () => {
    const caller = unauthCaller();
    const result = await caller.auth.login({
      email: "login.test@vyapar.in",
      password: "Test@1234!",
    });

    expect(result.twoFactorRequired).toBe(false);
    if (result.twoFactorRequired) throw new Error("expected a session, got a two-factor challenge");
    expect(result.user.email).toBe("login.test@vyapar.in");
    expect(result.user.id).toBe(loginUserId);
    expect(typeof result.sessionToken).toBe("string");
    expect(result.sessionToken.length).toBeGreaterThan(30);

    // A new session row should now exist
    const db = getControlDb();
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, result.sessionToken))
      .limit(1);
    expect(session).toBeDefined();
    expect(session!.userId).toBe(loginUserId);
  });

  it("matches email case-insensitively — stored lowercase, login and duplicate check ignore case", async () => {
    const caller = unauthCaller();
    const reg = await caller.auth.register({
      email: "Case.Mixed@Vyapar.in",
      name: "Case Tester",
      password: "Test@1234!",
      confirmPassword: "Test@1234!",
    });
    expect(reg.user.email).toBe("case.mixed@vyapar.in");

    const login = await unauthCaller().auth.login({ email: "CASE.MIXED@vyapar.in", password: "Test@1234!" });
    if (login.twoFactorRequired) throw new Error("expected a session, got a two-factor challenge");
    expect(login.user.id).toBe(reg.user.id);

    await expect(
      unauthCaller().auth.register({
        email: "case.mixed@VYAPAR.in",
        name: "Case Tester",
        password: "Test@1234!",
        confirmPassword: "Test@1234!",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("login with wrong password returns UNAUTHORIZED — does not leak whether email exists", async () => {
    const caller = unauthCaller();
    await expect(
      caller.auth.login({
        email: "login.test@vyapar.in",
        password: "WrongPassword!",
      })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Invalid email or password",
    });
  });

  it("login with non-existent email returns the same UNAUTHORIZED error — no user enumeration", async () => {
    const caller = unauthCaller();

    let wrongPasswordError: TRPCError | undefined;
    let noUserError: TRPCError | undefined;

    try {
      await caller.auth.login({ email: "login.test@vyapar.in", password: "WrongPw1!" });
    } catch (err) {
      if (err instanceof TRPCError) wrongPasswordError = err;
    }

    try {
      await caller.auth.login({ email: "nobody.exists@vyapar.in", password: "Anything1!" });
    } catch (err) {
      if (err instanceof TRPCError) noUserError = err;
    }

    // Both cases must produce identical code and message — no enumeration possible
    expect(wrongPasswordError).toBeDefined();
    expect(noUserError).toBeDefined();
    expect(wrongPasswordError!.code).toBe(noUserError!.code);
    expect(wrongPasswordError!.message).toBe(noUserError!.message);
  });

  it("login for a user with no passwordHash (passwordless account) returns UNAUTHORIZED", async () => {
    // Insert a user without a password hash to simulate a passwordless account
    const _db = getControlDb();
    const tenant = await createTenant({ name: "MagicOnly Org" });
    const magicUser = await createUser({
      email: "magiconly@vyapar.in",
      passwordHash: null as unknown as string,
      emailVerified: true,
    });
    await addMember(tenant.id, magicUser.id, "owner");

    const caller = unauthCaller();
    await expect(
      caller.auth.login({ email: "magiconly@vyapar.in", password: "Anything1!" })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Invalid email or password",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// auth.me
// ─────────────────────────────────────────────────────────────────────────────

describe("auth.me", () => {
  let meUser: Awaited<ReturnType<typeof createUser>>;
  let meTenant: Awaited<ReturnType<typeof createTenant>>;
  let meSession: Awaited<ReturnType<typeof createSession>>;

  beforeAll(async () => {
    meUser = await createUser({ email: "me.test@vyapar.in", name: "Me Tester" });
    meTenant = await createTenant({ name: "Me Test Org" });
    await addMember(meTenant.id, meUser.id, "owner");
    meSession = await createSession(meUser.id, meTenant.id);
  });

  it("returns current user info when the request carries a valid session", async () => {
    const caller = callerWithSession(meSession.id, meUser.id, meUser.email, meTenant.id);
    const result = await caller.auth.me();

    expect(result.user).not.toBeNull();
    expect(result.user!.id).toBe(meUser.id);
    expect(result.user!.email).toBe("me.test@vyapar.in");
    expect(result.tenantId).toBe(meTenant.id);
    expect(result.tenantName).toBe("Me Test Org");
    // me returns the raw DB role; mapDbRole is applied in the permission middleware
    expect(result.role).toBe("owner");
  });

  it("returns null user and null tenant for an unauthenticated request — no session present", async () => {
    const caller = unauthCaller();
    const result = await caller.auth.me();

    expect(result.user).toBeNull();
    expect(result.tenantId).toBeNull();
    expect(result.tenantName).toBeNull();
    expect(result.role).toBeNull();
    expect(result.needsProfile).toBe(false);
  });

  it("needsProfile is true when user has no display name", async () => {
    const namelessUser = await createUser({ email: "nameless@vyapar.in", name: null as unknown as string });
    const namelessTenant = await createTenant({ name: "Nameless Org" });
    await addMember(namelessTenant.id, namelessUser.id, "owner");
    const namelessSession = await createSession(namelessUser.id, namelessTenant.id);

    const caller = callerWithSession(namelessSession.id, namelessUser.id, namelessUser.email, namelessTenant.id);
    const result = await caller.auth.me();

    expect(result.needsProfile).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// auth.logout
// ─────────────────────────────────────────────────────────────────────────────

describe("auth.logout", () => {
  let logoutUser: Awaited<ReturnType<typeof createUser>>;
  let logoutTenant: Awaited<ReturnType<typeof createTenant>>;
  let logoutSession: Awaited<ReturnType<typeof createSession>>;

  beforeAll(async () => {
    logoutUser = await createUser({ email: "logout.test@vyapar.in", name: "Logout Tester" });
    logoutTenant = await createTenant({ name: "Logout Org" });
    await addMember(logoutTenant.id, logoutUser.id, "owner");
    logoutSession = await createSession(logoutUser.id, logoutTenant.id);
  });

  it("invalidates the session — session row is deleted from the DB after logout", async () => {
    const db = getControlDb();

    // Confirm session exists before logout
    const [before] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, logoutSession.id))
      .limit(1);
    expect(before).toBeDefined();

    // Perform logout using a caller that carries the session cookie
    const caller = callerWithSession(logoutSession.id, logoutUser.id, logoutUser.email, logoutTenant.id);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);

    // Session row must be gone from control DB
    const [after] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, logoutSession.id))
      .limit(1);
    expect(after).toBeUndefined();
  });

  it("logout on an unauthenticated request returns UNAUTHORIZED", async () => {
    const caller = unauthCaller();
    await expect(caller.auth.logout()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// auth.register — transaction isolation regression test
//
// Regression: assignTenantToNewUser() used controlDb directly instead of the
// parent transaction's tx. The user row (inserted by tx) was invisible to
// tenant_members insert (using controlDb) → FK violation on user_id.
// Fix: pass tx through to getOrCreateDefaultTenant / assignTenantToNewUser.
// ─────────────────────────────────────────────────────────────────────────────

describe("auth.register — new user setup", () => {
  const db = getControlDb();

  it("creates a new user AND tenant membership atomically — no FK violation", async () => {
    const caller = unauthCaller();
    const email = "register-new@vyapar.in";

    const result = await caller.auth.register({
      username: "registernew",
      email,
      password: "SecurePass1!",
      confirmPassword: "SecurePass1!",
    });

    expect(result.user.email).toBe(email);
    expect(typeof result.sessionToken).toBe("string");

    const [dbUser] = await db.select().from(users)
      .where(eq(users.email, email)).limit(1);
    expect(dbUser).toBeDefined();

    const memberships = await db.select().from(tenantMembers)
      .where(eq(tenantMembers.userId, dbUser!.id));
    expect(memberships.length).toBeGreaterThanOrEqual(1);
  });

  // ── Protective: pending invitation skips tenant auto-creation (P1-9) ────
  //
  // When an email has a pending invitation, register must NOT auto-create an
  // organization. The user will join the invited org after completing their
  // profile. Protects the invitation branch at auth.ts inside register
  // — if someone removes the invitation peek or the in-tx re-check, new
  // invited users would get an unwanted free org auto-created and the
  // onboarding flow would bifurcate silently.
  it("skips auto-tenant creation when the user has a pending invitation", async () => {
    const caller = unauthCaller();
    const email = "invited-new-user@vyapar.in";

    // Seed: an inviting tenant + a pending invitation for our email
    const [invitingTenant] = await db.insert(tenants).values({
      name: "Inviting Org",
      slug: "inviting-org-" + nanoid(6),
    }).returning({ id: tenants.id });

    // Need a user to be the inviter (FK on invitations.invitedBy)
    const inviter = await createUser({ email: "inviter@vyapar.in", name: "Inviter" });
    await addMember(invitingTenant!.id, inviter.id, "owner");

    const inviteToken = "invite-" + nanoid(32);
    await db.insert(invitations).values({
      tenantId: invitingTenant!.id,
      email: email.toLowerCase(),
      role: "member",
      token: inviteToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      invitedBy: inviter.id,
    });

    // Now register with the SAME email — should NOT create a new tenant
    const result = await caller.auth.register({
      username: "invitednewuser",
      email,
      password: "SecurePass1!",
      confirmPassword: "SecurePass1!",
    });

    expect(result.user.email).toBe(email);

    // The user has ZERO memberships because no tenant was auto-created and
    // the invitation hasn't been accepted yet. The invitation is accepted via
    // a separate call (tenant.acceptById / acceptInvitation).
    const [dbUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    expect(dbUser).toBeDefined();
    const memberships = await db.select().from(tenantMembers)
      .where(eq(tenantMembers.userId, dbUser!.id));
    expect(memberships).toHaveLength(0);

    // The session row has tenantId=null — user must accept the invite / pick
    // an org before any business operations.
    const [sess] = await db.select().from(sessions)
      .where(eq(sessions.userId, dbUser!.id)).limit(1);
    expect(sess).toBeDefined();
    expect(sess!.tenantId).toBeNull();

    // And the invitation is still pending (not auto-accepted by the
    // register flow — that's the responsibility of tenant.acceptById).
    const pending = await db.select().from(invitations)
      .where(isNull(invitations.acceptedAt));
    expect(pending.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// auth.revokeSession
// ─────────────────────────────────────────────────────────────────────────────

describe("auth.revokeSession", () => {
  it("revokes another session — session row is deleted, revoking user's session A still works", async () => {
    const db = getControlDb();

    // Create a user with two sessions (simulates two devices)
    const user = await createUser({ email: "revoke.test@example.in", name: "Revoke User" });
    const tenant = await createTenant({ name: "Revoke Test Org" });
    await addMember(tenant.id, user.id, "owner");
    const sessionA = await createSession(user.id, tenant.id); // "this device"
    const sessionB = await createSession(user.id, tenant.id); // "other device"

    // From session A, revoke session B
    const callerA = callerWithSession(sessionA.id, user.id, user.email, tenant.id);
    const result = await callerA.auth.revokeSession({ sessionId: sessionB.id });
    expect(result.success).toBe(true);

    // Verify session B is gone from DB — createContext will return user:null
    // for this session, causing protectedProcedure to throw UNAUTHORIZED
    const [remaining] = await db.select()
      .from(sessions)
      .where(eq(sessions.id, sessionB.id))
      .limit(1);
    expect(remaining).toBeUndefined();

    // Verify session A still works
    const meA = await callerA.auth.me();
    expect(meA.user?.email).toBe("revoke.test@example.in");

    // Verify session A is still in DB
    const [sessionARow] = await db.select()
      .from(sessions)
      .where(eq(sessions.id, sessionA.id))
      .limit(1);
    expect(sessionARow).toBeDefined();
  });

  it("cannot revoke your own current session — BAD_REQUEST", async () => {
    const user = await createUser({ email: "self.revoke@example.in", name: "Self Revoker" });
    const session = await createSession(user.id);

    const caller = callerWithSession(session.id, user.id, user.email);
    await expect(
      caller.auth.revokeSession({ sessionId: session.id }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cannot revoke your current session. Use logout instead.",
    });
  });

  it("cannot revoke another user's session — NOT_FOUND", async () => {
    const user1 = await createUser({ email: "user1.revoke@example.in", name: "User 1" });
    const user2 = await createUser({ email: "user2.revoke@example.in", name: "User 2" });
    const session1 = await createSession(user1.id);
    const session2 = await createSession(user2.id);

    // User 1 tries to revoke User 2's session
    const caller1 = callerWithSession(session1.id, user1.id, user1.email);
    await expect(
      caller1.auth.revokeSession({ sessionId: session2.id }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  });
});
