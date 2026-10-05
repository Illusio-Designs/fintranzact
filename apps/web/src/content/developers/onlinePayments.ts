import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

export const onlinePaymentsEndpoints: EndpointGroup = {
  id: "online-payments",
  title: "Online Payments",
  description: "Let customers pay a business's invoices online through Razorpay payment links. Each business connects ITS OWN Razorpay account by pasting its API keys in Settings, Online payments: customer money goes straight to that business's Razorpay account and bank, never through the platform's own Razorpay account (which is used only for Fintranzact subscription billing). The key id, key secret and webhook secret are encrypted at rest and are never returned by any endpoint; `getSettings` shows only a masked key id. Only owners and admins can manage keys. A payment link always asks for the invoice's balance due, which the server works out from the database (total less payments and credit notes or returns): the client never sends an amount. The business adds a per-business webhook URL in its Razorpay dashboard; verified `payment_link.paid`, `payment_link.partially_paid` and `payment.captured` events record a payment against the invoice (deduplicated by Razorpay payment id), including the gateway charge when the business keeps a payment gateway account named Razorpay. Read-only organisations cannot connect keys or make new links, but a payment a customer already made is still recorded.",
  endpoints: [
    {
      id: "online-payments-get-settings",
      method: "query",
      path: "onlinePayments.getSettings",
      title: "Get Online Payments Settings",
      description: "The business's Razorpay connection as the settings page may see it: whether it is connected, the masked key id, the mode, whether a webhook secret is saved, and the webhook URL to add in the business's own Razorpay dashboard (Settings, Webhooks) with the events to tick.",
      auth: "business",
      requiredRole: "admin",
      input: [],
      output: {
        description: "No key, key secret, webhook secret or bare token is ever returned. `webhookUrl` is unique to the business (`<tenantId>.<random token>` in the path). `lastTestOk` is the outcome of the last `testConnection`.",
        example: {
          connected: true,
          keyIdMasked: "rzp_live_••••AbCd",
          mode: "live",
          hasWebhookSecret: true,
          webhookUrl: "https://api.example.com/webhooks/razorpay/business/6f1c2d3e-0000-4000-8000-000000000000.q9Xw3v0Jb2kT8sYpLr5mN1cHfZ7aE4uD6gRiVoKjB0s",
          webhookEvents: ["payment_link.paid", "payment_link.partially_paid", "payment_link.cancelled", "payment_link.expired", "payment.captured", "payment.failed"],
          lastTestedAt: "2026-10-05T07:00:00.000Z",
          lastTestOk: true,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/onlinePayments.getSettings" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const s = await trpc.onlinePayments.getSettings.query();
if (s.connected) console.log(s.keyIdMasked, s.webhookUrl);`,
      },
      gotchas: [
        "Requires `Business:manage` permission (owner and admin only).",
        "The webhook URL is a secret-like address: do not share it.",
      ],
      relatedEndpoints: ["online-payments-connect", "online-payments-test-connection"],
    },
    {
      id: "online-payments-connect",
      method: "mutation",
      path: "onlinePayments.connect",
      title: "Connect Razorpay",
      description: "Save the business's own Razorpay keys. Keys are validated for shape (`rzp_test_` or `rzp_live_`), encrypted and stored. The webhook token is created once and kept when keys are re-saved, so the URL already added in Razorpay keeps working. A blank `webhookSecret` on a re-save keeps the stored one. Audit entry `onlinePayments.connect` (masked key id and mode only, never a secret).",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "keyId", type: "string", required: true, description: "Razorpay key id, `rzp_test_...` or `rzp_live_...`" },
        { name: "keySecret", type: "string", required: true, description: "Razorpay key secret" },
        { name: "webhookSecret", type: "string", required: false, description: "The secret the owner entered when adding the webhook in the Razorpay dashboard" },
      ],
      output: {
        description: "Same shape as `getSettings`, plus the connection `id`. Secrets are not echoed.",
        example: { id: "b3f1c2a4-1111-4222-8333-444455556666", connected: true, keyIdMasked: "rzp_live_••••AbCd", mode: "live", hasWebhookSecret: true, webhookUrl: "https://api.example.com/webhooks/razorpay/business/…" },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/onlinePayments.connect" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"keyId":"rzp_live_XXXXXXXXXXXX","keySecret":"YOUR_KEY_SECRET","webhookSecret":"YOUR_WEBHOOK_SECRET"}}'`,
        javascript: `await trpc.onlinePayments.connect.mutate({ keyId, keySecret, webhookSecret });`,
      },
      gotchas: [
        "Requires `Business:manage` permission. Refused with 403 while the organisation is read-only.",
        "BAD_REQUEST when the key id is not a Razorpay key id.",
        "Saving new keys clears the last test result; run `testConnection` again.",
      ],
      relatedEndpoints: ["online-payments-get-settings", "online-payments-test-connection", "online-payments-disconnect"],
    },
    {
      id: "online-payments-test-connection",
      method: "mutation",
      path: "onlinePayments.testConnection",
      title: "Test Razorpay Connection",
      description: "Call Razorpay with the stored keys (a read of the payment links list, which also shows Payment Links is enabled on the account) and remember the outcome. A mutation only because it calls an external service, so it stays open in read-only mode.",
      auth: "business",
      requiredRole: "admin",
      input: [],
      output: {
        description: "`ok` and a message safe to show to the owner (never contains the keys).",
        example: { ok: true, message: "Connected. Razorpay accepted your keys." },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/onlinePayments.testConnection" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" -d '{"json":null}'`,
        javascript: `const { ok, message } = await trpc.onlinePayments.testConnection.mutate();`,
      },
      gotchas: ["Requires `Business:manage` permission."],
      relatedEndpoints: ["online-payments-connect"],
    },
    {
      id: "online-payments-disconnect",
      method: "mutation",
      path: "onlinePayments.disconnect",
      title: "Disconnect Razorpay",
      description: "Delete the stored keys and cancel the business's active payment links (on Razorpay while the keys still exist, and locally). Payments already recorded stay. Open in read-only mode (revoking credentials is never refused). Audit entry `onlinePayments.disconnect`.",
      auth: "business",
      requiredRole: "admin",
      input: [],
      output: { description: "`removed` is false when nothing was connected.", example: { removed: true } },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/onlinePayments.disconnect" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" -d '{"json":null}'`,
        javascript: `await trpc.onlinePayments.disconnect.mutate();`,
      },
      gotchas: ["Requires `Business:manage` permission.", "The webhook URL stops resolving once the connection is gone."],
      relatedEndpoints: ["online-payments-connect"],
    },
    {
      id: "online-payments-invoice-link",
      method: "query",
      path: "onlinePayments.invoiceLink",
      title: "Get Invoice Payment Link",
      description: "Whether an invoice can be paid online, its balance due, and its active payment link if it has one. A link whose amount no longer matches the balance has `current: false` and is replaced the next time one is made.",
      auth: "business",
      requiredRole: "viewer",
      input: [{ name: "invoiceId", type: "string (UUID)", required: true, description: "A sales invoice of this business" }],
      output: {
        description: "`canPay` is false when Razorpay is not connected or the invoice is a draft, cancelled, paid, not a sales invoice, or has under ₹1 due; `reason` says why.",
        example: { connected: true, canPay: true, reason: null, balance: "1180.00", link: { url: "https://rzp.io/i/abc123", amount: "1180.00", current: true, createdAt: "2026-10-05T07:00:00.000Z" } },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/onlinePayments.invoiceLink?input=%7B%22json%22%3A%7B%22invoiceId%22%3A%22INVOICE_ID%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { canPay, link } = await trpc.onlinePayments.invoiceLink.query({ invoiceId });`,
      },
      gotchas: ["Requires `Invoice:read` permission.", "NOT_FOUND for another business's invoice."],
      relatedEndpoints: ["online-payments-create-invoice-link"],
    },
    {
      id: "online-payments-create-invoice-link",
      method: "mutation",
      path: "onlinePayments.createInvoiceLink",
      title: "Create Invoice Payment Link",
      description: "Create (or reuse) a Razorpay payment link for the invoice's current balance due, on the business's own Razorpay account. The amount is worked out on the server in paise from the database; the link carries the invoice id, number and business id in its notes, uses the invoice number as `reference_id`, and sends the customer back to the invoice's share page after paying. Idempotent: with the balance unchanged the same link is returned (`created: false`); with the balance changed a new link is made and the old one cancelled on Razorpay. Part payments are accepted. Razorpay is told not to message the customer; the business sends the link itself. Audit entry `onlinePayments.createLink` when a link is made.",
      auth: "business",
      requiredRole: "member",
      input: [{ name: "invoiceId", type: "string (UUID)", required: true, description: "A sales invoice of this business" }],
      output: {
        description: "`url` is the Razorpay short link; `amount` the balance due it asks for.",
        example: { url: "https://rzp.io/i/abc123", amount: "1180.00", created: true, invoiceId: "0b1c2d3e-0000-4000-8000-000000000001" },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/onlinePayments.createInvoiceLink" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"invoiceId":"INVOICE_ID"}}'`,
        javascript: `const { url } = await trpc.onlinePayments.createInvoiceLink.mutate({ invoiceId });`,
      },
      gotchas: [
        "Requires `Payment:create` permission. Refused with 403 while the organisation is read-only.",
        "PRECONDITION_FAILED when Razorpay is not connected, or the invoice is a draft, cancelled, paid, not a sales invoice, or under ₹1 due.",
        "BAD_GATEWAY when Razorpay could not create the link; nothing is stored in that case.",
        "Creating the link also creates the invoice's public share link, which Razorpay returns the customer to.",
      ],
      relatedEndpoints: ["online-payments-invoice-link", "share-public-pay"],
    },
    {
      id: "online-payments-webhook",
      method: "mutation",
      path: "POST /webhooks/razorpay/business/:token",
      title: "Webhook: Business Razorpay Events",
      description: "Raw HTTP endpoint (not tRPC) that Razorpay calls on the BUSINESS's own account. The token in the path identifies the business so its own webhook secret is used; the body is verified with `X-Razorpay-Signature` (hex HMAC-SHA256 of the raw body, constant-time compare). A bad token, no saved secret and a bad signature all answer the same generic 401. Not to be confused with `POST /webhooks/razorpay`, which is the platform's own subscription billing. `payment_link.paid`, `payment_link.partially_paid` and `payment.captured` record a payment for the amount actually paid (paise converted to rupees), against the invoice named by the link, once per Razorpay payment id: the payment number is generated, the Razorpay payment id is stored as the reference, the method maps to a payment mode (card credit/debit, UPI, net banking, wallet), the invoice status is recomputed (paid or partial) and, when the business keeps an active payment gateway account named Razorpay, the deposit, the gateway charge (the fee Razorpay reports, else the account's configured rate) and the settlement are booked like any gateway payment. A payment above the balance is recorded in full and only the balance is allocated to the invoice. `payment_link.expired` and `payment_link.cancelled` clear the active link; `payment.failed` changes nothing.",
      auth: "public",
      input: [
        { name: "token", type: "string (path)", required: true, description: "The per-business token from the webhook URL shown in Settings, Online payments" },
        { name: "X-Razorpay-Signature", type: "string (header)", required: true, description: "Hex HMAC-SHA256 of the raw request body with the business's webhook secret" },
      ],
      output: {
        description: "`200 { ok: true }` once handled (including duplicates and events that are not for the business's invoices). 401 `{ error: \"Invalid request\" }` for any token or signature problem, 400 for a body that is not JSON, 429 when rate limited, 500 when handling failed (Razorpay redelivers; recording is idempotent).",
        example: { ok: true },
      },
      codeExamples: {
        curl: `# Razorpay sends this; shown for reference only
curl -X POST "${API_BASE_URL}/webhooks/razorpay/business/TENANT_ID.TOKEN" \\
  -H "X-Razorpay-Signature: HEX_HMAC_SHA256" \\
  -H "Content-Type: application/json" \\
  -d '{"event":"payment_link.paid","payload":{"payment":{"entity":{"id":"pay_123","amount":118000,"currency":"INR","status":"captured","method":"upi"}},"payment_link":{"entity":{"id":"plink_123","status":"paid"}}}}'`,
        javascript: `// Verify like Razorpay does (Node):
import { createHmac, timingSafeEqual } from "node:crypto";
const expected = createHmac("sha256", webhookSecret).update(rawBody).digest();
const ok = timingSafeEqual(Buffer.from(signature, "hex"), expected);`,
      },
      gotchas: [
        "Events are recorded even when the organisation is read-only (the customer has already paid); a suspended organisation's token does not resolve.",
        "A payment for an invoice that was cancelled or deleted, or in a locked period, is not booked: an audit entry `razorpay.payment.unrecorded` is left for the owner.",
        "The webhook URL and secret are per business: never reuse the platform's webhook.",
      ],
      relatedEndpoints: ["online-payments-create-invoice-link"],
    },
  ],
};
