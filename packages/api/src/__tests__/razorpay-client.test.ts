/**
 * The pure parts of the business-side Razorpay integration: webhook signature
 * verification, paise <-> money conversion, key id parsing/masking, method
 * mapping, the HTTP client against an injected fetch (never the real
 * Razorpay), and the fail-closed encryption of the stored secrets.
 */

import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  RazorpayApiError,
  maskKeyId,
  moneyToPaise,
  paiseToMoney,
  parseKeyId,
  razorpay,
  razorpayContact,
  razorpayEmail,
  setRazorpayFetch,
  verifyWebhookSignature,
} from "../lib/razorpay/client.js";
import { hashWebhookToken, publicApiOrigin, webhookUrl } from "../lib/razorpay/connection.js";
import { mapRazorpayMethod } from "../lib/razorpay/webhook.js";
import { decryptGatewaySecret, encryptGatewaySecret } from "../lib/field-encryption.js";

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("hex");

describe("webhook signature", () => {
  const body = JSON.stringify({ event: "payment_link.paid", payload: {} });
  const secret = "whsec_shop_owner_secret";

  it("accepts the HMAC-SHA256 of the raw body", () => {
    expect(verifyWebhookSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it("rejects a wrong secret, a changed body and a missing signature", () => {
    expect(verifyWebhookSignature(body, sign(body, "another-secret"), secret)).toBe(false);
    expect(verifyWebhookSignature(body + " ", sign(body, secret), secret)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
    expect(verifyWebhookSignature(body, "", secret)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, secret), "")).toBe(false);
  });

  it("rejects malformed signatures without throwing", () => {
    expect(verifyWebhookSignature(body, "not-hex", secret)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, secret).slice(0, 30), secret)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, secret) + "00", secret)).toBe(false);
  });

  it("is case-insensitive about the hex digits", () => {
    expect(verifyWebhookSignature(body, sign(body, secret).toUpperCase(), secret)).toBe(true);
  });
});

describe("amount conversion", () => {
  it("converts paise to the two-decimal money string", () => {
    expect(paiseToMoney(118000)).toBe("1180.00");
    expect(paiseToMoney(5)).toBe("0.05");
    expect(paiseToMoney(0)).toBe("0.00");
    expect(paiseToMoney(100)).toBe("1.00");
    expect(() => paiseToMoney(10.5)).toThrow();
  });

  it("converts money to paise exactly, with no floating point drift", () => {
    expect(moneyToPaise("1180.00")).toBe(118000);
    expect(moneyToPaise("0.29")).toBe(29);
    expect(moneyToPaise("1.1")).toBe(110);
    expect(moneyToPaise("19.99")).toBe(1999);
    expect(moneyToPaise("100")).toBe(10000);
    expect(moneyToPaise(33.1)).toBe(3310);
    expect(() => moneyToPaise("abc")).toThrow();
  });

  it("round-trips", () => {
    for (const p of [1, 99, 100, 101, 12345, 99999999]) expect(moneyToPaise(paiseToMoney(p))).toBe(p);
  });
});

describe("keys and tokens", () => {
  it("recognises Razorpay key ids and their mode", () => {
    expect(parseKeyId("rzp_test_AbCdEf123456")).toEqual({ mode: "test" });
    expect(parseKeyId(" rzp_live_AbCdEf123456 ")).toEqual({ mode: "live" });
    expect(parseKeyId("rzp_prod_AbCdEf123456")).toBeNull();
    expect(parseKeyId("sk_live_123456789")).toBeNull();
    expect(parseKeyId("")).toBeNull();
  });

  it("masks the key id to its prefix and last four characters", () => {
    expect(maskKeyId("rzp_live_AbCdEf123456")).toBe("rzp_live_••••3456");
    expect(maskKeyId("rzp_test_AbCdEf123456")).not.toContain("AbCdEf");
  });

  it("builds the per-business webhook URL and hashes the token for lookup", () => {
    const token = "11111111-2222-3333-4444-555555555555." + "a".repeat(43);
    expect(webhookUrl(token, "https://api.example.in/")).toBe(`https://api.example.in/webhooks/razorpay/business/${token}`);
    expect(hashWebhookToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashWebhookToken(token)).not.toContain("a".repeat(10));
  });

  it("derives the public API origin from forwarded headers", () => {
    const headers = new Headers({ "x-forwarded-proto": "https", "x-forwarded-host": "api.fintranzact.example" });
    expect(publicApiOrigin({ url: "http://127.0.0.1:3001/api/trpc/x", headers })).toBe("https://api.fintranzact.example");
  });
});

describe("customer details", () => {
  it("formats an Indian mobile for Razorpay and drops anything else", () => {
    expect(razorpayContact("98765 43210")).toBe("+919876543210");
    expect(razorpayContact("+91 98765-43210")).toBe("+919876543210");
    expect(razorpayContact("12345")).toBeUndefined();
    expect(razorpayContact(null)).toBeUndefined();
    expect(razorpayEmail("priya@example.in")).toBe("priya@example.in");
    expect(razorpayEmail("not an email")).toBeUndefined();
  });
});

describe("payment method mapping", () => {
  it("maps Razorpay methods to the app's payment modes", () => {
    expect(mapRazorpayMethod("upi", undefined)).toBe("upi");
    expect(mapRazorpayMethod("netbanking", undefined)).toBe("net_banking");
    expect(mapRazorpayMethod("wallet", undefined)).toBe("wallet");
    expect(mapRazorpayMethod("card", "credit")).toBe("credit_card");
    expect(mapRazorpayMethod("card", "debit")).toBe("debit_card");
    expect(mapRazorpayMethod("card", "prepaid")).toBe("debit_card");
    expect(mapRazorpayMethod("card", undefined)).toBe("credit_card");
    expect(mapRazorpayMethod("emi", undefined)).toBe("credit_card");
    expect(mapRazorpayMethod("paylater", undefined)).toBe("other");
    expect(mapRazorpayMethod(undefined, undefined)).toBe("other");
  });
});

describe("Razorpay HTTP client (injected fetch)", () => {
  afterEach(() => setRazorpayFetch(null));
  const creds = { keyId: "rzp_test_OwnerKey1234", keySecret: "owner_secret_value" };

  it("authenticates with the keys it is given and nothing else", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_live_PLATFORMKEY";
    process.env.RAZORPAY_KEY_SECRET = "platform_secret";
    let auth = "";
    setRazorpayFetch(async (_url, init) => {
      auth = String(((init?.headers ?? {}) as Record<string, string>).Authorization);
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    await razorpay.testConnection(creds);
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    expect(Buffer.from(auth.replace("Basic ", ""), "base64").toString()).toBe("rzp_test_OwnerKey1234:owner_secret_value");
  });

  it("turns an API error into RazorpayApiError without leaking credentials", async () => {
    setRazorpayFetch(async () => new Response(JSON.stringify({ error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } }), { status: 401 }));
    const err = await razorpay.testConnection(creds).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(RazorpayApiError);
    expect(err.isAuthError).toBe(true);
    expect(JSON.stringify({ m: err.message, d: err.description })).not.toContain("owner_secret_value");
  });

  it("reports a network failure as status 0", async () => {
    setRazorpayFetch(async () => {
      throw new Error("ECONNRESET with Authorization: Basic abc");
    });
    const err = await razorpay.testConnection(creds).then(() => null, (e) => e);
    expect(err.status).toBe(0);
    expect(err.message).not.toContain("Basic");
  });

  it("creates a link for the given paise with partial payments allowed and no Razorpay-side messaging", async () => {
    let sent: Record<string, unknown> = {};
    setRazorpayFetch(async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "plink_1", short_url: "https://rzp.io/i/x", status: "created", amount: sent.amount }), { status: 200 });
    });
    await razorpay.createPaymentLink(creds, {
      amountPaise: 118000,
      referenceId: "INV-00001",
      description: "Invoice INV-00001",
      customer: { name: "Priya", contact: "+919123456780" },
      callbackUrl: "https://app.example.in/i/token",
      notes: { invoice_id: "x" },
      firstMinPartialPaise: 100,
    });
    expect(sent).toMatchObject({
      amount: 118000,
      currency: "INR",
      accept_partial: true,
      first_min_partial_amount: 100,
      reference_id: "INV-00001",
      notify: { sms: false, email: false },
      reminder_enable: false,
      callback_url: "https://app.example.in/i/token",
    });
  });
});

describe("encrypted secrets", () => {
  it("round-trips a key secret and never stores plaintext", () => {
    const stored = encryptGatewaySecret("my-razorpay-key-secret");
    expect(stored).not.toContain("my-razorpay-key-secret");
    expect(stored).toMatch(/^v\d+:(?:[\w-]+:)?[0-9a-f]+:[0-9a-f]+:[0-9a-f]*$/i);
    expect(decryptGatewaySecret(stored)).toBe("my-razorpay-key-secret");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptGatewaySecret("same")).not.toBe(encryptGatewaySecret("same"));
  });

  it("refuses to decrypt something that is not ciphertext, and to encrypt nothing", () => {
    expect(() => decryptGatewaySecret("plain-text-secret")).toThrow();
    expect(() => encryptGatewaySecret("")).toThrow();
  });

  it("fails closed outside tests when no ENCRYPTION_KEY is configured", () => {
    const env = { NODE_ENV: process.env.NODE_ENV, key: process.env.ENCRYPTION_KEY, alias: process.env.DB_ENCRYPTION_KEY };
    delete process.env.ENCRYPTION_KEY;
    delete process.env.DB_ENCRYPTION_KEY;
    process.env.NODE_ENV = "production";
    try {
      expect(() => encryptGatewaySecret("secret")).toThrow(/ENCRYPTION_KEY/);
    } finally {
      process.env.NODE_ENV = env.NODE_ENV;
      if (env.key !== undefined) process.env.ENCRYPTION_KEY = env.key;
      if (env.alias !== undefined) process.env.DB_ENCRYPTION_KEY = env.alias;
    }
  });
});
