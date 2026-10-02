/**
 * The help centre's table of contents: every article under
 * src/content/help, grouped the way the sidebar shows them. Kept free of UI
 * imports so the build-time sitemap can list every /help page.
 *
 * An article's slug is its file path under src/content/help without the
 * extension; a folder's index.mdx is the folder itself ("invoicing"), and the
 * top-level index.mdx is "" (the /help home page). A test checks this list
 * against the files on disk, so a new article must be added here too.
 */

export type HelpNavLink = { label: string; slug: string };
export type HelpNavGroup = { label: string; items: HelpNavLink[] };
export type HelpNavSection = { label: string; items: Array<HelpNavLink | HelpNavGroup> };

export const HELP_NAV: HelpNavSection[] = [
  {
    label: "Getting Started",
    items: [
      { label: "What is Fintranzact?", slug: "getting-started" },
      { label: "Create Your Business", slug: "getting-started/create-business" },
      { label: "Import Data", slug: "getting-started/import-data" },
    ],
  },
  {
    label: "Invoicing",
    items: [
      { label: "Overview", slug: "invoicing" },
      { label: "Create an Invoice", slug: "invoicing/create-invoice" },
      { label: "Invoice Statuses", slug: "invoicing/invoice-statuses" },
      { label: "Invoice PDF", slug: "invoicing/invoice-pdf" },
      { label: "GST on Invoices", slug: "invoicing/gst-on-invoices" },
      { label: "Recurring Invoices", slug: "invoicing/recurring-invoices" },
      { label: "Shipments", slug: "invoicing/shipments" },
      { label: "Point of Sale", slug: "pos" },
    ],
  },
  {
    label: "Other Documents",
    items: [
      { label: "Overview", slug: "documents" },
      { label: "Quotations & Proforma", slug: "documents/quotations-and-proforma" },
      { label: "Delivery Challans", slug: "documents/delivery-challans" },
      { label: "Credit & Debit Notes", slug: "documents/credit-and-debit-notes" },
      { label: "Sales & Purchase Returns", slug: "documents/returns" },
      { label: "Share Links", slug: "documents/share-links" },
    ],
  },
  {
    label: "Business Data",
    items: [
      {
        label: "Parties",
        items: [
          { label: "Managing Parties", slug: "parties" },
          { label: "Party Ledger", slug: "parties/party-ledger" },
        ],
      },
      {
        label: "Items & Inventory",
        items: [
          { label: "Managing Items", slug: "items" },
          { label: "Variants", slug: "items/variants" },
          { label: "Units & Conversions", slug: "items/units-and-conversions" },
          { label: "How Stock Moves", slug: "inventory/how-stock-moves" },
          { label: "Batches & Expiry", slug: "inventory/batches-and-expiry" },
          { label: "Warehouses", slug: "inventory/warehouses" },
          { label: "Stock Transfers", slug: "inventory/stock-transfers" },
          { label: "Stock Adjustments", slug: "inventory/stock-adjustments" },
          { label: "Physical Stock", slug: "inventory/physical-stock" },
          { label: "Barcodes", slug: "inventory/barcodes" },
          { label: "Stock Groups", slug: "inventory/stock-groups" },
          { label: "Price Levels & MRP", slug: "inventory/price-levels" },
          { label: "Orders & GRN", slug: "inventory/orders-and-grn" },
          { label: "Bill of Materials & Manufacturing", slug: "inventory/manufacturing" },
          { label: "Stock Valuation", slug: "inventory/stock-valuation" },
          { label: "Inventory Reports", slug: "inventory/reports" },
        ],
      },
      { label: "Payments", slug: "payments" },
      { label: "Expenses", slug: "expenses" },
      {
        label: "Banking",
        items: [
          { label: "Bank Accounts", slug: "banking" },
          { label: "Payment Gateways", slug: "banking/payment-gateways" },
          { label: "Bank Reconciliation", slug: "banking/bank-reconciliation" },
        ],
      },
      { label: "Journal Entries", slug: "accounting/journal-entries" },
      { label: "TDS & TCS", slug: "accounting/tds" },
      { label: "Period Locks & Year Close", slug: "accounting/period-locks" },
    ],
  },
  {
    label: "Reports & GST",
    items: [
      { label: "Business Reports", slug: "reports" },
      { label: "GST Compliance", slug: "gst" },
      { label: "GSTR-1 Filing", slug: "gst/gstr1" },
      { label: "E-Invoicing", slug: "gst/e-invoicing" },
      { label: "E-Way Bills", slug: "gst/eway-bills" },
      { label: "GSTR-2B Reconciliation", slug: "gst/gstr2b" },
      { label: "Input Tax Credit", slug: "gst/itc" },
      { label: "Set up e-invoicing and e-way bills", slug: "gst/setup-e-invoicing-and-eway-bills" },
      { label: "GSTR-4 and CMP-08 for composition dealers", slug: "gst/gstr4-and-cmp08" },
    ],
  },
  {
    label: "Settings & Team",
    items: [
      { label: "Settings", slug: "settings" },
      { label: "Backup & Restore", slug: "settings/backup-restore" },
      { label: "Plans & Billing", slug: "settings/plans" },
      { label: "Two-factor authentication: set up, backup codes, trusted devices", slug: "settings/two-factor-authentication" },
      { label: "Team & Roles", slug: "team" },
      { label: "Invitations", slug: "team/invitations" },
      { label: "Online Store", slug: "online-store" },
    ],
  },
  {
    label: "Advanced",
    items: [
      {
        label: "AI & Automation",
        items: [
          { label: "Overview", slug: "ai" },
          { label: "MCP Server", slug: "ai/mcp-server" },
          { label: "CLI", slug: "ai/cli" },
          { label: "Integrations", slug: "ai/integrations" },
        ],
      },
      {
        label: "Reference",
        items: [
          { label: "Keyboard Shortcuts", slug: "reference/keyboard-shortcuts" },
          { label: "Supported Units", slug: "reference/supported-units" },
        ],
      },
    ],
  },
  {
    label: "FAQ",
    items: [{ label: "Frequently asked questions", slug: "faq" }],
  },
];

/** A sidebar entry with a trail of the section and group it sits in. */
export type HelpNavEntry = HelpNavLink & { trail: string[] };

function isGroup(item: HelpNavLink | HelpNavGroup): item is HelpNavGroup {
  return "items" in item;
}

/** Every article in reading order (sidebar order), home page first. */
export const HELP_ENTRIES: HelpNavEntry[] = [
  { label: "Help centre", slug: "", trail: [] },
  ...HELP_NAV.flatMap((section) =>
    section.items.flatMap((item) =>
      isGroup(item)
        ? item.items.map((link) => ({ ...link, trail: [section.label, item.label] }))
        : [{ ...item, trail: [section.label] }],
    ),
  ),
];

/** Every article slug ("" is the help home page). */
export const HELP_SLUGS: string[] = HELP_ENTRIES.map((e) => e.slug);

/** Public URL of a help article. */
export function helpPath(slug: string): string {
  const clean = slug.replace(/^\/+|\/+$/g, "");
  return clean ? `/help/${clean}` : "/help";
}

/** Every help page, for the sitemap. */
export const HELP_PAGE_PATHS: string[] = HELP_SLUGS.map(helpPath);

/** /help and everything under it (an unknown article shows a not-found page). */
export function isHelpPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/help" || path.startsWith("/help/");
}

/** The article slug for a /help URL, or null when the path is outside the help centre. */
export function helpSlugFromPath(pathname: string): string | null {
  if (!isHelpPath(pathname)) return null;
  return pathname.replace(/\/+$/, "").replace(/^\/help\/?/, "");
}
