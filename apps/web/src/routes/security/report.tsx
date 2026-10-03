import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Bug01Icon,
  CheckmarkCircle02Icon,
  Mail01Icon,
  SecurityCheckIcon,
  Shield01Icon,
} from "@hugeicons/core-free-icons";
import {
  CONTACT_EMAIL,
  CtaBand,
  MarketingLayout,
  PageHero,
  SECURITY_EMAIL,
} from "@/components/marketing/MarketingLayout";
import { EYEBROW, FaqAccordion, HEADING } from "@/components/marketing/sections";
import { Icon, IconCircle, type IconSvgElement } from "@/components/ui/Icon";
import {
  ACKNOWLEDGE_WITHIN,
  COVERED_SERVICES,
  CRITICAL_FIX_WITHIN,
  IN_SCOPE,
  OUT_OF_SCOPE,
  reportSteps,
} from "@/lib/security-disclosure";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/security/report")({
  component: ReportVulnerabilityPage,
});

/*
 * The responsible-disclosure policy. The response times and scope come from
 * lib/security-disclosure.ts, which the /security page summarises too, and
 * public/.well-known/security.txt links here as its Policy.
 */

const WHAT_TO_INCLUDE = [
  "Where the problem is: the page, screen or API endpoint, and whether it is the web app, the desktop app, the mobile app or the API.",
  "Step-by-step instructions to reproduce it, with the requests, payloads or screenshots you used.",
  "What an attacker could see or do with it, and which accounts or businesses it could affect.",
  "The email of the test account you used, and roughly when you tested, so we can find it in our logs.",
  "How we can reach you for follow-up questions.",
];

const TESTING_RULES = [
  "Only test with accounts and businesses you created yourself.",
  "Don't access, change or delete data that isn't yours. If you come across someone else's data, stop, don't keep a copy, and tell us.",
  "Don't run automated scans that flood the service, and don't degrade it for other people.",
  "Don't send spam or phishing, and don't try to trick our team or customers.",
  "Keep the details private until we have fixed the issue and agreed with you that it can be shared.",
];

const FAQS = [
  {
    q: "Can I test on my own Fintranzact account?",
    a: "Yes. Create an account and your own test businesses, and test against those. Use the email of that account when you report, so we can match your activity in our logs.",
  },
  {
    q: "What if I see another customer's data by accident?",
    a: "Stop testing that issue straight away, don't download or keep the data, and tell us what you saw in your report. Seeing another business's data is exactly the kind of problem we want to hear about.",
  },
  {
    q: "How will I know when it is fixed?",
    a: `We reply within ${ACKNOWLEDGE_WITHIN} of your report, keep you updated while we investigate, and tell you when the issue is resolved. Critical issues get a fix or a mitigation plan within ${CRITICAL_FIX_WITHIN}.`,
  },
  {
    q: "I have a problem with my account, not a security issue. Where do I go?",
    a: `For sign-in trouble, billing questions or anything else about using Fintranzact, write to ${CONTACT_EMAIL} or use the contact page. The security address is only for vulnerabilities.`,
  },
];

function ReportVulnerabilityPage() {
  return (
    <MarketingLayout
      title="Report a vulnerability"
      description={`How to report a security vulnerability in Fintranzact: what is in scope, what to include, how fast we respond (within ${ACKNOWLEDGE_WITHIN}) and our safe harbour.`}
    >
      <PageHero
        eyebrow="Security"
        title="Report a vulnerability"
        subtitle="Found a security problem in Fintranzact? Tell us privately and we will work with you to fix it quickly."
      >
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href={`mailto:${SECURITY_EMAIL}`}
            className="inline-flex h-[52px] items-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-[0_12px_28px_-10px_rgba(59,94,170,.7)] transition hover:bg-brand-700"
          >
            <Icon icon={Mail01Icon} size={18} />
            Email the security team
          </a>
          <Link
            to="/security"
            className="inline-flex h-[52px] items-center gap-1.5 px-2 text-base font-semibold text-brand-600 hover:underline dark:text-brand-300"
          >
            <Icon icon={ArrowLeft01Icon} size={16} strokeWidth={2} />
            How we protect your data
          </Link>
        </div>
      </PageHero>

      {/* ── How it works ─────────────────────────────────────── */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-24">
          <p className={cn(EYEBROW, "text-center")}>How reporting works</p>
          <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>Three steps, and we keep you posted</h2>
          <ol className="mt-12 grid gap-6 md:grid-cols-3">
            {reportSteps(SECURITY_EMAIL).map(([title, body], i) => (
              <li key={title} className="rounded-2xl border border-border-light bg-surface-0 p-7">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-600 font-display text-lg font-extrabold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-5 text-lg font-bold text-text-primary">{title}</h3>
                <p className="mt-2 break-words text-[15px] leading-relaxed text-text-tertiary">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── What to include ──────────────────────────────────── */}
      <section className="bg-surface-1">
        <div className="mx-auto grid max-w-6xl items-start gap-10 px-4 py-20 md:px-6 md:py-24 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <p className={EYEBROW}>Your report</p>
            <h2 className={cn(HEADING, "mt-3 text-3xl leading-tight md:text-[38px]")}>What to include</h2>
            <p className="mt-3.5 text-[15px] leading-relaxed text-text-tertiary">
              A clear report helps us confirm the problem and fix it sooner. Plain text is fine, and so is a short
              screen recording if it is easier to show than to describe.
            </p>
          </div>
          <ul className="space-y-3 lg:col-span-3">
            {WHAT_TO_INCLUDE.map((item) => (
              <li key={item} className="flex gap-3 rounded-2xl border border-border-light bg-surface-0 p-5 text-[15px] leading-relaxed text-text-secondary">
                <Icon icon={CheckmarkCircle02Icon} size={20} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Scope ────────────────────────────────────────────── */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-24">
          <p className={cn(EYEBROW, "text-center")}>Scope</p>
          <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>What we want to hear about</h2>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            <ScopeList icon={Shield01Icon} title="Services covered" items={COVERED_SERVICES} />
            <ScopeList icon={SecurityCheckIcon} title="In scope" items={IN_SCOPE} />
            <ScopeList icon={Bug01Icon} title="Out of scope" items={OUT_OF_SCOPE} />
          </div>
        </div>
      </section>

      {/* ── Rules and safe harbour ───────────────────────────── */}
      <section className="bg-surface-1">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-20 md:px-6 md:py-24 lg:grid-cols-2">
          <div className="rounded-[22px] border border-border-light bg-surface-0 p-7 md:p-8">
            <p className={EYEBROW}>Rules for testing</p>
            <h2 className={cn(HEADING, "mt-3 text-2xl leading-tight md:text-[30px]")}>Test responsibly</h2>
            <ul className="mt-5 space-y-3 text-[15px] leading-relaxed text-text-secondary">
              {TESTING_RULES.map((rule) => (
                <li key={rule} className="flex gap-2.5">
                  <Icon icon={CheckmarkCircle02Icon} size={20} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[22px] border border-border-light bg-surface-0 p-7 md:p-8">
            <p className={EYEBROW}>Safe harbour</p>
            <h2 className={cn(HEADING, "mt-3 text-2xl leading-tight md:text-[30px]")}>We won&apos;t act against good-faith research</h2>
            <div className="mt-5 space-y-3 text-[15px] leading-relaxed text-text-secondary">
              <p>
                If you report in good faith and follow the rules on this page, we will not take legal action against you
                or ask anyone else to, for your research or your report.
              </p>
              <p>
                Good faith means you tried to avoid harm to our customers and our service, you only went as far as
                needed to show the problem, and you gave us a reasonable time to fix it before telling anyone else.
              </p>
              <p>
                If you are not sure whether something you want to try is allowed, write to{" "}
                <a
                  href={`mailto:${SECURITY_EMAIL}`}
                  className="break-words font-semibold text-brand-600 hover:underline dark:text-brand-300"
                >
                  {SECURITY_EMAIL}
                </a>{" "}
                and ask first.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <section>
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 md:px-6 md:py-24 lg:grid-cols-3">
          <div>
            <p className={EYEBROW}>Questions</p>
            <h2 className={cn(HEADING, "mt-3 text-3xl leading-tight md:text-[38px]")}>Before you report</h2>
            <p className="mt-3.5 text-[15px] leading-relaxed text-text-tertiary">
              Our security contact is also published in{" "}
              <a
                href="/.well-known/security.txt"
                className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
              >
                security.txt
              </a>
              .
            </p>
            <a
              href={`mailto:${SECURITY_EMAIL}`}
              className="mt-6 flex min-w-0 items-center gap-3 rounded-2xl border border-border-light bg-surface-0 p-5 text-[15px] font-semibold text-brand-600 hover:border-brand-300 dark:text-brand-300"
            >
              <IconCircle icon={Mail01Icon} />
              <span className="min-w-0 break-words">{SECURITY_EMAIL}</span>
              <Icon icon={ArrowRight01Icon} size={16} strokeWidth={2} className="shrink-0" />
            </a>
          </div>
          <div className="lg:col-span-2">
            <FaqAccordion items={FAQS} idPrefix="report-faq" />
          </div>
        </div>
      </section>

      <CtaBand />
    </MarketingLayout>
  );
}

function ScopeList({ icon, title, items }: { icon: IconSvgElement; title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-border-light bg-surface-0 p-6">
      <div className="flex items-center gap-3">
        <IconCircle icon={icon} size="sm" />
        <h3 className="text-base font-bold text-text-primary">{title}</h3>
      </div>
      <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-text-secondary">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
