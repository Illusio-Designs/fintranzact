import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  integrations: [
    starlight({
      title: "Fintranzact Docs",
      description: "Documentation for Fintranzact — your trustable accounting partner for Indian businesses",
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: false,
      },
      social: [
      ],
      components: {
        ThemeSelect: "./src/components/overrides/ThemeSelect.astro",
        Sidebar: "./src/components/overrides/Sidebar.astro",
      },
      customCss: ["./src/styles/custom.css"],
      sidebar: [
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
          ],
        },
        {
          label: "Settings & Team",
          items: [
            { label: "Settings", slug: "settings" },
            { label: "Backup & Restore", slug: "settings/backup-restore" },
            { label: "Plans & Billing", slug: "settings/plans" },
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
          slug: "faq",
        },
      ],
      defaultLocale: "en",
      head: [
        {
          tag: "meta",
          attrs: { name: "robots", content: "index, follow" },
        },
        {
          tag: "script",
          content: `(function(){var s=localStorage.getItem('fintranzact-docs-platform');if(s==='desktop'||s==='mobile'){document.documentElement.setAttribute('data-platform',s)}else{var m=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||window.innerWidth<768;document.documentElement.setAttribute('data-platform',m?'mobile':'desktop')}var p=localStorage.getItem('fintranzact-docs-persona');if(p!=='ca'&&p!=='business'){p='all';localStorage.removeItem('fintranzact-docs-persona')}document.documentElement.setAttribute('data-persona',p)})();`,
        },
      ],
    }),
  ],
  site: "https://docs.fintranzact.com",
});
