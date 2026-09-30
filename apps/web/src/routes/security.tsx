import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight01Icon,
  Bug01Icon,
  CheckmarkCircle02Icon,
  DatabaseIcon,
  Download04Icon,
  Key01Icon,
  LockIcon,
  Mail01Icon,
  SecurityCheckIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import {
  CtaBand,
  MarketingLayout,
  PageHero,
  SECURITY_EMAIL,
} from "@/components/marketing/MarketingLayout";
import { EYEBROW, HEADING } from "@/components/marketing/sections";
import { Icon, IconCircle, type IconSvgElement } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/security")({
  component: SecurityPage,
});

/*
 * Every statement here describes what the code does today:
 *   - field encryption: packages/db/src/crypto.ts, packages/api/src/lib/field-encryption.ts,
 *     share-links.ts, provision-tenant.ts
 *   - sign-in and sessions: packages/api/src/routers/auth.ts, context.ts
 *   - roles: packages/api/src/lib/permissions.ts; audit log: lib/audit.ts
 *   - backups: scripts/backup.sh, docker-compose.prod.yml
 * Update this page when any of those change.
 */

const PILLARS: Array<{ icon: IconSvgElement; title: string; points: string[] }> = [
  {
    icon: LockIcon,
    title: "Encryption",
    points: [
      "Every connection to Fintranzact, from the browser, the desktop app or the mobile app, uses HTTPS.",
      "Your e-invoice (IRP) and e-way bill portal credentials and shipping carrier API keys are encrypted with AES-256-GCM before they are stored.",
      "Database passwords and the tokens behind invoice share links are encrypted the same way. Encryption keys can be rotated without losing data.",
      "Passwords are hashed with Argon2id, and sign-in links are stored only as a hash, so neither can be read back from our database.",
    ],
  },
  {
    icon: UserGroupIcon,
    title: "Access control",
    points: [
      "Invite your team with a role: Owner, Admin, Sales Manager, Seller or Accountant. Each role sees and does only what it needs.",
      "Permissions are checked on our servers for every request, not just hidden in the screen.",
      "Every business's data is kept apart: each request is limited to the organisation and business you are signed in to.",
      "Changes to your books are recorded in an audit log with who made them and when.",
    ],
  },
  {
    icon: Key01Icon,
    title: "Sign-in & sessions",
    points: [
      "Sign-in links sent by email work once and expire after 15 minutes.",
      "Repeated failed sign-ins are rate-limited, and sign-up is protected against bots.",
      "Browser sessions live in secure, HTTP-only cookies and end after 14 days without use.",
      "See every device signed in to your account under Settings and sign any of them out, or all of them at once.",
      "The mobile app can be locked with a PIN or your phone's fingerprint or face unlock.",
    ],
  },
  {
    icon: DatabaseIcon,
    title: "Backups & your data",
    points: [
      "Our backup job takes a full database backup and a separate dump of each database every night.",
      "Each dump is restored into a scratch database to prove it can be recovered, and backups are kept for 30 days.",
      "You can export all of your data whenever you want, and import it again. We never sell your data.",
    ],
  },
];

const REPORT_STEPS: Array<[string, string]> = [
  ["Email us", `Write to ${SECURITY_EMAIL} with what you found, the steps to reproduce it and the impact you expect.`],
  ["We confirm", "We acknowledge every report within 48 hours and keep you updated while we investigate."],
  ["We fix it", "Critical issues get a fix or a mitigation plan within 7 days. We will tell you when it is resolved."],
];

const IN_SCOPE = [
  "Signing in as someone else, or bypassing a role's permissions",
  "Seeing or changing another business's data",
  "SQL injection, cross-site scripting (XSS) and CSRF",
  "Session hijacking or fixation",
  "Bypassing rate limits or bot protection",
  "Sensitive data in logs, error messages or share links",
];

const OUT_OF_SCOPE = [
  "Volumetric denial of service",
  "Social engineering of our team or customers",
  "Issues in third-party dependencies (please report them upstream)",
  "Attacks that need physical access to a device or server",
];

function SecurityPage() {
  return (
    <MarketingLayout
      title="Security"
      description="How Fintranzact protects your books: encryption of sensitive credentials, role-based access, secure sessions, nightly tested backups and responsible disclosure."
    >
      <PageHero
        eyebrow="Security"
        title="Your books, kept safe"
        subtitle="Fintranzact holds your invoices, ledgers and tax data. Here is how we protect them, and how to tell us if you find a problem."
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="#report"
            className="inline-flex h-[52px] items-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-[0_12px_28px_-10px_rgba(59,94,170,.7)] transition hover:bg-brand-700"
          >
            <Icon icon={Bug01Icon} size={18} />
            Report a vulnerability
          </a>
          <Link
            to="/privacy"
            className="inline-flex h-[52px] items-center rounded-xl border border-[#cfd8ea] bg-white px-6 text-base font-semibold text-[#0f1b3d] transition hover:border-brand-300 dark:border-white/15 dark:bg-white/5 dark:text-white"
          >
            Privacy policy
          </Link>
        </div>
      </PageHero>

      <section>
        <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
          <p className={cn(EYEBROW, "text-center")}>How we protect your data</p>
          <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>Security built into every layer</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {PILLARS.map((pillar) => (
              <div key={pillar.title} className="rounded-[22px] border border-border-light bg-surface-0 p-8">
                <IconCircle icon={pillar.icon} size="lg" />
                <h3 className="mt-5 text-lg font-bold text-text-primary">{pillar.title}</h3>
                <ul className="mt-4 space-y-3 text-[15px] leading-relaxed text-text-secondary">
                  {pillar.points.map((point) => (
                    <li key={point} className="flex gap-2.5">
                      <Icon icon={CheckmarkCircle02Icon} size={20} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-6 flex items-start gap-4 rounded-2xl border border-border-light bg-surface-1 p-6">
            <IconCircle icon={Download04Icon} />
            <p className="text-[15px] leading-relaxed text-text-secondary">
              Prefer to run it yourself? Fintranzact can also be self-hosted on your own server, with the same backup
              job and security settings.
            </p>
          </div>
        </div>
      </section>

      <section id="report" className="scroll-mt-24 bg-surface-1">
        <div className="mx-auto grid max-w-6xl items-start gap-10 px-4 py-24 md:px-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <p className={EYEBROW}>Responsible disclosure</p>
            <h2 className={cn(HEADING, "mt-3 text-3xl leading-tight md:text-[38px]")}>Found a security issue?</h2>
            <p className="mt-3.5 text-[15px] leading-relaxed text-text-tertiary">
              Please tell us privately before sharing it anywhere else, and give us a reasonable time to fix it. Don&apos;t
              access, change or delete data that isn&apos;t yours while testing. We won&apos;t take action against anyone who
              reports in good faith and follows these rules.
            </p>
            <a
              href={`mailto:${SECURITY_EMAIL}`}
              className="mt-6 inline-flex items-center gap-3 rounded-2xl border border-border-light bg-surface-0 p-5 text-[15px] font-semibold text-brand-600 hover:border-brand-300 dark:text-brand-300"
            >
              <IconCircle icon={Mail01Icon} />
              {SECURITY_EMAIL}
              <Icon icon={ArrowRight01Icon} size={16} strokeWidth={2} />
            </a>
          </div>

          <div className="space-y-8 lg:col-span-3">
            <div className="grid gap-6 sm:grid-cols-3">
              {REPORT_STEPS.map(([title, body], i) => (
                <div key={title}>
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-600 font-display text-lg font-extrabold text-white">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 text-base font-bold text-text-primary">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-text-tertiary">{body}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <ScopeList icon={SecurityCheckIcon} title="In scope" items={IN_SCOPE} />
              <ScopeList icon={Bug01Icon} title="Out of scope" items={OUT_OF_SCOPE} />
            </div>
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
