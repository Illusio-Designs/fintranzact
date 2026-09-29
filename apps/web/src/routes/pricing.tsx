import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CtaBand,
  MarketingLayout,
  PageHero,
} from "@/components/marketing/MarketingLayout";
import { PLAN_OPTIONS } from "@/lib/plans";
import { cn } from "@/lib/utils";

import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";
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

function PricingPage() {
  return (
    <MarketingLayout title="Pricing">
      <PageHero
        eyebrow="Pricing"
        title="Simple pricing. Start free."
        subtitle="Everything you need to run your business is free. Upgrade when your team needs more."
      />

      <section className="mx-auto max-w-6xl px-4 py-16 md:px-6">
        <div className="grid gap-6 md:grid-cols-3">
          {PLAN_OPTIONS.map((plan) => (
            <div
              key={plan.id}
              className={cn(
                "card flex flex-col p-6",
                plan.highlight && "ring-2 ring-brand-600",
              )}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{plan.name}</h2>
                {plan.highlight && (
                  <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                    Most popular
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-text-tertiary">{plan.tagline}</p>
              <p className="mt-5 text-3xl font-semibold">{plan.price}</p>

              <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <Icon icon={CheckmarkCircle02Icon} size={18} className="text-brand-600" />
                    <span className="text-text-secondary">{feature}</span>
                  </li>
                ))}
              </ul>

              {plan.price === "Custom" ? (
                <Link to="/contact" className="btn-ghost mt-8 justify-center border border-border-light">
                  Contact sales
                </Link>
              ) : (
                <Link
                  to="/login"
                  search={{ mode: "register" }}
                  className="btn-primary mt-8 justify-center"
                >
                  Get started free
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border-light">
        <div className="mx-auto max-w-3xl px-4 py-16 md:px-6">
          <h2 className="text-2xl font-semibold">Frequently asked questions</h2>
          <div className="mt-8 divide-y divide-border-light">
            {FAQS.map((faq) => (
              <details key={faq.q} className="group py-4">
                <summary className="cursor-pointer list-none font-medium">
                  <span className="flex items-center justify-between gap-4">
                    {faq.q}
                    <span className="text-text-tertiary transition group-open:rotate-45" aria-hidden>
                      +
                    </span>
                  </span>
                </summary>
                <p className="mt-2 text-sm text-text-tertiary">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </MarketingLayout>
  );
}
