/**
 * The public API reference at /developers. Kept free of UI and content
 * imports so the tRPC client (via public-paths.ts) and the build-time sitemap
 * can use it without pulling in the reference itself.
 *
 *   /developers                     overview and quick start
 *   /developers/<guide>             authentication, conventions, FAQ
 *   /developers/<group>             one page per endpoint group
 *   /developers/<group>/<endpoint>  one page per endpoint (not in the sitemap;
 *                                   the group page carries the same content)
 */

export const DEVELOPERS_PATH = "/developers";

/** Hand-written guide pages, each its own route under routes/developers/. */
export const DEVELOPER_GUIDE_SLUGS = ["authentication", "conventions", "faq"] as const;

/**
 * Every endpoint group, in sidebar order. content/developers/index.ts must
 * have a group for each; src/__tests__/developers.test.ts checks they agree.
 */
export const DEVELOPER_GROUP_SLUGS = [
  // Foundation
  "auth",
  "tenant",
  "billing",
  "businesses",
  "api-keys",
  "plans-system",
  // Commerce
  "parties",
  "items",
  "invoices",
  "payments",
  "expense",
  "shipment",
  "recurring",
  "store",
  "pos",
  "share-links",
  "online-payments",
  // Documents & orders
  "documents",
  "orders",
  // Inventory
  "warehouses",
  "stock",
  "stock-groups",
  "inventory-reports",
  "manufacturing",
  "barcodes",
  // Pricing
  "price-levels",
  "pricing",
  // Banking
  "bank-accounts",
  "bank-recon",
  // GST & compliance
  "gst",
  "gstr2b",
  "einvoice",
  "eway-bill",
  "itc",
  "hsn",
  // Accounting
  "accounts",
  "journals",
  "tds",
  "period",
  // Analytics
  "dashboard",
  "reports",
  "target",
  // Data
  "import",
  "backup",
  // Public forms
  "partner",
  "contact",
] as const;

export type DeveloperGroupSlug = (typeof DEVELOPER_GROUP_SLUGS)[number];

/** The overview, every guide and every endpoint group page, for the sitemap. */
export const DEVELOPER_PAGE_PATHS = [
  DEVELOPERS_PATH,
  ...DEVELOPER_GUIDE_SLUGS.map((s) => `${DEVELOPERS_PATH}/${s}`),
  ...DEVELOPER_GROUP_SLUGS.map((s) => `${DEVELOPERS_PATH}/${s}`),
];

/** /developers and anything under it (an unknown page shows a not-found page). */
export function isDeveloperPath(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === DEVELOPERS_PATH || path.startsWith(`${DEVELOPERS_PATH}/`);
}
