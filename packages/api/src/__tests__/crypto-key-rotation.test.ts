/**
 * crypto-key-rotation.test.ts — key ids, previous-key lists, fail-closed decryption and tamper
 * detection in the field-encryption envelope (packages/db/src/crypto.ts). Design:
 * docs/security/key-rotation.md. Each test sets and clears its own environment.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import {
  decryptField,
  decryptFieldStrict,
  encryptField,
  EncryptionError,
  getCiphertextKeyId,
  getCurrentKeyId,
  getKeyVersion,
  isOnCurrentKey,
  reEncryptField,
} from "@fintranzact/db";

const KEY_A = "a1".repeat(32);
const KEY_B = "b2".repeat(32);
const KEY_C = "c3".repeat(32);
const VARS = ["ENCRYPTION_KEY", "DB_ENCRYPTION_KEY", "ENCRYPTION_KEY_ID", "ENCRYPTION_KEY_PREVIOUS", "ENCRYPTION_KEYS_PREVIOUS"];

function setEnv(env: Record<string, string>) {
  for (const v of VARS) delete process.env[v];
  Object.assign(process.env, env);
}

/** A value in the format written before key ids existed. */
function legacyV2(plain: string, keyHex: string): string {
  const iv = randomBytes(16);
  const c = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v2:${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${ct.toString("hex")}`;
}

function legacyV1(plain: string, keyHex: string): string {
  return legacyV2(plain, keyHex).replace(/^v2:/, "");
}

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
  setEnv({});
});
afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

describe("envelope with key id", () => {
  it("round-trips and records a key id that is not the key", () => {
    setEnv({ ENCRYPTION_KEY: KEY_A });
    const stored = encryptField("rzp_live_secret");
    expect(stored).toMatch(/^v3:[0-9a-f]{8}:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(getCiphertextKeyId(stored)).toBe(getCurrentKeyId());
    expect(stored).not.toContain(KEY_A);
    expect(getCurrentKeyId()).not.toContain(KEY_A.slice(0, 8));
    expect(decryptFieldStrict(stored)).toBe("rzp_live_secret");
    expect(isOnCurrentKey(stored)).toBe(true);
  });

  it("uses ENCRYPTION_KEY_ID when set and rejects a bad label", () => {
    setEnv({ ENCRYPTION_KEY: KEY_A, ENCRYPTION_KEY_ID: "2026-main" });
    const stored = encryptField("x");
    expect(stored.startsWith("v3:2026-main:")).toBe(true);
    setEnv({ ENCRYPTION_KEY: KEY_A, ENCRYPTION_KEY_ID: "bad:label" });
    expect(() => encryptField("x")).toThrow(/ENCRYPTION_KEY_ID/);
  });

  it("legacy v1 and v2 values still decrypt with the current key", () => {
    setEnv({ ENCRYPTION_KEY: KEY_A });
    expect(decryptFieldStrict(legacyV2("one", KEY_A))).toBe("one");
    expect(decryptFieldStrict(legacyV1("two", KEY_A))).toBe("two");
    expect(getKeyVersion(legacyV2("one", KEY_A))).toBe(2);
    expect(getKeyVersion(legacyV1("two", KEY_A))).toBe(1);
    expect(isOnCurrentKey(legacyV2("one", KEY_A))).toBe(false);
  });
});

describe("previous keys", () => {
  it("decrypts old values with a previous key (comma list, JSON list, single variable, labelled)", () => {
    const oldV2 = legacyV2("old", KEY_A);
    const fromA = (() => {
      setEnv({ ENCRYPTION_KEY: KEY_A, ENCRYPTION_KEY_ID: "first" });
      return encryptField("tagged");
    })();

    setEnv({ ENCRYPTION_KEY: KEY_B, ENCRYPTION_KEYS_PREVIOUS: `${KEY_C},first=${KEY_A}` });
    expect(decryptFieldStrict(oldV2)).toBe("old");
    expect(decryptFieldStrict(fromA)).toBe("tagged");

    setEnv({ ENCRYPTION_KEY: KEY_B, ENCRYPTION_KEYS_PREVIOUS: JSON.stringify([KEY_C, `first=${KEY_A}`]) });
    expect(decryptFieldStrict(fromA)).toBe("tagged");

    setEnv({ ENCRYPTION_KEY: KEY_B, ENCRYPTION_KEY_PREVIOUS: KEY_A });
    expect(decryptFieldStrict(oldV2)).toBe("old");
    expect(decryptField(oldV2)).toBe("old");
  });

  it("reEncryptField moves a value to the current key and is then a no-op", () => {
    setEnv({ ENCRYPTION_KEY: KEY_A });
    const old = encryptField("payload");
    setEnv({ ENCRYPTION_KEY: KEY_B, ENCRYPTION_KEYS_PREVIOUS: KEY_A });
    const moved = reEncryptField(old);
    expect(moved).not.toBe(old);
    expect(isOnCurrentKey(moved)).toBe(true);
    expect(reEncryptField(moved)).toBe(moved);
    // only the current key is needed now
    setEnv({ ENCRYPTION_KEY: KEY_B });
    expect(decryptFieldStrict(moved, { currentKeyOnly: true })).toBe("payload");
  });

  it("rejects malformed previous-key configuration", () => {
    setEnv({ ENCRYPTION_KEY: KEY_B, ENCRYPTION_KEYS_PREVIOUS: "not-a-key" });
    expect(() => decryptFieldStrict(legacyV2("x", KEY_A))).toThrow(/ENCRYPTION_KEYS_PREVIOUS/);
    setEnv({ ENCRYPTION_KEY: KEY_B, ENCRYPTION_KEYS_PREVIOUS: "[1,2]" });
    expect(() => decryptFieldStrict(legacyV2("x", KEY_A))).toThrow(/array of strings/);
  });
});

describe("fails closed without leaking", () => {
  it("throws when the needed previous key is missing, naming only the key id", () => {
    setEnv({ ENCRYPTION_KEY: KEY_A });
    const stored = encryptField("super-secret-value");
    setEnv({ ENCRYPTION_KEY: KEY_B });
    let message = "";
    try {
      decryptFieldStrict(stored);
    } catch (e) {
      expect(e).toBeInstanceOf(EncryptionError);
      message = (e as Error).message;
    }
    expect(message).toMatch(/no configured encryption key/);
    for (const secret of [KEY_A, KEY_B, "super-secret-value", stored]) expect(message).not.toContain(secret);
    expect(() => reEncryptField(stored)).toThrow(EncryptionError);
  });

  it("throws when no key is configured at all", () => {
    setEnv({ ENCRYPTION_KEY: KEY_A });
    const stored = encryptField("x");
    setEnv({});
    expect(() => decryptFieldStrict(stored)).toThrow(/not configured/);
  });

  it("detects tampering in every part of the envelope", () => {
    setEnv({ ENCRYPTION_KEY: KEY_A });
    const stored = encryptField("integrity matters");
    const parts = stored.split(":");
    const flip = (hex: string) => (hex[0] === "0" ? "1" : "0") + hex.slice(1);
    for (const i of [2, 3, 4]) {
      const copy = [...parts];
      copy[i] = flip(copy[i]!);
      expect(() => decryptFieldStrict(copy.join(":"))).toThrow(EncryptionError);
    }
    // a different key id label on the same bytes still fails to authenticate with the wrong key
    setEnv({ ENCRYPTION_KEY: KEY_B });
    expect(() => decryptFieldStrict(stored)).toThrow(EncryptionError);
  });

  it("decryptField keeps its lenient behaviour for existing callers", () => {
    setEnv({ ENCRYPTION_KEY: KEY_A });
    const stored = encryptField("x");
    setEnv({ ENCRYPTION_KEY: KEY_B });
    expect(decryptField(stored)).toBe(stored);
    expect(decryptField("plain text")).toBe("plain text");
  });
});
