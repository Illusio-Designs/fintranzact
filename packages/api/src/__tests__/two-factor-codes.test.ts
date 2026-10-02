import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BACKUP_CODE_ALPHABET,
  constantTimeEqualHex,
  generateBackupCodes,
  hashBackupCode,
  hashOpaqueToken,
  matchesAnyBackupHash,
  newOpaqueToken,
  normalizeBackupCode,
} from "../lib/two-factor-codes.js";
import { decryptTotpSecret, encryptTotpSecret } from "../lib/field-encryption.js";

afterEach(() => vi.unstubAllEnvs());

describe("backup codes", () => {
  it("generates 10 unique XXXXXX-XXXXXX codes from the unambiguous alphabet", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z2-9]{6}-[A-Z2-9]{6}$/);
      for (const ch of c.replace("-", "")) expect(BACKUP_CODE_ALPHABET).toContain(ch);
      expect(c).not.toMatch(/[01OILU]/);
    }
  });
  it("carries at least 50 bits of entropy", () => {
    expect(12 * Math.log2(BACKUP_CODE_ALPHABET.length)).toBeGreaterThanOrEqual(50);
    expect(new Set(BACKUP_CODE_ALPHABET).size).toBe(BACKUP_CODE_ALPHABET.length);
  });
  it("honours n", () => {
    expect(generateBackupCodes(3)).toHaveLength(3);
  });
  it("normalises case, spaces, dashes and punctuation", () => {
    expect(normalizeBackupCode(" abcde-fghjk ")).toBe("ABCDEFGHJK");
    expect(normalizeBackupCode("abc.de_fg hjk")).toBe("ABCDEFGHJK");
  });
  it("hashes deterministically and input-format-insensitively", () => {
    const h = hashBackupCode("ABCDEF-GHJKMN");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBackupCode("abcdef ghjkmn")).toBe(h);
    expect(hashBackupCode("ABCDEF-GHJKMP")).not.toBe(h);
  });
  it("hash depends on the server key", () => {
    const a = hashBackupCode("ABCDEF-GHJKMN");
    vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
    const b = hashBackupCode("ABCDEF-GHJKMN");
    expect(b).not.toBe(a);
    expect(hashBackupCode("ABCDEF-GHJKMN")).toBe(b);
  });
  it("fails closed without a key outside tests", () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    vi.stubEnv("DB_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => hashBackupCode("ABCDEF-GHJKMN")).toThrow(/ENCRYPTION_KEY/);
  });
  it("matches against a stored list in constant time", () => {
    const codes = generateBackupCodes(3);
    const hashes = codes.map(hashBackupCode);
    expect(matchesAnyBackupHash(codes[1].toLowerCase(), hashes)).toBe(true);
    expect(matchesAnyBackupHash("ZZZZZZ-ZZZZZZ", hashes)).toBe(false);
    expect(constantTimeEqualHex("aa", "aaa")).toBe(false);
    expect(constantTimeEqualHex("aa", "aa")).toBe(true);
  });
});

describe("opaque tokens", () => {
  it("are 32 random bytes as base64url, and hash to sha256 hex", () => {
    const t = newOpaqueToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newOpaqueToken()).not.toBe(t);
    expect(hashOpaqueToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOpaqueToken(t)).toBe(hashOpaqueToken(t));
    expect(hashOpaqueToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("TOTP secret encryption (fail-closed)", () => {
  it("round-trips with a configured key and never stores plaintext", () => {
    vi.stubEnv("ENCRYPTION_KEY", "cd".repeat(32));
    const enc = encryptTotpSecret("JBSWY3DPEHPK3PXP");
    expect(enc).not.toContain("JBSWY3DPEHPK3PXP");
    expect(enc).toMatch(/^v\d+:/);
    expect(decryptTotpSecret(enc)).toBe("JBSWY3DPEHPK3PXP");
  });
  it("throws without a key outside tests", () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    vi.stubEnv("DB_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => encryptTotpSecret("JBSWY3DPEHPK3PXP")).toThrow(/ENCRYPTION_KEY/);
    expect(() => decryptTotpSecret("v2:00:00:00")).toThrow(/ENCRYPTION_KEY/);
  });
  it("works with the built-in test key under NODE_ENV=test and still encrypts", () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    vi.stubEnv("DB_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "test");
    const enc = encryptTotpSecret("JBSWY3DPEHPK3PXP");
    expect(enc).toMatch(/^v\d+:/);
    expect(decryptTotpSecret(enc)).toBe("JBSWY3DPEHPK3PXP");
    expect(process.env.ENCRYPTION_KEY ?? "").toBe("");
  });
  it("refuses a stored value that is not ciphertext", () => {
    vi.stubEnv("ENCRYPTION_KEY", "cd".repeat(32));
    expect(() => decryptTotpSecret("JBSWY3DPEHPK3PXP")).toThrow(/not encrypted/);
  });
  it("refuses an empty secret", () => {
    expect(() => encryptTotpSecret("")).toThrow();
  });
});
