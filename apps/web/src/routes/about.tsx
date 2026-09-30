import { createFileRoute } from "@tanstack/react-router";
import {
  CtaBand,
  MarketingLayout,
  PageHero,
} from "@/components/marketing/MarketingLayout";
import { EYEBROW, HEADING } from "@/components/marketing/sections";
import {
  BankIcon,
  ComputerIcon,
  Download04Icon,
  FlashIcon,
  Invoice01Icon,
  Location01Icon,
  Money03Icon,
  PackageIcon,
  QrCodeIcon,
  SecurityCheckIcon,
  Target02Icon,
  TaxesIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { Icon, IconCircle, type IconSvgElement } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/about")({
  component: AboutPage,
});

const VALUES: Array<{ title: string; body: string }> = [
  {
    title: "Accuracy first",
    body: "Tax and money must add up to the last paisa. Every calculation is tested against how GST actually works.",
  },
  {
    title: "Built for India",
    body: "GSTINs, HSN codes, e-invoicing, e-way bills and Indian number formats are core features, not add-ons.",
  },
  {
    title: "Your data is yours",
    body: "Export everything whenever you want. We never sell your data or lock you in.",
  },
  {
    title: "Fast and simple",
    body: "Create an invoice in seconds, on any device, without accounting training.",
  },
];

const VALUE_ICONS: IconSvgElement[] = [Target02Icon, Location01Icon, SecurityCheckIcon, FlashIcon];

const GLANCE: Array<[IconSvgElement, string]> = [
  [Invoice01Icon, "Quotations, invoices, challans and POS"],
  [QrCodeIcon, "e-Invoicing and e-Way Bills"],
  [TaxesIcon, "GSTR-1, GSTR-3B and GSTR-2B"],
  [BankIcon, "Payments, banking and reconciliation"],
  [PackageIcon, "Inventory, shipments and an online store"],
  [ComputerIcon, "Web, desktop and mobile"],
];

const WHY: Array<[IconSvgElement, string, string]> = [
  [Money03Icon, "Free forever, for real", "Unlimited invoices, parties and team members on the free plan — no trial clock and no branding on your documents."],
  [TaxesIcon, "GST done properly", "Tax is worked out on every line, and returns, e-Invoices and e-Way Bills come straight from your data."],
  [UserGroupIcon, "Made for teams", "Invite staff and your accountant with role-based access, across every business you run."],
  [Download04Icon, "No lock-in", "Import from spreadsheets and your old software, and export everything whenever you like."],
];

function AboutPage() {
  return (
    <MarketingLayout
      title="About us"
      description="Fintranzact builds GST billing, inventory and accounting software for Indian businesses. Learn who we are and what we believe."
    >
      <PageHero
        eyebrow="About us"
        title="Your trustable accounting partner"
        subtitle="Fintranzact helps Indian businesses bill customers, stay GST-compliant and understand their numbers, without spreadsheets or expensive software."
      />

      <section>
        <div className="mx-auto grid max-w-6xl items-start gap-14 px-4 py-24 md:px-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <p className={EYEBROW}>Our story</p>
            <h2 className={cn(HEADING, "mt-3 text-3xl leading-tight md:text-[40px]")}>
              One place for everything a business runs on
            </h2>
            <div className="mt-6 space-y-4 text-[17px] leading-relaxed text-text-secondary">
              <p>
                Running a small business in India means juggling invoices, GST returns, payments and stock, often
                across notebooks, spreadsheets and several disconnected apps. We built Fintranzact to bring all of
                that into one place that&apos;s quick to learn and reliable enough to trust with your books.
              </p>
              <p>
                Today Fintranzact covers the full cycle: quotations and invoices, e-invoicing and e-way bills,
                payments and bank reconciliation, inventory, reports and an online store. It runs on the web, the
                desktop and your phone.
              </p>
            </div>
          </div>
          <div className="landing-dots-dark rounded-[24px] bg-[#0f1b3d] p-8 text-white ring-1 ring-transparent lg:col-span-2 dark:bg-[#16213f] dark:ring-[#2a3a63]">
            <p className="font-display text-xl font-extrabold">Fintranzact at a glance</p>
            <ul className="mt-6 space-y-4">
              {GLANCE.map(([icon, text]) => (
                <li key={text} className="flex items-center gap-3.5 text-[15px] text-[#dbe4f5]">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#a9bde6]/15 text-[#c7d4ef]">
                    <Icon icon={icon} size={20} />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="bg-surface-1">
        <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
          <p className={cn(EYEBROW, "text-center")}>What we believe</p>
          <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>The principles behind every feature</h2>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {VALUES.map((value, i) => (
              <div key={value.title} className="rounded-2xl border border-border-light bg-surface-0 p-6">
                <IconCircle icon={VALUE_ICONS[i % VALUE_ICONS.length]} size="lg" />
                <h3 className="mt-5 text-lg font-bold text-text-primary">{value.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-tertiary">{value.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
          <p className={cn(EYEBROW, "text-center")}>Why Fintranzact</p>
          <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>Why businesses choose us</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {WHY.map(([icon, title, body]) => (
              <div key={title} className="flex gap-5 rounded-2xl border border-border-light p-7">
                <IconCircle icon={icon} size="lg" />
                <div>
                  <h3 className="text-lg font-bold text-text-primary">{title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-text-tertiary">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </MarketingLayout>
  );
}
