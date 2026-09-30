import { createFileRoute, Link } from "@tanstack/react-router";
import { partnerBadges } from "@fintranzact/shared";
import { PartnerBadge } from "@/components/ui/PartnerBadge";
import {
  CONTACT_EMAIL,
  CtaBand,
  MarketingLayout,
  PageHero,
} from "@/components/marketing/MarketingLayout";
import { EYEBROW, HEADING } from "@/components/marketing/sections";
import {
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  HeadphonesIcon,
  Money03Icon,
  Target02Icon,
  UserGroupIcon,
  BookOpen01Icon,
} from "@hugeicons/core-free-icons";
import { Icon, IconCircle, type IconSvgElement } from "@/components/ui/Icon";
import { PARTNER_PROGRAMS } from "@/lib/partner-programs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/partners/")({
  component: PartnersPage,
});

const BENEFITS: Array<[IconSvgElement, string, string]> = [
  [Money03Icon, "Partner earnings", "Earn on the paid subscriptions your clients take up. We share the terms when you apply."],
  [HeadphonesIcon, "Priority help", "A direct line to our team for you and the businesses you bring on."],
  [BookOpen01Icon, "Training & material", "Product walkthroughs, guides and ready-to-use sales material."],
  [Target02Icon, "Leads from us", "Businesses that ask us for setup help can be introduced to partners near them."],
];

const STEPS: Array<[string, string]> = [
  ["Apply", "Tell us about you or your firm on the short application form."],
  ["Get onboarded", "We walk you through the product and the partner programme."],
  ["Grow together", "Bring clients on, and we support you and them along the way."],
];

function PartnersPage() {
  return (
    <MarketingLayout
      title="Partner with us"
      description="Join the Fintranzact partner programme for accountants, CA firms, resellers and tech companies serving Indian businesses, and earn on the plans you bring in."
    >
      <PageHero
        eyebrow="Partner with us"
        title="Grow your practice with Fintranzact"
        subtitle="Join our partner programme for accountants, resellers and technology companies serving Indian businesses."
      >
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            to="/partners/apply"
            className="inline-flex h-[52px] items-center rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-[0_12px_28px_-10px_rgba(59,94,170,.7)] transition hover:bg-brand-700"
          >
            Become a partner
          </Link>
          <Link
            to="/find-a-partner"
            className="inline-flex h-[52px] items-center rounded-xl border border-border-medium bg-surface-0 px-6 text-base font-semibold text-text-primary transition hover:border-brand-500"
          >
            Find a partner
          </Link>
          <Link
            to="/partner-portal"
            className="inline-flex h-[52px] items-center px-2 text-base font-semibold text-brand-600 hover:underline dark:text-brand-300"
          >
            Partner login →
          </Link>
        </div>
      </PageHero>

      <section className="bg-surface-1">
        <div className="mx-auto max-w-6xl px-4 py-20 md:px-6">
          <p className={cn(EYEBROW, "text-center")}>Partner programmes</p>
          <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>Choose how you want to work with us</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {PARTNER_PROGRAMS.map((p) => (
              <div key={p.id} className="flex flex-col rounded-[22px] border border-border-light bg-surface-0 p-8">
                <IconCircle icon={p.icon} size="lg" />
                <h3 className="mt-5 text-lg font-bold text-text-primary">{p.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-text-tertiary">{p.body}</p>
                <ul className="mt-5 flex-1 space-y-2.5 text-[15px] text-text-secondary">
                  {p.points.map((point) => (
                    <li key={point} className="flex gap-2.5">
                      <Icon icon={CheckmarkCircle02Icon} size={20} className="shrink-0 text-brand-600 dark:text-brand-300" />
                      {point}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/partners/apply"
                  search={{ type: p.id }}
                  className="mt-7 flex h-12 items-center justify-center rounded-xl border border-border-medium px-3 text-center text-[15px] font-semibold text-text-primary transition hover:border-brand-500 hover:text-brand-700 dark:hover:text-white"
                >
                  {p.apply}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
          <p className={cn(EYEBROW, "text-center")}>Why partner with us</p>
          <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>Built to help you and your clients</h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {BENEFITS.map(([icon, title, body]) => (
              <div key={title} className="rounded-2xl border border-border-light bg-surface-0 p-6">
                <IconCircle icon={icon} />
                <h3 className="mt-4 text-base font-bold text-text-primary">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-text-tertiary">{body}</p>
              </div>
            ))}
          </div>

          <div className="mt-20 grid gap-6 md:grid-cols-3">
            {STEPS.map(([title, body], i) => (
              <div key={title} className="flex gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600 font-display text-lg font-extrabold text-white">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-base font-bold text-text-primary">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-text-tertiary">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border-light">
        <div className="mx-auto max-w-6xl px-4 py-20 md:px-6">
          <p className={cn(EYEBROW, "text-center")}>Partner badges</p>
          <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>Earn more as you grow</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-[15px] leading-relaxed text-text-tertiary">
            Every approved partner gets a referral code. Businesses that sign up with it are yours, and your badge and commission rise
            with the number of them on a paid plan.
          </p>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {partnerBadges.map((b) => (
              <div key={b.id} className="rounded-2xl border border-border-light bg-surface-0 p-6 text-center">
                <PartnerBadge badge={b.id} size="md" />
                <p className="mt-4 font-display text-3xl font-extrabold text-text-primary">{b.commissionPercent}%</p>
                <p className="text-sm text-text-tertiary">commission on plan fees</p>
                <p className="mt-3 text-sm font-semibold text-text-secondary">
                  {b.minPaidReferrals === 0 ? "When you're approved" : `${b.minPaidReferrals}+ paying businesses`}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-surface-1">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-20 md:px-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <p className={EYEBROW}>Apply</p>
            <h2 className={cn(HEADING, "mt-3 text-3xl leading-tight md:text-[38px]")}>Become a Fintranzact partner</h2>
            <p className="mt-3.5 max-w-xl text-[15px] leading-relaxed text-text-tertiary">
              The application takes a few minutes. We usually reply within two business days, and you can follow your
              application in the partner portal.
            </p>
            <Link
              to="/partners/apply"
              className="mt-7 inline-flex h-[52px] items-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-[0_12px_28px_-10px_rgba(59,94,170,.7)] transition hover:bg-brand-700"
            >
              Start your application
              <Icon icon={ArrowRight01Icon} size={18} strokeWidth={2} />
            </Link>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-border-light bg-surface-0 p-5 lg:col-span-2">
            <IconCircle icon={UserGroupIcon} />
            <p className="min-w-0 text-sm text-text-secondary">
              Questions first? Email{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="break-words font-semibold text-brand-600 hover:underline dark:text-brand-300"
              >
                {CONTACT_EMAIL}
              </a>
            </p>
          </div>
        </div>
      </section>

      <CtaBand title="Want to try it first?" body="Create a free account and see how Fintranzact works for your clients." />
    </MarketingLayout>
  );
}
