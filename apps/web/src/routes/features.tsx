import { createFileRoute } from "@tanstack/react-router";
import {
  CtaBand,
  MarketingLayout,
  PageHero,
} from "@/components/marketing/MarketingLayout";

export const Route = createFileRoute("/features")({
  component: FeaturesPage,
});

const FEATURE_GROUPS: Array<{
  title: string;
  intro: string;
  items: Array<{ name: string; body: string }>;
}> = [
  {
    title: "Sales & billing",
    intro: "Every document a sale needs, from first quote to final payment.",
    items: [
      { name: "GST invoices", body: "Sale and purchase invoices with HSN/SAC, CGST/SGST/IGST and cess worked out for you." },
      { name: "Quotations & proforma", body: "Send estimates and proforma invoices, then convert them to invoices in one click." },
      { name: "Delivery challans", body: "Move goods without a sale and invoice them later." },
      { name: "Credit notes & returns", body: "Handle sales returns and adjustments with correct tax reversal." },
      { name: "Recurring invoices", body: "Automate monthly and periodic billing for retainers and subscriptions." },
      { name: "Point of sale", body: "A fast checkout screen for walk-in customers, with keyboard shortcuts." },
    ],
  },
  {
    title: "GST compliance",
    intro: "Stay ready for filing without exporting to spreadsheets.",
    items: [
      { name: "e-Invoicing", body: "Generate IRN and signed QR codes directly from your invoices." },
      { name: "e-Way bills", body: "Create and track e-way bills for goods in transit." },
      { name: "GSTR-1 & GSTR-3B", body: "File-ready return summaries built from your transactions." },
      { name: "GSTR-2B reconciliation", body: "Match supplier data against your purchases and spot mismatches." },
      { name: "Input tax credit", body: "Track eligible, claimed and pending ITC across periods." },
    ],
  },
  {
    title: "Accounting & banking",
    intro: "Clean books that are always up to date.",
    items: [
      { name: "Payments", body: "Record receipts and payments against invoices and track outstanding balances." },
      { name: "Expenses", body: "Log business expenses by category, with GST where it applies." },
      { name: "Cash & bank", body: "Manage multiple cash and bank accounts in one place." },
      { name: "Bank reconciliation", body: "Import statements and match them against your books." },
      { name: "Journal entries", body: "Post manual adjustments with full double-entry support." },
      { name: "Reports", body: "Profit & loss, balance sheet, day book, party ledgers, stock and tax reports." },
    ],
  },
  {
    title: "Inventory & fulfilment",
    intro: "Know what you have and where it is going.",
    items: [
      { name: "Items & variants", body: "Products and services with units, variants, pricing and tax rates." },
      { name: "Stock tracking", body: "Stock levels update automatically as you buy and sell." },
      { name: "Shipments", body: "Track dispatches and deliveries for your orders." },
      { name: "Online store", body: "Publish a storefront for your items and receive orders straight into your books." },
    ],
  },
  {
    title: "Teams & platform",
    intro: "Grows with you from one shop to many branches.",
    items: [
      { name: "Multiple businesses", body: "Run several GSTINs and businesses under one organization." },
      { name: "Roles & permissions", body: "Invite your team and your accountant with role-based access." },
      { name: "Web, desktop & mobile", body: "Use Fintranzact in the browser, as a desktop app or on your phone." },
      { name: "API & integrations", body: "Connect your own tools through the API, CLI and AI assistant integrations." },
      { name: "Data import & backup", body: "Bring in parties and items from spreadsheets and export your data any time." },
    ],
  },
];

function FeaturesPage() {
  return (
    <MarketingLayout title="Features">
      <PageHero
        eyebrow="Features"
        title="Everything you need to bill, file and grow"
        subtitle="Invoicing, GST compliance, accounting and inventory in one connected system, built for Indian businesses."
      />

      <div className="mx-auto max-w-6xl space-y-16 px-4 py-16 md:px-6 md:py-20">
        {FEATURE_GROUPS.map((group) => (
          <section key={group.title} className="grid gap-8 md:grid-cols-3">
            <div>
              <h2 className="text-xl font-semibold md:text-2xl">{group.title}</h2>
              <p className="mt-2 text-sm text-text-tertiary">{group.intro}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 md:col-span-2">
              {group.items.map((item) => (
                <div key={item.name} className="card p-5">
                  <h3 className="text-sm font-semibold">{item.name}</h3>
                  <p className="mt-1.5 text-sm text-text-tertiary">{item.body}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <CtaBand />
    </MarketingLayout>
  );
}
