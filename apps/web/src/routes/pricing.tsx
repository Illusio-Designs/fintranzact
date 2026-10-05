import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CtaBand,
  MarketingLayout,
  PageHero,
} from "@/components/marketing/MarketingLayout";
import { useMemo, useState } from "react";
import { formatPlanLimit, usePlans, type PlanOption } from "@/lib/plans";
import { ADDONS, isAddonAvailable, PLAN_GST_RATE_PERCENT, TRIAL_DAYS, YEARLY_SAVING_MONTHS, yearlyPrice, type BillingCycle } from "@fintranzact/shared";
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

/** The call to action the pricing page and its closing band use. */
const TRIAL_CTA = `Start your ${TRIAL_DAYS}-day Full Access Trial — no card needed`;

/** The add-on FAQ entry only appears while at least one add-on can be bought. */
const ADDON_FAQ: { q: string; a: string } = {
  q: "What are add-ons?",
  a: "Optional extras you buy on top of a plan and pay for separately. Each is billed monthly (or yearly with two months free), with GST added. Where two are tiers of one add-on, choosing one replaces the other. Cancel an add-on any time; it stays until the end of the period you paid for.",
};

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: "Is there a free plan?",
    a: `No. There are three paid plans, and every new organization starts with a ${TRIAL_DAYS}-day free trial on the plan it picks.`,
  },
  {
    q: "Do I need a credit card to start the trial?",
    a: "No. Create an account with your email or phone number and start billing straight away. You choose a plan and pay when the trial ends.",
  },
  {
    q: "What happens when the trial ends?",
    a: "Your account becomes read-only until you choose a plan. You can still view and search everything and download PDFs, and export your data on plans that include data export (Growth and Business). Nothing is deleted, and choosing a plan unlocks everything at once.",
  },
  {
    q: "Are the prices with GST?",
    a: `Prices are before ${PLAN_GST_RATE_PERCENT}% GST. GST is added at checkout and you get a GST invoice for every payment. Pay yearly and you get ${YEARLY_SAVING_MONTHS} months free.`,
  },
  {
    q: "How does cancelling work?",
    a: "Cancel any time from Settings → Billing. Your plan keeps running until the end of the period you have paid for, then the account becomes read-only and your data is kept. Moving to a cheaper plan takes effect at the end of the period; moving to a dearer one applies straight away, with credit for the unused time.",
  },
  {
    q: "Can I switch plans later?",
    a: "Yes. Change plan from Settings → Billing; your data stays exactly where it is.",
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

/** The paid add-ons, from the same catalogue the billing page sells (ex-GST, monthly; yearly is ten months). */
function AddonsSection({ cycle }: { cycle: BillingCycle }) {
  // Only add-ons whose feature exists are sold (ADDON_FEATURES[id].implemented); none available, nothing shown.
  const available = ADDONS.filter((a) => isAddonAvailable(a.id));
  if (available.length === 0) return null;
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
        <p className={cn(EYEBROW, "text-center")}>Add-ons</p>
        <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>Extras you can add to any plan</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-[15px] leading-relaxed text-text-tertiary">
          Billed separately from your plan. Where two are tiers of one add-on, choosing one replaces the other.
        </p>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {available.map((addon) => {
            const yearly = cycle === "yearly";
            const price = yearly ? yearlyPrice(addon.monthlyPriceInr) : addon.monthlyPriceInr;
            return (
              <div key={addon.id} className="flex flex-col rounded-2xl border border-border-light bg-surface-0 p-6">
                <h3 className="text-base font-bold text-text-primary">{addon.name}</h3>
                <p className="mt-1 text-sm text-text-tertiary">{addon.tagline}</p>
                <p className="mt-4 font-display text-3xl font-extrabold text-[#0f1b3d] dark:text-white">
                  ₹{price.toLocaleString("en-IN")}
                  <span className="text-sm font-medium text-text-tertiary"> {yearly ? "/year" : "/month"}</span>
                </p>
                <p className="text-xs text-text-tertiary">
                  + {PLAN_GST_RATE_PERCENT}% GST
                  {yearly ? <span className="ml-1 font-bold text-emerald-600">· {YEARLY_SAVING_MONTHS} months free</span> : null}
                </p>
                <ul className="mt-4 flex-1 space-y-2 text-sm text-text-secondary">
                  {addon.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Icon icon={Tick02Icon} size={16} strokeWidth={2.5} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-center text-sm text-text-tertiary">Add-on prices are before {PLAN_GST_RATE_PERCENT}% GST.</p>
      </div>
    </section>
  );
}

function PricingPage() {
  const { plans } = usePlans();
  const compare = useMemo(() => buildComparison(plans), [plans]);
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const faqs = useMemo(() => {
    const anyAddon = ADDONS.some((a) => isAddonAvailable(a.id));
    if (!anyAddon) return FAQS;
    const at = FAQS.findIndex((f) => f.q === "Can I switch plans later?");
    return [...FAQS.slice(0, at), ADDON_FAQ, ...FAQS.slice(at)];
  }, []);
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
          <PricingCards cycle={cycle} onCycleChange={setCycle} />
          <div className="mt-8 flex justify-center">
            <Link
              to="/register"
              search={{ plan: "growth" }}
              className="inline-flex h-[52px] items-center rounded-xl bg-brand-600 px-6 text-base font-bold text-white transition hover:bg-brand-700"
            >
              {TRIAL_CTA}
            </Link>
          </div>
        </div>
      </section>

      <AddonsSection cycle={cycle} />

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
            <FaqAccordion items={faqs} idPrefix="pricing-faq" />
          </div>
        </div>
      </section>

      <CtaBand cta={TRIAL_CTA} />
    </MarketingLayout>
  );
}
