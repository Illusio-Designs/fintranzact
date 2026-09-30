/**
 * The slug of every public feature page (/features/<slug>). Kept free of UI
 * imports so the build-time sitemap can list them.
 */
export const FEATURE_SLUGS = [
  "invoicing",
  "quotations",
  "delivery-challans",
  "credit-notes-returns",
  "point-of-sale",
  "recurring-invoices",
  "payments",
  "expenses",
  "banking",
  "gst-filing",
  "e-invoicing",
  "e-way-bills",
  "gstr-2b-itc",
  "reporting",
  "mobile-desktop-apps",
  "team-roles",
  "api-integrations",
  "online-store",
  "inventory",
  "warehouses",
  "stock-transfers",
  "physical-stock-barcodes",
  "stock-valuation",
  "price-levels",
  "orders-goods-receipts",
  "manufacturing",
  "inventory-reports",
] as const;

export type FeatureSlug = (typeof FEATURE_SLUGS)[number];

/** Every feature page path, for the sitemap. */
export const FEATURE_PAGE_PATHS = FEATURE_SLUGS.map((s) => `/features/${s}`);
