/**
 * two-factor-store.ts — the Postgres implementation of TwoFactorStore, plus the
 * real TwoFactorDeps. Every statement the replay, single-use and lockout rules
 * rely on is one atomic UPDATE.
 */

import { and, count, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import {
  controlDb,
  tenantMembers,
  tenants,
  trustedDevices,
  twoFactorBackupCodes,
  userTwoFactor,
  users,
} from "@fintranzact/db";
import { LOCKOUT_FAILURE_THRESHOLD, lockoutDuration } from "@fintranzact/shared";
import * as argon2 from "argon2";
import { recordSecurityEvent } from "./security-events.js";
import { rotateSessionsOnPrivilegeEvent } from "./session-rotation.js";
import { renderQrDataUrl, type TwoFactorDeps, type TwoFactorStore } from "./two-factor.js";

export const drizzleTwoFactorStore: TwoFactorStore = {
  async getRecord(userId) {
    const [row] = await controlDb.select().from(userTwoFactor).where(eq(userTwoFactor.userId, userId)).limit(1);
    return row ?? null;
  },

  async getUserAuth(userId) {
    const [row] = await controlDb
      .select({ email: users.email, passwordHash: users.passwordHash, twoFactorEnabled: users.twoFactorEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  },

  async upsertPendingSecret(userId, secretEnc) {
    const now = new Date();
    const rows = await controlDb
      .insert(userTwoFactor)
      .values({ userId, secretEnc, confirmedAt: null, lastUsedStep: null })
      .onConflictDoUpdate({
        target: userTwoFactor.userId,
        // Replaces an earlier pending secret; never touches a confirmed one.
        // Failure/lockout counters are kept so re-running setup cannot reset a lockout.
        set: { secretEnc, lastUsedStep: null, updatedAt: now },
        setWhere: isNull(userTwoFactor.confirmedAt),
      })
      .returning({ userId: userTwoFactor.userId });
    return rows.length > 0;
  },

  async advanceStep(userId, step) {
    const rows = await controlDb
      .update(userTwoFactor)
      .set({ lastUsedStep: step, updatedAt: new Date() })
      .where(
        and(
          eq(userTwoFactor.userId, userId),
          or(isNull(userTwoFactor.lastUsedStep), lt(userTwoFactor.lastUsedStep, step)),
        ),
      )
      .returning({ userId: userTwoFactor.userId });
    return rows.length > 0;
  },

  async recordFailure(userId, now) {
    const T = LOCKOUT_FAILURE_THRESHOLD;
    const nowIso = now.toISOString();
    const tripped = sql`${userTwoFactor.failedCount} + 1 >= ${T}`;
    const [row] = await controlDb
      .update(userTwoFactor)
      .set({
        failedCount: sql`CASE WHEN ${tripped} THEN 0 ELSE ${userTwoFactor.failedCount} + 1 END`,
        lockedUntil: sql`CASE WHEN ${tripped} THEN ${nowIso}::timestamptz + (CASE WHEN ${userTwoFactor.lockoutCount} <= 0 THEN ${lockoutDuration(0)}::double precision WHEN ${userTwoFactor.lockoutCount} = 1 THEN ${lockoutDuration(1)}::double precision ELSE ${lockoutDuration(2)}::double precision END) * interval '1 millisecond' ELSE ${userTwoFactor.lockedUntil} END`,
        lockoutCount: sql`CASE WHEN ${tripped} THEN ${userTwoFactor.lockoutCount} + 1 ELSE ${userTwoFactor.lockoutCount} END`,
        updatedAt: now,
      })
      .where(eq(userTwoFactor.userId, userId))
      .returning({ failedCount: userTwoFactor.failedCount, lockedUntil: userTwoFactor.lockedUntil });
    // failed_count is 0 after a failure only when this failure tripped the lockout.
    const locked = !!row && row.failedCount === 0;
    return { locked, lockedUntil: locked ? row.lockedUntil : null };
  },

  async recordSuccess(userId) {
    await controlDb
      .update(userTwoFactor)
      .set({ failedCount: 0, lockoutCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(userTwoFactor.userId, userId));
  },

  async consumeBackupCode(userId, codeHash) {
    const rows = await controlDb
      .update(twoFactorBackupCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(twoFactorBackupCodes.userId, userId),
          eq(twoFactorBackupCodes.codeHash, codeHash),
          isNull(twoFactorBackupCodes.usedAt),
        ),
      )
      .returning({ id: twoFactorBackupCodes.id });
    return rows.length > 0;
  },

  async countUnusedBackupCodes(userId) {
    const [row] = await controlDb
      .select({ n: count() })
      .from(twoFactorBackupCodes)
      .where(and(eq(twoFactorBackupCodes.userId, userId), isNull(twoFactorBackupCodes.usedAt)));
    return Number(row?.n ?? 0);
  },

  async completeEnrolment(userId, { step, codeHashes, now }) {
    return controlDb.transaction(async (tx) => {
      const confirmed = await tx
        .update(userTwoFactor)
        .set({
          confirmedAt: now,
          lastUsedStep: step,
          failedCount: 0,
          lockoutCount: 0,
          lockedUntil: null,
          updatedAt: now,
        })
        .where(and(eq(userTwoFactor.userId, userId), isNull(userTwoFactor.confirmedAt)))
        .returning({ userId: userTwoFactor.userId });
      if (confirmed.length === 0) return false;
      await tx.update(users).set({ twoFactorEnabled: true, updatedAt: now }).where(eq(users.id, userId));
      await tx.delete(twoFactorBackupCodes).where(eq(twoFactorBackupCodes.userId, userId));
      await tx.insert(twoFactorBackupCodes).values(codeHashes.map((codeHash) => ({ userId, codeHash })));
      return true;
    });
  },

  async replaceBackupCodes(userId, codeHashes) {
    await controlDb.transaction(async (tx) => {
      await tx.delete(twoFactorBackupCodes).where(eq(twoFactorBackupCodes.userId, userId));
      await tx.insert(twoFactorBackupCodes).values(codeHashes.map((codeHash) => ({ userId, codeHash })));
    });
  },

  async disable(userId, now) {
    await controlDb.transaction(async (tx) => {
      await tx.delete(twoFactorBackupCodes).where(eq(twoFactorBackupCodes.userId, userId));
      await tx.delete(userTwoFactor).where(eq(userTwoFactor.userId, userId));
      await tx
        .update(trustedDevices)
        .set({ revokedAt: now })
        .where(and(eq(trustedDevices.userId, userId), isNull(trustedDevices.revokedAt)));
      await tx.update(users).set({ twoFactorEnabled: false, updatedAt: now }).where(eq(users.id, userId));
    });
  },

  async membershipPolicies(userId) {
    const rows = await controlDb
      .select({
        tenantId: tenants.id,
        role: tenantMembers.role,
        policy: tenants.twoFactorPolicy,
        enforcedAt: tenants.twoFactorEnforcedAt,
        graceDays: tenants.twoFactorGraceDays,
        memberSince: tenantMembers.createdAt,
      })
      .from(tenantMembers)
      .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
      .where(eq(tenantMembers.userId, userId));
    return rows;
  },

  async countTrustedDevices(userId, now) {
    const [row] = await controlDb
      .select({ n: count() })
      .from(trustedDevices)
      .where(and(eq(trustedDevices.userId, userId), isNull(trustedDevices.revokedAt), gt(trustedDevices.expiresAt, now)));
    return Number(row?.n ?? 0);
  },
};

/** Production wiring. `loginLimiter` is the per-email limiter owned by routers/auth.ts. */
export function createTwoFactorDeps(loginLimiter: TwoFactorDeps["loginLimiter"]): TwoFactorDeps {
  return {
    store: drizzleTwoFactorStore,
    record: recordSecurityEvent,
    rotateSessions: rotateSessionsOnPrivilegeEvent,
    loginLimiter,
    verifyPassword: (hash, password) => argon2.verify(hash, password),
    renderQr: renderQrDataUrl,
    now: () => Date.now(),
  };
}
