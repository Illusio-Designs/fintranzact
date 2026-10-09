/**
 * security-headers.test.ts — the API's secure-headers middleware keeps a
 * route's own Cross-Origin-Resource-Policy.
 *
 * Regression: Hono's secureHeaders() overwrote every response's CORP with
 * "same-origin", so the business logo and signature (served "same-site") were
 * blocked in Settings when the web app runs on another origin than the API
 * (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin), found by the J11 settings journey.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { apiSecureHeaders } from "../lib/security-headers.js";

function app() {
  const a = new Hono();
  a.use("*", ...apiSecureHeaders());
  a.get("/plain", (c) => c.json({ ok: true }));
  a.get("/logo", () => new Response("png", { headers: { "Cross-Origin-Resource-Policy": "same-site" } }));
  a.get("/shared", (c) => {
    c.header("Cross-Origin-Resource-Policy", "cross-origin");
    return c.body("png");
  });
  return a;
}

describe("apiSecureHeaders", () => {
  it("defaults to same-origin and still sets the other secure headers", async () => {
    const res = await app().request("/plain");
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(res.headers.get("Strict-Transport-Security")).toMatch(/max-age=\d{7,}/);
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("limits camera, microphone and geolocation to our own origin", async () => {
    const res = await app().request("/plain");
    expect(res.headers.get("Permissions-Policy")).toBe("camera=(self), microphone=(self), geolocation=(self)");
  });

  it("keeps the policy a route set on its own Response", async () => {
    const res = await app().request("/logo");
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe("same-site");
  });

  it("keeps the policy a route set through the context", async () => {
    const res = await app().request("/shared");
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
  });
});
