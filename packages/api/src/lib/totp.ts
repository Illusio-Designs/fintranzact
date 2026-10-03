/**
 * totp.ts — RFC 6238 TOTP / RFC 4226 HOTP on node:crypto (HMAC-SHA1), plus
 * RFC 4648 base32. No third-party dependency.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base32 (RFC 4648), upper-case, no padding on output. */
export function base32Encode(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Tolerant decode: case-insensitive; spaces, dashes and '=' padding are ignored. Throws on other characters. */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s\-=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

/** A fresh 160-bit secret, base32-encoded (32 characters). */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

type Key = string | Uint8Array;

function keyBytes(secret: Key): Uint8Array {
  return typeof secret === "string" ? base32Decode(secret) : secret;
}

/** HOTP (RFC 4226) with dynamic truncation. `secret` is base32 text or raw bytes. */
export function hotp(secret: Key, counter: number | bigint, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", keyBytes(secret)).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** The time step a unix time (ms) falls in. */
export function timeStep(timeMs: number, step = 30): number {
  return Math.floor(timeMs / 1000 / step);
}

/** TOTP (RFC 6238). `time` is unix time in milliseconds. */
export function totpAt(secret: Key, time: number, step = 30, digits = 6): string {
  return hotp(secret, timeStep(time, step), digits);
}

export interface VerifyTotpOptions {
  /** Unix ms; defaults to Date.now(). */
  now?: number;
  /** Steps accepted either side of now (clock drift). Default 1. */
  window?: number;
  /** Last accepted step for this user; a match at or before it is rejected (replay). */
  lastUsedStep?: number | null;
}

export interface VerifyTotpResult {
  ok: boolean;
  /** The matched step on success, for storing as lastUsedStep. */
  step: number | null;
}

function equalStrings(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Verify a 6-digit code. Spaces are stripped; anything but exactly six digits
 * is rejected. All candidate steps are always compared (no early exit) so
 * timing does not reveal which step matched.
 */
export function verifyTotp(secret: Key, code: string, opts: VerifyTotpOptions = {}): VerifyTotpResult {
  const now = opts.now ?? Date.now();
  const window = opts.window ?? 1;
  const last = opts.lastUsedStep ?? null;
  const normalised = String(code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalised)) return { ok: false, step: null };

  const key = keyBytes(secret);
  const current = timeStep(now);
  let matched: number | null = null;
  for (let step = current - window; step <= current + window; step++) {
    if (step < 0) continue;
    const hit = equalStrings(hotp(key, step, 6), normalised);
    if (hit && (last === null || step > last) && (matched === null || step > matched)) matched = step;
  }
  return matched === null ? { ok: false, step: null } : { ok: true, step: matched };
}

export interface OtpauthUriInput {
  secret: string;
  accountName: string;
  issuer?: string;
}

/** otpauth:// URI for authenticator apps (also what the QR code encodes). */
export function otpauthUri({ secret, accountName, issuer = "Fintranzact" }: OtpauthUriInput): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  // URLSearchParams encodes spaces as '+', which some apps read literally.
  return `otpauth://totp/${label}?${params.toString().replace(/\+/g, "%20")}`;
}
