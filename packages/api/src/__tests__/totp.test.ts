import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateSecret,
  hotp,
  otpauthUri,
  timeStep,
  totpAt,
  verifyTotp,
} from "../lib/totp.js";

const ASCII_SECRET = Buffer.from("12345678901234567890");
const B32_SECRET = base32Encode(ASCII_SECRET);

describe("base32", () => {
  it("matches RFC 4648 vectors (no padding)", () => {
    const enc = (s: string) => base32Encode(Buffer.from(s));
    expect(enc("")).toBe("");
    expect(enc("f")).toBe("MY");
    expect(enc("fo")).toBe("MZXQ");
    expect(enc("foo")).toBe("MZXW6");
    expect(enc("foob")).toBe("MZXW6YQ");
    expect(enc("fooba")).toBe("MZXW6YTB");
    expect(enc("foobar")).toBe("MZXW6YTBOI");
  });
  it("round-trips random bytes of every length", () => {
    for (let n = 0; n < 40; n++) {
      const b = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n * 11) & 255));
      expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
    }
  });
  it("decodes tolerantly", () => {
    expect(base32Decode("mzxw 6ytb-oi==").toString()).toBe("foobar");
    expect(base32Decode("MZXW6YTBOI======").toString()).toBe("foobar");
  });
  it("rejects invalid characters", () => {
    expect(() => base32Decode("MZXW1")).toThrow();
  });
  it("generateSecret is 32 chars of base32 decoding to 20 bytes, and varies", () => {
    const s = generateSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
    expect(generateSecret()).not.toBe(s);
  });
});

describe("HOTP / TOTP (RFC vectors)", () => {
  it("RFC 4226 appendix D counters 0-9", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, i) => expect(hotp(ASCII_SECRET, i)).toBe(code));
  });
  it("RFC 6238 SHA-1 8-digit vectors", () => {
    const cases: [number, string][] = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [t, code] of cases) expect(totpAt(ASCII_SECRET, t * 1000, 30, 8)).toBe(code);
  });
  it("6-digit truncations and base32 secret input", () => {
    expect(totpAt(B32_SECRET, 59_000)).toBe("287082");
    expect(totpAt(B32_SECRET, 1111111109_000)).toBe("081804");
    expect(totpAt(B32_SECRET, 1234567890_000)).toBe("005924");
    expect(totpAt(B32_SECRET, 2000000000_000)).toBe("279037");
  });
});

describe("verifyTotp", () => {
  const now = 1_700_000_000_000;
  const step = timeStep(now);
  const at = (s: number) => hotp(B32_SECRET, s);

  it("accepts the current step and returns it", () => {
    expect(verifyTotp(B32_SECRET, at(step), { now })).toEqual({ ok: true, step });
  });
  it("accepts +-1 step, rejects +-2", () => {
    expect(verifyTotp(B32_SECRET, at(step - 1), { now })).toEqual({ ok: true, step: step - 1 });
    expect(verifyTotp(B32_SECRET, at(step + 1), { now })).toEqual({ ok: true, step: step + 1 });
    expect(verifyTotp(B32_SECRET, at(step - 2), { now }).ok).toBe(false);
    expect(verifyTotp(B32_SECRET, at(step + 2), { now }).ok).toBe(false);
  });
  it("honours a custom window", () => {
    expect(verifyTotp(B32_SECRET, at(step - 2), { now, window: 2 }).ok).toBe(true);
    expect(verifyTotp(B32_SECRET, at(step - 1), { now, window: 0 }).ok).toBe(false);
  });
  it("rejects replays at or before lastUsedStep", () => {
    expect(verifyTotp(B32_SECRET, at(step), { now, lastUsedStep: step }).ok).toBe(false);
    expect(verifyTotp(B32_SECRET, at(step - 1), { now, lastUsedStep: step }).ok).toBe(false);
    expect(verifyTotp(B32_SECRET, at(step), { now, lastUsedStep: step - 1 })).toEqual({ ok: true, step });
    expect(verifyTotp(B32_SECRET, at(step), { now, lastUsedStep: null }).ok).toBe(true);
  });
  it("normalises spaces", () => {
    const c = at(step);
    expect(verifyTotp(B32_SECRET, `${c.slice(0, 3)} ${c.slice(3)}`, { now }).ok).toBe(true);
    expect(verifyTotp(B32_SECRET, ` ${c} `, { now }).ok).toBe(true);
  });
  it("rejects wrong length, non-digits and wrong codes", () => {
    const c = at(step);
    expect(verifyTotp(B32_SECRET, c.slice(1), { now }).ok).toBe(false);
    expect(verifyTotp(B32_SECRET, c + "0", { now }).ok).toBe(false);
    expect(verifyTotp(B32_SECRET, "abcdef", { now }).ok).toBe(false);
    expect(verifyTotp(B32_SECRET, "", { now }).ok).toBe(false);
    const wrong = c === "000000" ? "000001" : "000000";
    expect([at(step - 1), at(step), at(step + 1)]).not.toContain(wrong);
    expect(verifyTotp(B32_SECRET, wrong, { now }).ok).toBe(false);
  });
});

describe("otpauthUri", () => {
  it("builds the standard URI", () => {
    const u = otpauthUri({ secret: "ABC234", accountName: "a@b.com" });
    expect(u).toBe(
      "otpauth://totp/Fintranzact:a%40b.com?secret=ABC234&issuer=Fintranzact&algorithm=SHA1&digits=6&period=30",
    );
  });
  it("URL-encodes awkward account names and issuers", () => {
    const u = otpauthUri({ secret: "ABC234", accountName: "jo smith+tag@x.in", issuer: "My Co&Sons" });
    expect(u).toContain("otpauth://totp/My%20Co%26Sons:jo%20smith%2Btag%40x.in?");
    expect(u).toContain("issuer=My%20Co%26Sons");
    const parsed = new URL(u);
    expect(parsed.searchParams.get("issuer")).toBe("My Co&Sons");
    expect(parsed.searchParams.get("secret")).toBe("ABC234");
  });
});
