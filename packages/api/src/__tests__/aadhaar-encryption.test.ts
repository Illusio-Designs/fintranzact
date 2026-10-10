/**
 * aadhaar-encryption.test.ts — the encrypt/decrypt helpers for employee Aadhaar numbers.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { isEncrypted } from "@fintranzact/db";
import { encryptAadhaar, decryptAadhaar, encryptSensitive, decryptSensitive, ensureEncrypted, encryptPan, encryptBankAccount } from "../lib/field-encryption.js";

const KEY_A = "aa".repeat(32);
const KEY_B = "bb".repeat(32);
const AADHAAR = "234567890123";

afterEach(() => vi.unstubAllEnvs());

describe("encryptAadhaar / decryptAadhaar", () => {
  it("round-trips and does not leave the digits in the stored value", () => {
    vi.stubEnv("ENCRYPTION_KEY", KEY_A);
    const stored = encryptAadhaar(AADHAAR)!;
    expect(isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain(AADHAAR);
    expect(decryptAadhaar(stored)).toBe(AADHAAR);
  });

  it("uses a fresh IV each time", () => {
    vi.stubEnv("ENCRYPTION_KEY", KEY_A);
    expect(encryptAadhaar(AADHAAR)).not.toBe(encryptAadhaar(AADHAAR));
  });

  it("passes null and blank through in both directions", () => {
    vi.stubEnv("ENCRYPTION_KEY", KEY_A);
    expect(encryptAadhaar(null)).toBeNull();
    expect(encryptAadhaar(undefined)).toBeUndefined();
    expect(encryptAadhaar("")).toBe("");
    expect(decryptAadhaar(null)).toBeNull();
    expect(decryptAadhaar(undefined)).toBeNull();
    expect(decryptAadhaar("")).toBeNull();
  });

  it("returns a legacy plain-digit value as is", () => {
    vi.stubEnv("ENCRYPTION_KEY", KEY_A);
    expect(decryptAadhaar(AADHAAR)).toBe(AADHAAR);
  });

  it("gives null, never the ciphertext, when no configured key opens it", () => {
    vi.stubEnv("ENCRYPTION_KEY", KEY_A);
    const stored = encryptAadhaar(AADHAAR)!;
    vi.stubEnv("ENCRYPTION_KEY", KEY_B);
    expect(decryptAadhaar(stored)).toBeNull();
    vi.stubEnv("ENCRYPTION_KEY", "");
    vi.stubEnv("DB_ENCRYPTION_KEY", "");
    expect(decryptAadhaar(stored)).toBeNull();
  });

  it("a rejected tamper gives null", () => {
    vi.stubEnv("ENCRYPTION_KEY", KEY_A);
    const stored = encryptAadhaar(AADHAAR)!;
    const parts = stored.split(":");
    parts[parts.length - 1] = parts[parts.length - 1]!.replace(/^./, (c) => (c === "0" ? "1" : "0"));
    expect(decryptAadhaar(parts.join(":"))).toBeNull();
  });

  it("a production server with no key refuses to store one; development keeps plain text", () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    vi.stubEnv("DB_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => encryptAadhaar(AADHAAR)).toThrow(/refusing to store an Aadhaar number in plaintext/);
    vi.stubEnv("NODE_ENV", "development");
    expect(encryptAadhaar(AADHAAR)).toBe(AADHAAR);
  });
});

describe("encryptSensitive / decryptSensitive / ensureEncrypted (PAN and bank numbers)", () => {
  it("round-trips PAN and bank account numbers", () => {
    vi.stubEnv("ENCRYPTION_KEY", KEY_A);
    for (const [enc, plain] of [[encryptPan, "ABCDE1234F"], [encryptBankAccount, "50100123456789"]] as const) {
      const stored = enc(plain)!;
      expect(isEncrypted(stored)).toBe(true);
      expect(stored).not.toContain(plain);
      expect(decryptSensitive(stored)).toBe(plain);
    }
  });

  it("the Aadhaar helpers are the same implementation", () => {
    vi.stubEnv("ENCRYPTION_KEY", KEY_A);
    expect(decryptAadhaar(encryptSensitive(AADHAAR))).toBe(AADHAAR);
    expect(decryptSensitive(encryptAadhaar(AADHAAR))).toBe(AADHAAR);
  });

  it("names what it refused to store in the production error", () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    vi.stubEnv("DB_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => encryptPan("ABCDE1234F")).toThrow(/refusing to store a PAN in plaintext/);
    expect(() => encryptBankAccount("50100123456789")).toThrow(/refusing to store a bank account number in plaintext/);
  });

  it("ensureEncrypted leaves ciphertext alone, encrypts plain text and passes empty values through", () => {
    vi.stubEnv("ENCRYPTION_KEY", KEY_A);
    const stored = encryptSensitive("50100123456789")!;
    expect(ensureEncrypted(stored)).toBe(stored);
    const fresh = ensureEncrypted("50100123456789")!;
    expect(isEncrypted(fresh)).toBe(true);
    expect(decryptSensitive(fresh)).toBe("50100123456789");
    expect(ensureEncrypted(null)).toBeNull();
    expect(ensureEncrypted("")).toBe("");
  });

  it("ensureEncrypted keeps a value no key opens as it is (it never wraps ciphertext in ciphertext)", () => {
    vi.stubEnv("ENCRYPTION_KEY", KEY_A);
    const stored = encryptSensitive("50100123456789")!;
    vi.stubEnv("ENCRYPTION_KEY", KEY_B);
    expect(ensureEncrypted(stored)).toBe(stored);
  });
});
