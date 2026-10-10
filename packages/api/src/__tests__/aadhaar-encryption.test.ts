/**
 * aadhaar-encryption.test.ts — the encrypt/decrypt helpers for employee Aadhaar numbers.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { isEncrypted } from "@fintranzact/db";
import { encryptAadhaar, decryptAadhaar } from "../lib/field-encryption.js";

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
