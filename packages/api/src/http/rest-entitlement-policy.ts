/**
 * The entitlement decision for EVERY REST route outside tRPC (server.ts and
 * http/*.ts). Pure data, no imports, so a unit test can read it without a
 * database. rest-entitlement-policy.test.ts scans the route registrations in
 * the source and fails when a route is missing from this table (or a stale
 * row names a route that no longer exists), so a new endpoint cannot ship
 * without someone deciding what a read-only or suspended organisation may do.
 *
 * Policies:
 *  read             Tenant-scoped GET (PDF, image, preview). Allowed in
 *                   read-only mode. A suspended organisation is refused
 *                   (authorizePdfRequest or the same inline check).
 *  exempt-download  Generates a document for download from a POST/owner-scoped
 *                   route. Allowed in read-only mode; suspended refused where
 *                   the route is tenant-scoped (labels), by design allowed for
 *                   the billing owner's own Finvera invoices.
 *  write-gated      Creates or edits business data. Refused while read-only or
 *                   suspended with HTTP 403 { error, entitlement } via
 *                   refuseIfReadOnly. The one session-authenticated route that
 *                   uses it is the AI assistant's streaming answer (it saves chat
 *                   history and the usage ledger, and add-ons are off while
 *                   read-only); the other REST writes are signed-token or public.
 *  signed-token     Authenticated by a signed export/import token. Export is
 *                   allowed in read-only mode (needs the plan's dataExport
 *                   flag; suspended organisations get a 404). Import is a
 *                   write: refused with refuseIfReadOnly.
 *  public-neutral   Public, unauthenticated, tenant-resolved (store, share
 *                   links). A read-only or suspended organisation answers
 *                   with the same neutral 404 as an unknown slug/token, so
 *                   visitors never see billing wording.
 *  exempt-webhook   Server-to-server. Razorpay is ALWAYS processed (it is how
 *                   payment recovers a tenant). The shipping webhook keeps
 *                   accepting events for read-only organisations (dropping
 *                   carrier updates would lose data) and refuses suspended
 *                   ones (they are not in the active-tenant lookup: 404).
 *  exempt-auth      Sign-in style routes. None today: auth is tRPC (auth.*).
 *  public-static    No tenant data at all (health, plan list, UPI redirect).
 *  trpc-gated       The tRPC mount: entitlementGate in trpc.ts decides per
 *                   procedure (see lib/entitlement-exempt.ts).
 *
 * API keys are only accepted by the tRPC context (context.ts refuses them for
 * suspended/read-only-expired tenants via apiKeyUsable); no REST route reads
 * an API key.
 */

export type RestEntitlementPolicy =
  | "read"
  | "exempt-download"
  | "write-gated"
  | "signed-token"
  | "public-neutral"
  | "exempt-webhook"
  | "exempt-auth"
  | "public-static"
  | "trpc-gated";

/** Key format: "METHOD /path" exactly as registered (ALL for the tRPC mount). */
export const REST_ENTITLEMENT_POLICY: Readonly<Record<string, RestEntitlementPolicy>> = {
  // server.ts: public, no tenant data
  "GET /pay/upi": "public-static",
  "GET /api/plans": "public-static",
  "GET /health": "public-static",
  "GET /up": "public-static",
  "GET /": "public-static",

  // server.ts: signed-in reads and downloads (authorizePdfRequest / inline equivalent)
  "GET /api/invoices/:id/pdf": "read",
  "GET /api/invoice-templates/preview": "read",
  "GET /api/eway-bills/:id/pdf": "read",
  "GET /api/businesses/:id/logo": "read",
  "GET /api/businesses/:id/signature": "read",
  "GET /api/parties/:id/ledger.pdf": "read",
  // A label sheet is a PDF download, not a write.
  "POST /api/items/labels": "exempt-download",

  // server.ts: public links (neutral refusal for halted/suspended organisations)
  "GET /api/share/:token": "public-neutral",
  "GET /api/share/:token/pdf": "public-neutral",
  "GET /api/share/:token/logo": "public-neutral",
  // Pay now: makes a Razorpay payment link on the business's own account. A read-only or
  // suspended organisation makes no new links and answers the same neutral 404.
  "POST /api/share/:token/pay": "public-neutral",
  "GET /store/:slug/logo": "public-neutral",
  // Online payment of a store order: the order's status, and Pay again (makes a Razorpay payment link
  // on the business's own account). Same neutral 404 as the rest of /store/*: a halted, read-only or
  // suspended organisation, a store that is off and an unknown order all look alike; no new link is
  // made for them. A payment already made is still recorded by the business webhook (exempt-webhook).
  "GET /store/:slug/order/:orderId": "public-neutral",
  "POST /store/:slug/order/:orderId/pay": "public-neutral",
  "GET /store/:slug/catalog.json": "public-neutral",
  "GET /store/:slug/policies.json": "public-neutral",
  "GET /store/:slug/policies/:kind": "public-neutral",
  "POST /store/:slug/identify": "public-neutral",
  "POST /store/:slug/order": "public-neutral",

  // server.ts: carrier callbacks
  "POST /webhooks/shipping/:businessId": "exempt-webhook",

  // http/*.ts
  "GET /api/export/:tenantId": "signed-token",
  "POST /api/selfImport/:tenantId": "signed-token",
  "POST /webhooks/razorpay": "exempt-webhook",
  // A business's OWN Razorpay account (payment links), verified with that business's webhook
  // secret. Recorded even in read-only mode (the customer has already paid); suspended: 401.
  "POST /webhooks/razorpay/business/:token": "exempt-webhook",
  "GET /api/billing/invoices/:paymentId/pdf": "exempt-download",

  // The AI assistant's streaming answer. A signed-in POST that reads the business through the user's own
  // tRPC caller and writes only the chat history and the usage ledger. Add-ons are off while an organisation is
  // read-only, so it is refused for read-only and suspended organisations (refuseIfReadOnly) with the standard
  // 403 { error, entitlement } body; the add-on, quota and owner switches are enforced by ai.begin.
  "POST /api/ai/stream": "write-gated",

  // tRPC mount
  "ALL /api/trpc/*": "trpc-gated",
};
