import * as argon2 from "argon2";
import { eq, sql } from "drizzle-orm";
import { controlDb, users } from "@fintranzact/db";
import { logger } from "./logger.js";

/**
 * Platform admins see every organisation (tenant) on this server. This is
 * separate from the per-organisation "superadmin" role, which only sees its
 * own organisation.
 *
 * Who counts as a platform admin comes only from the environment:
 *   PLATFORM_ADMIN_EMAIL      the admin account to create at start-up
 *   PLATFORM_ADMIN_PASSWORD   its initial password (used only when creating it)
 *   PLATFORM_ADMIN_NAME       optional display name
 *   PLATFORM_ADMIN_EMAILS     optional extra admin emails, comma-separated
 *
 * An admin's email must be verified. The seeded account is created verified;
 * any other listed email has to verify itself by signing in with an emailed
 * link, so registering someone else's address never grants access.
 */
export function platformAdminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  const list = [env.PLATFORM_ADMIN_EMAIL ?? "", ...(env.PLATFORM_ADMIN_EMAILS ?? "").split(",")];
  return [...new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const admins = platformAdminEmails();
  if (admins.length === 0) return false;
  const [row] = await controlDb
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || !row.emailVerified) return false;
  return admins.includes(row.email.trim().toLowerCase());
}

export type SeedResult = "skipped" | "created" | "exists" | "exists-unverified";

/**
 * Create the platform admin account from PLATFORM_ADMIN_EMAIL /
 * PLATFORM_ADMIN_PASSWORD if it does not exist yet. An existing account is
 * never changed: its password stays, and an unverified one is left
 * unverified (whoever registered it must prove they own the inbox).
 */
export async function seedPlatformAdmin(env: NodeJS.ProcessEnv = process.env): Promise<SeedResult> {
  const email = env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.PLATFORM_ADMIN_PASSWORD;
  if (!email || !password) return "skipped";

  const [existing] = await controlDb
    .select({ id: users.id, emailVerified: users.emailVerified })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (existing) {
    if (!existing.emailVerified) {
      logger.warn(
        { email },
        "Platform admin email is registered but not verified; it gets admin access once it signs in with an emailed link",
      );
      return "exists-unverified";
    }
    return "exists";
  }

  if (password.length < 8) {
    logger.warn({ email }, "PLATFORM_ADMIN_PASSWORD must be at least 8 characters; admin account not created");
    return "skipped";
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
  await controlDb.insert(users).values({
    email,
    name: env.PLATFORM_ADMIN_NAME?.trim() || "Platform admin",
    passwordHash,
    emailVerified: true,
  });
  logger.info({ email }, "Platform admin account created");
  return "created";
}
