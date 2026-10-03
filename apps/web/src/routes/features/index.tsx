import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowDataTransferHorizontalIcon,
  ArrowRight01Icon,
  BankIcon,
  BarCode01Icon,
  Book02Icon,
  Calculator01Icon,
  CheckListIcon,
  Clock01Icon,
  Factory01Icon,
  Layers01Icon,
  PackageReceiveIcon,
  ScanIcon,
  Share08Icon,
  SlidersHorizontalIcon,
  Tag01Icon,
  WarehouseIcon,
  Building03Icon,
  ChartBarLineIcon,
  ChartIncreaseIcon,
  CloudUploadIcon,
  Coins01Icon,
  ComputerIcon,
  CreditCardIcon,
  DeliveryTruck01Icon,
  FileEditIcon,
  GitCompareIcon,
  Invoice01Icon,
  Link01Icon,
  PackageIcon,
  QrCodeIcon,
  RepeatIcon,
  ReturnRequestIcon,
  SecurityCheckIcon,
  ShoppingBag01Icon,
  Store01Icon,
  TaxesIcon,
  Tick02Icon,
  UserGroupIcon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import { Icon, IconCircle, type IconSvgElement } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import type { FeatureSlug } from "@/lib/feature-slugs";
import {
  CtaBand,
  MarketingLayout,
  PageHero,
} from "@/components/marketing/MarketingLayout";

export const Route = createFileRoute("/features/")({
  component: FeaturesPage,
});

/**
 * The /features index. Every card links to its own page at /features/<slug>
 * (content in lib/feature-pages); several cards can share one page.
 */
const FEATURE_GROUPS: Array<{
  title: string;
  intro: string;
  items: Array<{ name: string; body: string; slug: FeatureSlug }>;
}> = [
  {
    title: "Sales & billing",
    intro: "Every document a sale needs, from first quote to final payment.",
    items: [
      { name: "GST invoices", body: "Sale and purchase invoices with HSN/SAC, CGST/SGST/IGST and cess worked out for you.", slug: "invoicing" },
      { name: "Quotations & proforma", body: "Send estimates and proforma invoices, then convert them to invoices in one click.", slug: "quotations" },
      { name: "Delivery challans", body: "Move goods without a sale and invoice them later.", slug: "delivery-challans" },
      { name: "Credit notes & returns", body: "Handle sales returns and adjustments with correct tax reversal.", slug: "credit-notes-returns" },
      { name: "Recurring invoices", body: "Automate monthly and periodic billing for retainers and subscriptions.", slug: "recurring-invoices" },
      { name: "Point of sale", body: "A fast checkout screen for walk-in customers, with keyboard shortcuts.", slug: "point-of-sale" },
      { name: "Share links", body: "Send any invoice or quote as a link your customer opens without signing in, or share it on WhatsApp. See when it was opened and turn it off any time.", slug: "invoicing" },
    ],
  },
  {
    title: "GST compliance",
    intro: "Stay ready for filing without exporting to spreadsheets.",
    items: [
      { name: "e-Invoicing", body: "Generate IRN and signed QR codes directly from your invoices.", slug: "e-invoicing" },
      { name: "e-Way bills", body: "Create and track e-way bills for goods in transit.", slug: "e-way-bills" },
      { name: "GSTR-1 & GSTR-3B", body: "File-ready return summaries built from your transactions.", slug: "gst-filing" },
      { name: "GSTR-2B reconciliation", body: "Match supplier data against your purchases and spot mismatches.", slug: "gstr-2b-itc" },
      { name: "Input tax credit", body: "Track eligible, claimed and pending ITC across periods.", slug: "gstr-2b-itc" },
    ],
  },
  {
    title: "Accounting & banking",
    intro: "Clean books that are always up to date.",
    items: [
      { name: "Payments", body: "Record receipts and payments against invoices and track outstanding balances.", slug: "payments" },
      { name: "Expenses", body: "Log business expenses by category, with GST where it applies.", slug: "expenses" },
      { name: "Cash & bank", body: "Manage multiple cash and bank accounts in one place.", slug: "banking" },
      { name: "Bank reconciliation", body: "Import statements and match them against your books.", slug: "banking" },
      { name: "Journal entries", body: "Post manual adjustments with full double-entry support.", slug: "reporting" },
      { name: "Reports", body: "Profit & loss, balance sheet, day book, party ledgers, stock and tax reports.", slug: "reporting" },
      { name: "MSME payables", body: "Unpaid bills from MSME suppliers with their 45-day pay-by dates, so payments stay on time under Section 43B(h).", slug: "payments" },
    ],
  },
  {
    title: "Inventory & fulfilment",
    intro: "Know what you have, where it is and what it is worth.",
    items: [
      { name: "Items & variants", body: "Products and services with units, variants, pricing and tax rates. Stock updates as you buy and sell.", slug: "inventory" },
      { name: "Warehouses & godowns", body: "Keep stock in several warehouses or godowns and see what each one holds. Choose whether stock may go below zero.", slug: "warehouses" },
      { name: "Stock transfers", body: "Move stock between your warehouses, with every transfer kept in a journal.", slug: "stock-transfers" },
      { name: "Stock adjustments", body: "Record damaged, expired or found stock with a reason, outside of sales and purchases.", slug: "physical-stock-barcodes" },
      { name: "Physical stock & barcode counts", body: "Scan everything on the shelf in a store or godown, then compare the count with your books and fix the difference.", slug: "physical-stock-barcodes" },
      { name: "Barcode labels", body: "Print barcode labels for one item, several items or every piece on a purchase bill, sized for your label printer.", slug: "physical-stock-barcodes" },
      { name: "Stock valuation", body: "Value closing stock at average cost or FIFO, the method you pick for your business.", slug: "stock-valuation" },
      { name: "Stock groups", body: "Arrange items in nested stock groups and see quantity and value for each group.", slug: "inventory" },
      { name: "Price levels & MRP", body: "Wholesale, retail or dealer price lists with quantity slabs, set per customer, and a warning when a price goes above MRP.", slug: "price-levels" },
      { name: "Inventory reports", body: "Stock ledger, movement summary, godown summary, stock ageing, reorder status and dead stock.", slug: "inventory-reports" },
    ],
  },
  {
    title: "Orders & manufacturing",
    intro: "From the first order to the finished product and the delivery.",
    items: [
      { name: "Sales & purchase orders", body: "Take sales orders and raise purchase orders, track what is still pending and short-close what won't be supplied.", slug: "orders-goods-receipts" },
      { name: "Goods receipt notes", body: "Record goods as they arrive against a purchase order, before the supplier's bill.", slug: "orders-goods-receipts" },
      { name: "Bill of materials & manufacturing", body: "List what goes into each item you make, then record production: components leave stock and the finished item comes in at cost.", slug: "manufacturing" },
      { name: "Shipments", body: "Track dispatches and deliveries for your orders.", slug: "orders-goods-receipts" },
      { name: "Online store", body: "Publish a storefront for your items and receive orders straight into your books.", slug: "online-store" },
    ],
  },
  {
    title: "Teams & platform",
    intro: "Grows with you from one shop to many branches.",
    items: [
      { name: "Multiple businesses", body: "Run several GSTINs and businesses under one organization.", slug: "team-roles" },
      { name: "Roles & permissions", body: "Invite your team and your accountant with role-based access.", slug: "team-roles" },
      { name: "Web, desktop & mobile", body: "Use Fintranzact in the browser, as a desktop app or on your phone.", slug: "mobile-desktop-apps" },
      { name: "API & integrations", body: "Connect your own tools through the API, CLI and AI assistant integrations.", slug: "api-integrations" },
      { name: "Data import & backup", body: "Bring in parties and items from spreadsheets and export your data any time.", slug: "api-integrations" },
    ],
  },
];

const GROUP_ICONS: Record<string, IconSvgElement> = {
  "Sales & billing": Invoice01Icon,
  "GST compliance": TaxesIcon,
  "Accounting & banking": BankIcon,
  "Inventory & fulfilment": PackageIcon,
  "Orders & manufacturing": Factory01Icon,
  "Teams & platform": UserGroupIcon,
};

const ITEM_ICONS: Record<string, IconSvgElement> = {
  "GST invoices": Invoice01Icon,
  "Quotations & proforma": FileEditIcon,
  "Delivery challans": DeliveryTruck01Icon,
  "Credit notes & returns": ReturnRequestIcon,
  "Recurring invoices": RepeatIcon,
  "Point of sale": Store01Icon,
  "e-Invoicing": QrCodeIcon,
  "e-Way bills": DeliveryTruck01Icon,
  "GSTR-1 & GSTR-3B": TaxesIcon,
  "GSTR-2B reconciliation": GitCompareIcon,
  "Input tax credit": Coins01Icon,
  Payments: CreditCardIcon,
  Expenses: Wallet01Icon,
  "Cash & bank": BankIcon,
  "Bank reconciliation": GitCompareIcon,
  "Journal entries": Book02Icon,
  Reports: ChartBarLineIcon,
  "MSME payables": Clock01Icon,
  "Share links": Share08Icon,
  "Items & variants": PackageIcon,
  "Warehouses & godowns": WarehouseIcon,
  "Stock transfers": ArrowDataTransferHorizontalIcon,
  "Stock adjustments": SlidersHorizontalIcon,
  "Physical stock & barcode counts": ScanIcon,
  "Barcode labels": BarCode01Icon,
  "Stock valuation": Calculator01Icon,
  "Stock groups": Layers01Icon,
  "Price levels & MRP": Tag01Icon,
  "Inventory reports": ChartIncreaseIcon,
  "Sales & purchase orders": CheckListIcon,
  "Goods receipt notes": PackageReceiveIcon,
  "Bill of materials & manufacturing": Factory01Icon,
  Shipments: DeliveryTruck01Icon,
  "Online store": ShoppingBag01Icon,
  "Multiple businesses": Building03Icon,
  "Roles & permissions": SecurityCheckIcon,
  "Web, desktop & mobile": ComputerIcon,
  "API & integrations": Link01Icon,
  "Data import & backup": CloudUploadIcon,
};

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function FeaturesPage() {
  return (
    <MarketingLayout
      title="Features"
      description="GST invoicing, e-invoicing, e-way bills, GSTR returns, banking, multi-godown inventory, manufacturing and reports: every Fintranzact feature in one place."
    >
      <PageHero
        eyebrow="Features"
        title="Everything you need to bill, file and grow"
        subtitle="Invoicing, GST compliance, accounting and inventory in one connected system, built for Indian businesses."
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/register"
            className="inline-flex h-[52px] items-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-[0_12px_28px_-10px_rgba(59,94,170,.7)] transition hover:bg-brand-700"
          >
            Start free trial — no card needed
            <Icon icon={ArrowRight01Icon} size={18} strokeWidth={2} />
          </Link>
          <Link
            to="/pricing"
            className="inline-flex h-[52px] items-center rounded-xl border border-[#cfd8ea] bg-white px-6 text-base font-semibold text-[#0f1b3d] transition hover:border-brand-300 dark:border-white/15 dark:bg-white/5 dark:text-white"
          >
            See pricing
          </Link>
        </div>
      </PageHero>

      {FEATURE_GROUPS.map((group, gi) => (
        <section
          key={group.title}
          id={slug(group.title)}
          className={cn("scroll-mt-32", gi % 2 === 1 && "bg-surface-1")}
        >
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 md:px-6 lg:grid-cols-3 lg:py-24">
            <div className="lg:sticky lg:top-40 lg:self-start">
              <IconCircle icon={GROUP_ICONS[group.title] ?? Invoice01Icon} size="lg" />
              <h2 className="mt-5 font-display text-3xl font-extrabold tracking-[-0.025em] text-[#0f1b3d] dark:text-white">
                {group.title}
              </h2>
              <p className="mt-3 text-base leading-relaxed text-text-secondary">{group.intro}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
              {group.items.map((item) => (
                <Link
                  key={item.name}
                  to="/features/$slug"
                  params={{ slug: item.slug }}
                  className="group flex flex-col rounded-2xl border border-border-light bg-surface-0 p-6 transition duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[0_18px_40px_-18px_rgba(15,27,61,.28)] dark:hover:border-brand-800"
                >
                  <IconCircle icon={ITEM_ICONS[item.name] ?? Tick02Icon} size="md" />
                  <h3 className="mt-4 text-base font-bold text-text-primary">{item.name}</h3>
                  <p className="mt-1.5 flex-1 text-sm leading-relaxed text-text-tertiary">{item.body}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 dark:text-brand-300">
                    Learn more
                    <Icon icon={ArrowRight01Icon} size={15} className="transition group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ))}

      <CtaBand />
    </MarketingLayout>
  );
}
