/**
 * two-factor-codes.ts — backup codes and opaque tokens (login challenges,
 * trusted devices). Pure functions; nothing here depends on ENCRYPTION_KEY.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { BACKUP_CODE_COUNT } from "@fintranzact/shared";

/** 30 symbols (no 0/O/1/I/L/U), ~4.9 bits each. */
export const BACKUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
/** 12 symbols = ~58.9 bits per code, above the 50-bit target. */
const CODE_LENGTH = 12;

function randomSymbol(): string {
  return BACKUP_CODE_ALPHABET[randomInt(BACKUP_CODE_ALPHABET.length)];
}

/** Human-friendly one-time codes, formatted XXXXXX-XXXXXX (~58.9 bits each). */
export function generateBackupCodes(n: number = BACKUP_CODE_COUNT): string[] {
  const seen = new Set<string>();
  while (seen.size < n) {
    let raw = "";
    for (let i = 0; i < CODE_LENGTH; i++) raw += randomSymbol();
    seen.add(`${raw.slice(0, CODE_LENGTH / 2)}-${raw.slice(CODE_LENGTH / 2)}`);
  }
  return [...seen];
}

/** Canonical form for hashing: upper-case, only letters and digits kept. */
export function normalizeBackupCode(input: string): string {
  return String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * sha256 hex of a backup code, salted with the user id as a domain separator.
 *
 * Deliberately NOT keyed from ENCRYPTION_KEY: rotating that key must never
 * invalidate anyone's backup codes. The codes carry ~59 bits of entropy and
 * are single-use, so a salted fast hash is adequate; the user id stops one
 * code table being reused across accounts. Normalises the code first.
 */
export function hashBackupCode(userId: string, code: string): string {
  return createHash("sha256")
    .update(`fintranzact:2fa-backup:v1:${userId}:${normalizeBackupCode(code)}`)
    .digest("hex");
}

/** Constant-time equality for two hex hashes. */
export function constantTimeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** True if `input` matches any stored hash; scans all of them (no early exit). */
export function matchesAnyBackupHash(userId: string, input: string, hashes: readonly string[]): boolean {
  const h = hashBackupCode(userId, input);
  let found = false;
  for (const stored of hashes) if (constantTimeEqualHex(h, stored)) found = true;
  return found;
}

/** 32 random bytes, base64url. Give this to the client; store only its hash. */
export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** sha256 hex of an opaque token (high-entropy, so a plain hash suffices). */
export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
