import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CtaBand,
  MarketingLayout,
  PageHero,
} from "@/components/marketing/MarketingLayout";
import { useMemo } from "react";
import { formatPlanLimit, usePlans, type PlanId, type PlanOption } from "@/lib/plans";
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
    q: "Is the free plan really free forever?",
    a: "Yes. The Forever Free plan has no time limit, no invoice cap and no Fintranzact branding on your documents.",
  },
  {
    q: "Do I need a credit card to sign up?",
    a: "No. Create an account with your email or phone number and start billing straight away.",
  },
  {
    q: "Can I switch plans later?",
    a: "Yes. Get in touch and we'll move your organization to a different plan; your data stays exactly where it is.",
  },
  {
    q: "How is Pro and Business pricing decided?",
    a: "Paid plans are priced to your team size and needs. Contact us and we'll send a quote.",
  },
];

const INCLUDED: Array<[IconSvgElement, string, string]> = [
  [Invoice01Icon, "GST invoicing", "Invoices, quotations, challans, credit notes and POS."],
  [QrCodeIcon, "e-Invoice & e-Way Bill", "IRN, signed QR codes and e-way bills from your invoices."],
  [TaxesIcon, "GST returns", "File-ready GSTR-1, GSTR-3B and GSTR-2B reconciliation."],
  [PackageIcon, "Inventory", "Items, variants, stock tracking and shipments."],
  [BankIcon, "Payments & banking", "Receipts, expenses, cash & bank and reconciliation."],
  [ChartBarLineIcon, "Reports", "P&L, balance sheet, day book, ledgers and tax reports."],
  [UserGroupIcon, "Team access", "Unlimited businesses and team members with roles."],
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
  // Paid-plan extras: included in the named plan and every plan listed after it.
  const from = (label: string, planId: PlanId): [string, ...Cell[]] => {
    const start = plans.findIndex((p) => p.id === planId);
    return [label, ...plans.map((_, i) => start >= 0 && i >= start)];
  };
  return [
    {
      group: "Billing & GST",
      rows: [
        row("Invoices, parties and payments", () => "Unlimited"),
        all("Quotations, challans and credit notes"),
        all("e-Invoicing and e-Way Bills"),
        all("GSTR-1, GSTR-3B and GSTR-2B"),
        row("No Fintranzact branding on documents", (l) => !l.pdfBranding),
      ],
    },
    {
      group: "Books & inventory",
      rows: [
        all("Inventory, variants and shipments"),
        all("Cash, bank and reconciliation"),
        all("Financial and tax reports"),
        row("Online store", (l) => l.onlineStore),
        row("Full data export", (l) => l.dataExport),
      ],
    },
    {
      group: "Team & limits",
      rows: [
        row("Organizations you can own", (l) => formatPlanLimit(l.maxOwnedOrgs)),
        row("Businesses per organization", (l) => formatPlanLimit(l.maxBusinesses)),
        row("Team members", (l) => formatPlanLimit(l.maxTeamMembers)),
        row("Devices signed in at once", (l) => formatPlanLimit(l.maxConcurrentSessions)),
        row("API keys", (l) => formatPlanLimit(l.maxApiKeys)),
        row("Recurring invoice runs a month", (l) => formatPlanLimit(l.recurringRunsPerMonth)),
        row("Audit log history", (l) => formatPlanLimit(l.auditRetentionDays, "days")),
      ],
    },
    {
      group: "Plan extras",
      rows: [
        from("Advanced automation and workflows", "pro"),
        from("Expanded collaboration", "pro"),
        from("Multi-tenant controls", "business"),
        from("Premium reporting", "business"),
      ],
    },
    {
      group: "Support",
      rows: [all("Help centre and email support"), from("Priority support", "pro"), from("Dedicated onboarding", "business")],
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
      description="Simple plans for GST billing and accounting, starting free. Compare Fintranzact plans, limits and features."
    >
      <PageHero
        eyebrow="Pricing"
        title="Simple pricing. Start free."
        subtitle="Everything you need to run your business is free, forever. Upgrade when your team needs more."
      />

      <section className="bg-surface-1">
        <div className="mx-auto max-w-6xl px-4 py-20 md:px-6">
          <PricingCards />
          <p className="mt-6 text-center text-sm text-text-tertiary">
            No credit card needed · Switch plans any time · Your data stays where it is
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
          <p className={cn(EYEBROW, "text-center")}>Included in every plan</p>
          <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>
            The full product, even on the free plan
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
                      <span className="mt-0.5 block text-sm font-medium text-text-tertiary">{plan.price}</span>
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
              Need a quote for Pro or Business?{" "}
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
