import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CtaBand,
  MarketingLayout,
  PageHero,
} from "@/components/marketing/MarketingLayout";
import { useMemo } from "react";
import { formatPlanLimit, usePlans, type PlanOption } from "@/lib/plans";
import { PLAN_GST_RATE_PERCENT, TRIAL_DAYS, YEARLY_SAVING_MONTHS } from "@fintranzact/shared";
import { cn } from "@/lib/utils";
import { EYEBROW, FaqAccordion, HEADING, PricingCards } from "@/components/marketing/sections";

import {
  BankIcon,
  ChartBarLineIcon,
  ComputerIcon,
  Invoice01Icon,
  PackageIcon,
  QrCodeIcon,
  TaxesIcon,
  Tick02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { Icon, IconCircle, type IconSvgElement } from "@/components/ui/Icon";
export const Route = createFileRoute("/pricing")({
  component: PricingPage,
});

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: "Is there a free plan?",
    a: `No. There are three paid plans, and every new organization starts with a ${TRIAL_DAYS}-day free trial on the plan it picks. Your documents carry no Fintranzact branding on any plan.`,
  },
  {
    q: "Do I need a credit card to start the trial?",
    a: "No. Create an account with your email or phone number and start billing straight away. You choose a plan and pay when the trial ends.",
  },
  {
    q: "What happens when the trial ends?",
    a: "Your account becomes read-only until you choose a plan: you can still view, search, download PDFs and export your data. Nothing is deleted, and choosing a plan unlocks it at once.",
  },
  {
    q: "Are the prices with GST?",
    a: `Prices are before ${PLAN_GST_RATE_PERCENT}% GST, which is added at checkout and shown on your invoice. Yearly billing gives you ${YEARLY_SAVING_MONTHS} months free.`,
  },
  {
    q: "Can I switch plans later?",
    a: "Yes. Upgrade or downgrade from Settings → Billing; your data stays exactly where it is.",
  },
];

const INCLUDED: Array<[IconSvgElement, string, string]> = [
  [Invoice01Icon, "GST invoicing", "Invoices, quotations, challans, credit notes and POS."],
  [QrCodeIcon, "GST documents", "Invoices, quotations, e-way bills and GST reports on every plan."],
  [TaxesIcon, "GST returns", "File-ready GSTR-1, GSTR-3B and GSTR-2B reconciliation."],
  [PackageIcon, "Inventory", "Items, variants, stock tracking and shipments."],
  [BankIcon, "Payments & banking", "Receipts, expenses, cash & bank and reconciliation."],
  [ChartBarLineIcon, "Reports", "P&L, balance sheet, day book, ledgers and tax reports."],
  [UserGroupIcon, "Team access", "Team members with roles, on every plan."],
  [ComputerIcon, "Web, desktop & mobile", "Use it in the browser, on the desktop or your phone."],
];

type Cell = boolean | string;

/**
 * Comparison rows. The limit rows come from each plan's `limits` as served by
 * the API's `plan.list` — the values the API enforces — so this table can
 * never promise more than a plan allows.
 */
function buildComparison(plans: PlanOption[]): Array<{ group: string; rows: Array<[string, ...Cell[]]> }> {
  const limits = plans.map((plan) => plan.limits);
  const row = (label: string, pick: (l: (typeof limits)[number]) => Cell): [string, ...Cell[]] => [
    label,
    ...limits.map(pick),
  ];
  const all = (label: string): [string, ...Cell[]] => [label, ...limits.map(() => true)];
  return [
    {
      group: "Billing & GST",
      rows: [
        row("Invoices, parties and payments", () => "Unlimited"),
        all("Quotations, challans and credit notes"),
        row("GST reports", (l) => l.gstReports),
        row("e-way bills", (l) => l.eWayBills),
        row("e-invoicing", (l) => l.eInvoicing),
        row("Recurring invoices", (l) => l.recurringInvoices),
        row("No Fintranzact branding on documents", (l) => !l.pdfBranding),
      ],
    },
    {
      group: "Books & inventory",
      rows: [
        all("Basic inventory"),
        row("POS", (l) => l.pos),
        row("Multiple warehouses", (l) => l.multiWarehouse),
        row("Batches and expiry", (l) => l.batchesExpiry),
        row("Manufacturing and bill of materials", (l) => l.manufacturing),
        row("Bank reconciliation", (l) => l.bankReconciliation),
        row("Basic online store", (l) => l.onlineStore),
        row("Data export", (l) => l.dataExport),
      ],
    },
    {
      group: "Team & limits",
      rows: [
        row("Organizations you can own", (l) => formatPlanLimit(l.maxOwnedOrgs)),
        row("Businesses per organization", (l) => formatPlanLimit(l.maxBusinesses)),
        row("Team members", (l) => formatPlanLimit(l.maxTeamMembers)),
        row("Devices signed in at once", (l) => formatPlanLimit(l.maxConcurrentSessions)),
        row("API access", (l) => (l.maxApiKeys === 0 ? false : l.maxApiKeys === Infinity ? "Unlimited keys" : `${l.maxApiKeys} keys`)),
        row("Audit log history", (l) => formatPlanLimit(l.auditRetentionDays, "days")),
        row("Approvals", (l) => l.approvals),
      ],
    },
    {
      group: "Support",
      rows: [
        all("Help centre and email support"),
        row("Priority support", (l) => l.prioritySupport),
        row("Onboarding help", (l) => l.onboardingHelp),
      ],
    },
  ];
}


function CellValue({ value }: { value: Cell }) {
  if (value === true) {
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/50 dark:text-brand-200">
        <Icon icon={Tick02Icon} size={16} strokeWidth={2.5} />
        <span className="sr-only">Included</span>
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="text-text-tertiary">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Not included</span>
      </span>
    );
  }
  return <span className="text-sm font-semibold text-text-primary">{value}</span>;
}

function PricingPage() {
  const { plans } = usePlans();
  const compare = useMemo(() => buildComparison(plans), [plans]);
  return (
    <MarketingLayout
      title="Pricing"
      description="Three simple plans for GST billing and accounting, with a 14-day free trial. Compare Fintranzact plans, limits and features."
    >
      <PageHero
        eyebrow="Pricing"
        title="Simple pricing. Try it free."
        subtitle={`Start a ${TRIAL_DAYS}-day free trial on any plan. Pick Starter, Growth or Business, and pay yearly to get ${YEARLY_SAVING_MONTHS} months free.`}
      />

      <section className="bg-surface-1">
        <div className="mx-auto max-w-6xl px-4 py-20 md:px-6">
          <PricingCards />
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
          <p className={cn(EYEBROW, "text-center")}>Included in every plan</p>
          <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>
            The full product on every plan
          </h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {INCLUDED.map(([icon, name, body]) => (
              <div key={name} className="rounded-2xl border border-border-light bg-surface-0 p-6">
                <IconCircle icon={icon} />
                <h3 className="mt-4 text-base font-bold text-text-primary">{name}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-text-tertiary">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-surface-1">
        <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
          <p className={cn(EYEBROW, "text-center")}>Compare plans</p>
          <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>Find the plan that fits</h2>
          <div className="relative mt-12 overflow-x-auto rounded-2xl border border-border-light bg-surface-0">
            <table className="w-full min-w-[640px] text-left">
              <caption className="sr-only">Features by plan</caption>
              <thead>
                <tr className="border-b border-border-light">
                  <th scope="col" className="w-2/5 px-6 py-5 text-sm font-semibold text-text-tertiary">
                    Features
                  </th>
                  {plans.map((plan) => (
                    <th key={plan.id} scope="col" className="px-6 py-5 text-center">
                      <span className="block font-display text-lg font-extrabold text-[#0f1b3d] dark:text-white">{plan.name}</span>
                      <span className="mt-0.5 block text-sm font-medium text-text-tertiary">
                        {plan.price} /month · {plan.yearlyPrice} /year
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              {compare.map((section) => (
                <tbody key={section.group}>
                  <tr className="bg-surface-1">
                    <th colSpan={plans.length + 1} scope="colgroup" className="px-6 py-3 text-xs font-bold uppercase tracking-[0.1em] text-brand-600 dark:text-brand-300">
                      {section.group}
                    </th>
                  </tr>
                  {section.rows.map(([label, ...cells]) => (
                    <tr key={label} className="border-t border-border-light">
                      <th scope="row" className="px-6 py-4 text-sm font-medium text-text-secondary">
                        {label}
                      </th>
                      {cells.map((c, i) => (
                        <td key={i} className="px-6 py-4 text-center">
                          <CellValue value={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto grid max-w-6xl gap-14 px-4 py-24 md:px-6 lg:grid-cols-3">
          <div>
            <p className={EYEBROW}>FAQ</p>
            <h2 className={cn(HEADING, "mt-3 text-3xl leading-tight md:text-[38px]")}>Pricing questions</h2>
            <p className="mt-3.5 text-[15px] leading-relaxed text-text-tertiary">
              Questions about which plan fits?{" "}
              <Link to="/contact" className="font-semibold text-brand-600 hover:underline dark:text-brand-300">
                Talk to us
              </Link>
              .
            </p>
          </div>
          <div className="lg:col-span-2">
            <FaqAccordion items={FAQS} idPrefix="pricing-faq" />
          </div>
        </div>
      </section>

      <CtaBand />
    </MarketingLayout>
  );
}
