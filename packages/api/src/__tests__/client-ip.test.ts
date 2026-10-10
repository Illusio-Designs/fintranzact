/**
 * client-ip.test.ts — which address the app treats as the visitor's.
 */

import { describe, it, expect } from "vitest";
import { clientIpFromHeaders } from "../lib/client-ip.js";

type Env = Record<string, string | undefined>;
const ip = (headers: Record<string, string>, env: Env = {}) =>
  clientIpFromHeaders((name) => headers[name], env as NodeJS.ProcessEnv);

describe("defaults (unchanged behaviour)", () => {
  it("prefers cf-connecting-ip, trimmed", () => {
    expect(ip({ "cf-connecting-ip": "  203.0.113.7 ", "x-forwarded-for": "1.1.1.1, 2.2.2.2" })).toBe("203.0.113.7");
  });

  it("takes the LAST x-forwarded-for entry, never the first (the client controls the first)", () => {
    expect(ip({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 203.0.113.9" })).toBe("203.0.113.9");
    expect(ip({ "x-forwarded-for": "::1, 2001:db8::1" })).toBe("2001:db8::1");
  });

  it("returns null with no usable header", () => {
    expect(ip({})).toBeNull();
    expect(ip({ "x-forwarded-for": "" })).toBeNull();
    expect(ip({ "x-forwarded-for": " , , " })).toBeNull();
  });
});

describe("TRUST_CF_CONNECTING_IP", () => {
  it("false or 0 ignores a cf-connecting-ip header a client can forge", () => {
    for (const v of ["false", "FALSE", "0", " false "]) {
      expect(ip({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "203.0.113.5" }, { TRUST_CF_CONNECTING_IP: v })).toBe("203.0.113.5");
    }
  });

  it("anything else keeps trusting it", () => {
    for (const v of [undefined, "", "true", "1", "yes"]) {
      expect(ip({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "203.0.113.5" }, { TRUST_CF_CONNECTING_IP: v })).toBe("9.9.9.9");
    }
  });
});

describe("TRUSTED_PROXY_HOPS", () => {
  const xff = "6.6.6.6, 198.51.100.20, 130.176.1.1";

  it("skips that many entries from the right", () => {
    expect(ip({ "x-forwarded-for": xff }, { TRUSTED_PROXY_HOPS: "1" })).toBe("198.51.100.20");
    expect(ip({ "x-forwarded-for": xff }, { TRUSTED_PROXY_HOPS: "2" })).toBe("6.6.6.6");
  });

  it("gives null when it would skip every entry", () => {
    expect(ip({ "x-forwarded-for": xff }, { TRUSTED_PROXY_HOPS: "3" })).toBeNull();
    expect(ip({ "x-forwarded-for": xff }, { TRUSTED_PROXY_HOPS: "10" })).toBeNull();
  });

  it("ignores a value that is not a whole number, and caps a huge one", () => {
    for (const v of ["abc", "-1", "1.5", "", " "]) expect(ip({ "x-forwarded-for": xff }, { TRUSTED_PROXY_HOPS: v })).toBe("130.176.1.1");
    expect(ip({ "x-forwarded-for": xff }, { TRUSTED_PROXY_HOPS: "99999" })).toBeNull();
  });
});

describe("TRUSTED_PROXY_CIDRS", () => {
  const env = { TRUSTED_PROXY_CIDRS: "130.176.0.0/16, 2600:9000::/28, 15.158.1.1" };

  it("finds the visitor behind a trusted proxy, and also on a direct request", () => {
    // CloudFront -> load balancer: [..., visitor, CloudFront edge]
    expect(ip({ "x-forwarded-for": "198.51.100.20, 130.176.3.4" }, env)).toBe("198.51.100.20");
    // straight to the load balancer: [..., visitor]
    expect(ip({ "x-forwarded-for": "198.51.100.20" }, env)).toBe("198.51.100.20");
  });

  it("skips several trusted proxies in a row, IPv6 and single addresses included", () => {
    expect(ip({ "x-forwarded-for": "198.51.100.20, 130.176.3.4, 2600:9000:1::1, 15.158.1.1" }, env)).toBe("198.51.100.20");
  });

  it("does not let a client choose its address by writing entries at the front", () => {
    expect(ip({ "x-forwarded-for": "1.2.3.4, 130.176.0.9, 198.51.100.20, 130.176.3.4" }, env)).toBe("198.51.100.20");
    // a forged trusted-looking address at the front changes nothing when the real one is the first from the right
    expect(ip({ "x-forwarded-for": "130.176.0.9, 198.51.100.20" }, env)).toBe("198.51.100.20");
  });

  it("an address just outside the range is not trusted", () => {
    expect(ip({ "x-forwarded-for": "198.51.100.20, 130.177.0.1" }, env)).toBe("130.177.0.1");
  });

  it("an entry that is not an address is never skipped", () => {
    expect(ip({ "x-forwarded-for": "198.51.100.20, not-an-ip" }, env)).toBe("not-an-ip");
  });

  it("gives null when every entry is a trusted proxy", () => {
    expect(ip({ "x-forwarded-for": "130.176.0.1, 130.176.0.2" }, env)).toBeNull();
  });

  it("ignores malformed entries rather than trusting more", () => {
    const bad = { TRUSTED_PROXY_CIDRS: "garbage, 10.0.0.0/99, 10.0.0.0/x, ::/200, , 130.176.0.0/16" };
    expect(ip({ "x-forwarded-for": "10.1.2.3, 130.176.0.1" }, bad)).toBe("10.1.2.3");
    expect(ip({ "x-forwarded-for": "198.51.100.20" }, { TRUSTED_PROXY_CIDRS: "garbage" })).toBe("198.51.100.20");
  });

  it("combines with hops: hops first, then the trusted ranges", () => {
    expect(ip({ "x-forwarded-for": "198.51.100.20, 130.176.3.4, 203.0.113.50" }, { ...env, TRUSTED_PROXY_HOPS: "1" })).toBe("198.51.100.20");
  });

  it("works together with TRUST_CF_CONNECTING_IP=false on the AWS setup", () => {
    expect(ip({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "198.51.100.20, 130.176.3.4" }, { ...env, TRUST_CF_CONNECTING_IP: "false" })).toBe("198.51.100.20");
  });
});
