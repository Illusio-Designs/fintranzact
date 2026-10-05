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
 *                   refuseIfReadOnly. (No such session-authenticated route
 *                   exists today; the only REST writes are signed-token or
 *                   public.)
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
  "GET /store/:slug/logo": "public-neutral",
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
  "GET /api/billing/invoices/:paymentId/pdf": "exempt-download",

  // tRPC mount
  "ALL /api/trpc/*": "trpc-gated",
};
