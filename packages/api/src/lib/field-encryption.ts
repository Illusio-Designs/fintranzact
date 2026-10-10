/**
 * field-encryption.ts — Table-specific encrypt/decrypt helpers for sensitive fields.
 *
 * WHY THIS FILE EXISTS:
 * Sensitive credentials (IRP e-invoice creds, carrier API keys) are stored
 * encrypted at rest using AES-256-GCM. This module provides typed wrappers
 * around the generic encryptField/decryptField so that each router can
 * encrypt on write and decrypt on read without duplicating logic.
 *
 * All functions gracefully handle plaintext values (backward compatible)
 * and null/undefined fields.
 */

import { encryptField, decryptField, decryptFieldStrict, isEncrypted } from "@fintranzact/db";

// ── Helpers ─────────────────────────────────────────────────────────────────

function encryptNullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return value as string | null;
  return encryptField(value);
}

function decryptNullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return value as string | null;
  return decryptField(value);
}

// ── E-Invoice Config ────────────────────────────────────────────────────────

export interface EInvoiceConfigSensitiveFields {
  clientId: string | null;
  clientSecret: string | null;
  username: string;
  password: string;
  authToken?: string | null;
}

/**
 * Encrypt sensitive IRP credential fields before writing to DB.
 * Non-sensitive fields (gstin, isSandbox, etc.) pass through unchanged.
 */
export function encryptEInvoiceConfig<T extends EInvoiceConfigSensitiveFields>(
  config: T,
): T {
  return {
    ...config,
    clientId: encryptNullable(config.clientId),
    clientSecret: encryptNullable(config.clientSecret),
    username: encryptField(config.username),
    password: encryptField(config.password),
    authToken: encryptNullable(config.authToken),
  };
}

/**
 * Decrypt sensitive IRP credential fields after reading from DB.
 */
export function decryptEInvoiceConfig<T extends EInvoiceConfigSensitiveFields>(
  config: T,
): T {
  return {
    ...config,
    clientId: decryptNullable(config.clientId),
    clientSecret: decryptNullable(config.clientSecret),
    username: decryptField(config.username),
    password: decryptField(config.password),
    authToken: decryptNullable(config.authToken),
  };
}

// ── E-Way Bill Config ───────────────────────────────────────────────────────

/**
 * NIC E-Way Bill credentials have the same shape as the IRP ones: per-business
 * taxpayer username/password, with optional deployment-level GSP client
 * credentials that fall back to environment variables when null.
 */
export type EwbConfigSensitiveFields = EInvoiceConfigSensitiveFields;

/** Encrypt sensitive NIC EWB credential fields before writing to DB. */
export function encryptEwbConfig<T extends EwbConfigSensitiveFields>(
  config: T,
): T {
  return encryptEInvoiceConfig(config);
}

/** Decrypt sensitive NIC EWB credential fields after reading from DB. */
export function decryptEwbConfig<T extends EwbConfigSensitiveFields>(
  config: T,
): T {
  return decryptEInvoiceConfig(config);
}

// ── Carrier Credentials ─────────────────────────────────────────────────────

export type CarrierCredentials = Record<
  string,
  { apiKey?: string; apiSecret?: string; accountId?: string; enabled: boolean }
>;

/**
 * Encrypt carrier API credentials (JSONB object with per-carrier keys).
 * Each credential field within each carrier entry is individually encrypted.
 */
export function encryptCarrierCredentials(
  creds: CarrierCredentials | null | undefined,
): CarrierCredentials | null {
  if (!creds) return null;
  const encrypted: CarrierCredentials = {};
  for (const [carrier, entry] of Object.entries(creds)) {
    encrypted[carrier] = {
      ...entry,
      apiKey: encryptNullable(entry.apiKey) ?? undefined,
      apiSecret: encryptNullable(entry.apiSecret) ?? undefined,
      accountId: encryptNullable(entry.accountId) ?? undefined,
    };
  }
  return encrypted;
}

/**
 * Decrypt carrier API credentials after reading from DB.
 */
export function decryptCarrierCredentials(
  creds: CarrierCredentials | null | undefined,
): CarrierCredentials | null {
  if (!creds) return null;
  const decrypted: CarrierCredentials = {};
  for (const [carrier, entry] of Object.entries(creds)) {
    decrypted[carrier] = {
      ...entry,
      apiKey: decryptNullable(entry.apiKey) ?? undefined,
      apiSecret: decryptNullable(entry.apiSecret) ?? undefined,
      accountId: decryptNullable(entry.accountId) ?? undefined,
    };
  }
  return decrypted;
}

// ── Two-factor secrets (FAIL-CLOSED) ────────────────────────────────────────

/** 64-hex key accepted only under NODE_ENV=test when no ENCRYPTION_KEY is configured. */
const TEST_ONLY_KEY_HEX = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

function configuredKeyHex(): string | undefined {
  return process.env.ENCRYPTION_KEY || process.env.DB_ENCRYPTION_KEY || undefined;
}

/**
 * The key material 2FA (TOTP) secrets are encrypted with. Backup-code hashes do NOT use it. Unlike
 * encryptField (which silently stores PLAINTEXT when no key is configured),
 * this throws unless a real key is set; only NODE_ENV=test falls back to a
 * fixed test key so unit tests need no environment.
 */
export function requireTwoFactorKeyHex(): string {
  const key = configuredKeyHex();
  if (key) return key;
  if (process.env.NODE_ENV === "test") return TEST_ONLY_KEY_HEX;
  throw new Error("ENCRYPTION_KEY is not configured; refusing to handle two-factor secrets without it");
}

const VERSIONED_CIPHERTEXT_RE = /^v\d+:(?:[A-Za-z0-9_-]{1,32}:)?[0-9a-f]+:[0-9a-f]+:[0-9a-f]*$/i;

/** Encrypt a TOTP secret. Throws when no encryption key is configured (never stores plaintext). */
export function encryptTotpSecret(secret: string): string {
  if (!secret) throw new Error("TOTP secret is empty");
  if (configuredKeyHex()) {
    const out = encryptField(secret);
    if (!VERSIONED_CIPHERTEXT_RE.test(out)) throw new Error("TOTP secret was not encrypted");
    return out;
  }
  if (process.env.NODE_ENV === "test") {
    // Encrypt with the test key by scoping it to this call.
    process.env.ENCRYPTION_KEY = TEST_ONLY_KEY_HEX;
    try {
      return encryptField(secret);
    } finally {
      delete process.env.ENCRYPTION_KEY;
    }
  }
  throw new Error("ENCRYPTION_KEY is not configured; refusing to store a two-factor secret in plaintext");
}

/** Decrypt a stored TOTP secret. Throws on a missing key or a value that is not ciphertext. */
export function decryptTotpSecret(stored: string): string {
  if (!VERSIONED_CIPHERTEXT_RE.test(stored)) throw new Error("Stored TOTP secret is not encrypted");
  if (configuredKeyHex()) return decryptField(stored);
  if (process.env.NODE_ENV === "test") {
    process.env.ENCRYPTION_KEY = TEST_ONLY_KEY_HEX;
    try {
      return decryptField(stored);
    } finally {
      delete process.env.ENCRYPTION_KEY;
    }
  }
  throw new Error("ENCRYPTION_KEY is not configured; cannot decrypt a two-factor secret");
}

// ── Payment-gateway secrets (FAIL-CLOSED) ───────────────────────────────────

/**
 * Encrypt a third-party API secret (a business's own Razorpay keys and webhook
 * secret). Same fail-closed rule as 2FA secrets: with no ENCRYPTION_KEY it
 * throws instead of storing plaintext (encryptField would silently do that).
 */
export function encryptGatewaySecret(secret: string): string {
  if (!secret) throw new Error("Secret is empty");
  if (configuredKeyHex()) {
    const out = encryptField(secret);
    if (!VERSIONED_CIPHERTEXT_RE.test(out)) throw new Error("Secret was not encrypted");
    return out;
  }
  if (process.env.NODE_ENV === "test") {
    process.env.ENCRYPTION_KEY = TEST_ONLY_KEY_HEX;
    try {
      return encryptField(secret);
    } finally {
      delete process.env.ENCRYPTION_KEY;
    }
  }
  throw new Error("ENCRYPTION_KEY is not configured; refusing to store a payment-gateway secret in plaintext");
}

/** Decrypt a stored gateway secret. Throws on a missing key or a value that is not ciphertext. */
export function decryptGatewaySecret(stored: string): string {
  if (!VERSIONED_CIPHERTEXT_RE.test(stored)) throw new Error("Stored gateway secret is not encrypted");
  if (configuredKeyHex()) return decryptField(stored);
  if (process.env.NODE_ENV === "test") {
    process.env.ENCRYPTION_KEY = TEST_ONLY_KEY_HEX;
    try {
      return decryptField(stored);
    } finally {
      delete process.env.ENCRYPTION_KEY;
    }
  }
  throw new Error("ENCRYPTION_KEY is not configured; cannot decrypt a gateway secret");
}

// ── Employee Aadhaar numbers ────────────────────────────────────────────────

/**
 * Encrypt an employee's Aadhaar number before it is stored. Null and "" pass through.
 *
 * Aadhaar should be stored encrypted or not at all, so a production server with no
 * ENCRYPTION_KEY refuses to save one instead of writing it in plain text (encryptField
 * would silently do that). Development and tests keep the plain-text fallback.
 */
export function encryptAadhaar(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return value as string | null;
  if (configuredKeyHex()) {
    const out = encryptField(value);
    if (!VERSIONED_CIPHERTEXT_RE.test(out)) throw new Error("Aadhaar number was not encrypted");
    return out;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("ENCRYPTION_KEY is not configured; refusing to store an Aadhaar number in plaintext");
  }
  return value;
}

/**
 * Decrypt a stored Aadhaar number. A value written before encryption was added (plain
 * digits) is returned as is, until the rotation tool encrypts it. A value that is
 * encrypted but that no configured key opens gives null, never the ciphertext, so a lost
 * or wrong key cannot put a ciphertext on screen as if it were the number.
 */
export function decryptAadhaar(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined || stored === "") return null;
  if (!isEncrypted(stored)) return stored;
  try {
    return decryptFieldStrict(stored);
  } catch {
    return null;
  }
}
