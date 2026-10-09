/**
 * Field-level AES-256-GCM encryption with key ids and rotation support.
 * Design and procedure: docs/security/key-rotation.md.
 *
 * Configuration:
 *   ENCRYPTION_KEY           current key, used for every new encryption (64-char hex = 32 bytes)
 *   ENCRYPTION_KEY_ID        optional label for the current key ([A-Za-z0-9_-]{1,32}); default is
 *                            the first 4 bytes of a SHA-256 of the key (never the key itself)
 *   ENCRYPTION_KEYS_PREVIOUS previous keys, decrypt-only. Comma separated or a JSON array; each
 *                            entry is "<64 hex>" or "<label>=<64 hex>"
 *   ENCRYPTION_KEY_PREVIOUS  single previous key (older name, still read)
 *   DB_ENCRYPTION_KEY        accepted as an alias for ENCRYPTION_KEY
 *
 * Formats (all still readable):
 *   v3:{keyId}:{iv}:{tag}:{ciphertext}   written today
 *   v2:{iv}:{tag}:{ciphertext}           written before key ids existed (decrypts with any configured key)
 *   {iv}:{tag}:{ciphertext}              legacy, implicitly version 1
 *   anything else                        plaintext, returned as is by decryptField
 *
 * The cipher (AES-256-GCM, 16-byte random IV, no AAD) is the same in every version, so a v2 value
 * decrypts with the same key as before.
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const CURRENT_KEY_VERSION = 3; // Version stamped on all new encryptions

/** Thrown by the strict helpers. The message never contains key material or plaintext. */
export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionError";
  }
}

// ── Key loading ─────────────────────────────────────────────────────────────

interface KeyEntry {
  id: string;
  key: Buffer;
}

const HEX64_RE = /^[0-9a-fA-F]{64}$/;
const KEY_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

function derivedKeyId(key: Buffer): string {
  return createHash("sha256").update("fintranzact-key-id\0").update(key).digest("hex").slice(0, 8);
}

function parseKey(hex: string | undefined, envName: string): Buffer | null {
  if (!hex) return null;
  if (!HEX64_RE.test(hex)) {
    throw new Error(`${envName} must be a 64-character hex string (32 bytes)`);
  }
  return Buffer.from(hex, "hex");
}

function getCurrentEntry(): KeyEntry | null {
  const key = parseKey(process.env.ENCRYPTION_KEY || process.env.DB_ENCRYPTION_KEY, "ENCRYPTION_KEY");
  if (!key) return null;
  const label = process.env.ENCRYPTION_KEY_ID?.trim();
  if (label && !KEY_ID_RE.test(label)) {
    throw new Error("ENCRYPTION_KEY_ID must be 1-32 characters of letters, digits, '_' or '-'");
  }
  return { id: label || derivedKeyId(key), key };
}

function splitPreviousList(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  if (t.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch {
      throw new Error("ENCRYPTION_KEYS_PREVIOUS is not valid JSON or a comma separated list");
    }
    if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== "string")) {
      throw new Error("ENCRYPTION_KEYS_PREVIOUS JSON must be an array of strings");
    }
    return (parsed as string[]).map((v) => v.trim()).filter(Boolean);
  }
  return t.split(",").map((v) => v.trim()).filter(Boolean);
}

function getPreviousEntries(): KeyEntry[] {
  const out: KeyEntry[] = [];
  const single = parseKey(process.env.ENCRYPTION_KEY_PREVIOUS, "ENCRYPTION_KEY_PREVIOUS");
  if (single) out.push({ id: derivedKeyId(single), key: single });
  for (const item of splitPreviousList(process.env.ENCRYPTION_KEYS_PREVIOUS ?? "")) {
    const eq = item.indexOf("=");
    const label = eq === -1 ? "" : item.slice(0, eq).trim();
    const hex = eq === -1 ? item : item.slice(eq + 1).trim();
    if (label && !KEY_ID_RE.test(label)) {
      throw new Error("ENCRYPTION_KEYS_PREVIOUS has an entry with an invalid key label");
    }
    const key = parseKey(hex, "ENCRYPTION_KEYS_PREVIOUS");
    if (key) out.push({ id: label || derivedKeyId(key), key });
  }
  return out;
}

/** True when an encryption key is configured (otherwise values pass through as plaintext). */
export function hasEncryptionKey(): boolean {
  return getCurrentEntry() !== null;
}

/** Id of the current key (the label or the derived fingerprint), or null with no key. Safe to log. */
export function getCurrentKeyId(): string | null {
  return getCurrentEntry()?.id ?? null;
}

// ── Format detection ────────────────────────────────────────────────────────

const V3_RE = /^v3:([A-Za-z0-9_-]{1,32}):([0-9a-f]+):([0-9a-f]+):([0-9a-f]*)$/i;
const VERSIONED_RE = /^v(\d+):([0-9a-f]+):([0-9a-f]+):([0-9a-f]*)$/i;
const LEGACY_RE = /^([0-9a-f]+):([0-9a-f]+):([0-9a-f]+)$/i;

interface ParsedCiphertext {
  version: number;
  keyId: string | null;
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
}

function parseCiphertext(stored: string): ParsedCiphertext | null {
  const v3 = stored.match(V3_RE);
  if (v3) {
    return {
      version: 3,
      keyId: v3[1],
      iv: Buffer.from(v3[2], "hex"),
      authTag: Buffer.from(v3[3], "hex"),
      ciphertext: Buffer.from(v3[4], "hex"),
    };
  }

  const vMatch = stored.match(VERSIONED_RE);
  if (vMatch) {
    return {
      version: Number(vMatch[1]),
      keyId: null,
      iv: Buffer.from(vMatch[2], "hex"),
      authTag: Buffer.from(vMatch[3], "hex"),
      ciphertext: Buffer.from(vMatch[4], "hex"),
    };
  }

  const lMatch = stored.match(LEGACY_RE);
  if (lMatch) {
    return {
      version: 1,
      keyId: null,
      iv: Buffer.from(lMatch[1], "hex"),
      authTag: Buffer.from(lMatch[2], "hex"),
      ciphertext: Buffer.from(lMatch[3], "hex"),
    };
  }

  return null; // Not encrypted — plaintext
}

// ── Core encrypt / decrypt ──────────────────────────────────────────────────

function rawEncrypt(plaintext: string, entry: KeyEntry): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, entry.key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v${CURRENT_KEY_VERSION}:${entry.id}:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function rawDecrypt(parsed: ParsedCiphertext, key: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, key, parsed.iv);
  decipher.setAuthTag(parsed.authTag);
  const decrypted = Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/** Configured keys in the order to try them: those whose id matches the value first, then the rest. */
function candidateKeys(parsed: ParsedCiphertext, currentOnly = false): Buffer[] {
  const cur = getCurrentEntry();
  if (!cur) return [];
  if (currentOnly) return [cur.key];
  const all = [cur, ...getPreviousEntries()];
  if (!parsed.keyId) return all.map((e) => e.key);
  return [...all.filter((e) => e.id === parsed.keyId), ...all.filter((e) => e.id !== parsed.keyId)].map((e) => e.key);
}

function tryDecrypt(parsed: ParsedCiphertext, currentOnly = false): string | null {
  for (const key of candidateKeys(parsed, currentOnly)) {
    try {
      return rawDecrypt(parsed, key);
    } catch {
      // wrong key or tampered value: try the next one
    }
  }
  return null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Check whether a stored value looks encrypted (any version).
 */
export function isEncrypted(value: string): boolean {
  return V3_RE.test(value) || VERSIONED_RE.test(value) || LEGACY_RE.test(value);
}

/**
 * Get the format version stamped on an encrypted value, or 0 for plaintext.
 */
export function getKeyVersion(stored: string): number {
  const parsed = parseCiphertext(stored);
  return parsed ? parsed.version : 0;
}

/** Key id recorded in a v3 value; null for v1/v2 values and plaintext. */
export function getCiphertextKeyId(stored: string): string | null {
  return parseCiphertext(stored)?.keyId ?? null;
}

/** True when the value is a v3 envelope written under the current key id. */
export function isOnCurrentKey(stored: string): boolean {
  const cur = getCurrentEntry();
  if (!cur) return false;
  const parsed = parseCiphertext(stored);
  return !!parsed && parsed.version === CURRENT_KEY_VERSION && parsed.keyId === cur.id;
}

/**
 * Encrypt a plaintext string using the current key.
 * Returns plaintext if no key is configured (development/self-hosted fallback).
 */
export function encryptField(plaintext: string): string {
  const cur = getCurrentEntry();
  if (!cur) return plaintext;
  return rawEncrypt(plaintext, cur);
}

/**
 * Decrypt an encrypted string with the current key, then the previous keys.
 * Handles legacy (unversioned) format and plaintext gracefully. When no key
 * works it returns the stored value unchanged (kept for existing callers; the
 * rotation tool and new code use decryptFieldStrict, which fails closed).
 */
export function decryptField(stored: string): string {
  if (!hasEncryptionKey()) return stored;

  const parsed = parseCiphertext(stored);
  if (!parsed) return stored; // Plaintext passthrough

  const plain = tryDecrypt(parsed);
  return plain === null ? stored : plain;
}

/**
 * Decrypt, failing closed. Throws EncryptionError when no key is configured or no configured
 * key opens the value (wrong key, missing previous key or tampered data). The error carries
 * the key id recorded in the value, which is not secret, and never the value or any key.
 * Plaintext (not in an encrypted format) is returned as is: callers that must reject it
 * check isEncrypted first. With currentKeyOnly the previous keys are ignored (the rotation
 * tool's final verification).
 */
export function decryptFieldStrict(stored: string, opts: { currentKeyOnly?: boolean } = {}): string {
  const parsed = parseCiphertext(stored);
  if (!parsed) return stored;
  if (!hasEncryptionKey()) throw new EncryptionError("ENCRYPTION_KEY is not configured; cannot decrypt");
  const plain = tryDecrypt(parsed, opts.currentKeyOnly === true);
  if (plain === null) {
    throw new EncryptionError(
      `Unable to decrypt: no configured encryption key opens this value (format v${parsed.version}, key id ${parsed.keyId ?? "none"}), or it was modified`,
    );
  }
  return plain;
}

/**
 * Re-encrypt a stored value under the current key and key id.
 * Already on the current key: returned unchanged. Plaintext is encrypted.
 * Throws EncryptionError when the value is encrypted but no configured key opens it
 * (it never wraps undecryptable data in a new layer of encryption).
 */
export function reEncryptField(stored: string): string {
  const cur = getCurrentEntry();
  if (!cur) return stored;

  const parsed = parseCiphertext(stored);
  if (!parsed) return rawEncrypt(stored, cur); // Plaintext — encrypt it

  if (parsed.version === CURRENT_KEY_VERSION && parsed.keyId === cur.id) {
    try {
      rawDecrypt(parsed, cur.key);
      return stored; // Already on current key
    } catch {
      // Same key id but it does not open: fall through to the strict path
    }
  }

  return rawEncrypt(decryptFieldStrict(stored), cur);
}

// ── Backward-compatible aliases ─────────────────────────────────────────────

/** @deprecated Use encryptField() instead */
export function encryptDbPassword(plaintext: string): string {
  return encryptField(plaintext);
}

/** @deprecated Use decryptField() instead */
export function decryptDbPassword(stored: string): string {
  return decryptField(stored);
}
