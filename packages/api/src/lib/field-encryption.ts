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

import { encryptField, decryptField } from "@fintranzact/db";

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
