import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useRef, useState, type FormEvent } from "react";
import { partnerApplicationSchema, partnerBadges, partnerClientCounts, type PartnerType } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { TurnstileModal } from "@/components/ui/TurnstileModal";
import { PartnerBadge } from "@/components/ui/PartnerBadge";
import {
  CONTACT_EMAIL,
  CtaBand,
  MarketingLayout,
  PageHero,
} from "@/components/marketing/MarketingLayout";
import { EYEBROW, HEADING } from "@/components/marketing/sections";
import {
  ApiIcon,
  CheckmarkCircle02Icon,
  FileValidationIcon,
  HeadphonesIcon,
  Money03Icon,
  SentIcon,
  Store01Icon,
  Target02Icon,
  UserGroupIcon,
  BookOpen01Icon,
} from "@hugeicons/core-free-icons";
import { Icon, IconCircle, type IconSvgElement } from "@/components/ui/Icon";
import { InputField, SelectField, TextareaField } from "@/components/ui/FormField";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/partners")({
  component: PartnersPage,
});

type ProgramId = PartnerType;

const PROGRAMS: Array<{ id: ProgramId; icon: IconSvgElement; title: string; apply: string; body: string; points: string[] }> = [
  {
    id: "accountant",
    icon: FileValidationIcon,
    title: "Accountants & CA firms",
    apply: "Apply as an accountant",
    body: "Manage all your clients' books, GST returns and reconciliations from one login.",
    points: ["One dashboard for every client business", "Role-based access with your staff", "GSTR-1, 3B and 2B ready to review"],
  },
  {
    id: "reseller",
    icon: Store01Icon,
    title: "Resellers & consultants",
    apply: "Apply as a reseller",
    body: "Recommend Fintranzact to the businesses you work with and help them get set up.",
    points: ["Earn on the paid plans you bring in", "Sales and onboarding material", "A partner contact at Fintranzact"],
  },
  {
    id: "technology",
    icon: ApiIcon,
    title: "Technology partners",
    apply: "Apply as a technology partner",
    body: "Connect your app to Fintranzact through our API and reach Indian businesses that bill with us.",
    points: ["API keys and developer docs", "Help testing your integration", "Listed as an integration partner"],
  },
];

const BENEFITS: Array<[IconSvgElement, string, string]> = [
  [Money03Icon, "Partner earnings", "Earn on the paid subscriptions your clients take up. We share the terms when you apply."],
  [HeadphonesIcon, "Priority help", "A direct line to our team for you and the businesses you bring on."],
  [BookOpen01Icon, "Training & material", "Product walkthroughs, guides and ready-to-use sales material."],
  [Target02Icon, "Leads from us", "Businesses that ask us for setup help can be introduced to partners near them."],
];

const STEPS: Array<[string, string]> = [
  ["Apply", "Tell us about you or your firm using the form below."],
  ["Get onboarded", "We walk you through the product and the partner programme."],
  ["Grow together", "Bring clients on, and we support you and them along the way."],
];

type FieldErrors = Partial<Record<"contactName" | "companyName" | "email" | "phone" | "city" | "website", string>>;

function PartnersPage() {
  const [program, setProgram] = useState<ProgramId>("accountant");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [city, setCity] = useState("");
  const [website, setWebsite] = useState("");
  const [clientCount, setClientCount] = useState("");
  const [message, setMessage] = useState("");
  const [listPublicly, setListPublicly] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [sent, setSent] = useState(false);

  const submit = trpc.partner.submitApplication.useMutation({ onSuccess: () => setSent(true) });

  // Bot protection: the Turnstile modal hands us a token, then we submit.
  const [showTurnstile, setShowTurnstile] = useState(false);
  const pendingRef = useRef<((token: string) => void) | null>(null);
  const onVerified = useCallback((token: string) => {
    setShowTurnstile(false);
    pendingRef.current?.(token);
    pendingRef.current = null;
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const application = {
      contactName: name,
      companyName: company,
      email,
      phone,
      city,
      website,
      partnerType: program,
      clientCount: clientCount ? (clientCount as (typeof partnerClientCounts)[number]) : undefined,
      message,
      listPublicly,
    };
    const parsed = partnerApplicationSchema.safeParse(application);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FieldErrors;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    pendingRef.current = (turnstileToken) => submit.mutate({ ...application, turnstileToken });
    setShowTurnstile(true);
  }

  return (
    <MarketingLayout title="Partner with us">
      <PageHero
        eyebrow="Partner with us"
        title="Grow your practice with Fintranzact"
        subtitle="Join our partner programme for accountants, resellers and technology companies serving Indian businesses."
      >
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href="#apply"
            className="inline-flex h-[52px] items-center rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-[0_12px_28px_-10px_rgba(59,94,170,.7)] transition hover:bg-brand-700"
          >
            Become a partner
          </a>
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
            {PROGRAMS.map((p) => (
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
                <a
                  href="#apply"
                  onClick={() => setProgram(p.id)}
                  className="mt-7 flex h-12 items-center justify-center rounded-xl border border-border-medium text-[15px] font-semibold text-text-primary transition hover:border-brand-500 hover:text-brand-700 dark:hover:text-white"
                >
                  {p.apply}
                </a>
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

      <section id="apply" className="scroll-mt-24 bg-surface-1">
        <div className="mx-auto grid max-w-6xl items-start gap-10 px-4 py-20 md:px-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <p className={EYEBROW}>Apply</p>
            <h2 className={cn(HEADING, "mt-3 text-3xl leading-tight md:text-[38px]")}>Become a Fintranzact partner</h2>
            <p className="mt-3.5 text-[15px] leading-relaxed text-text-tertiary">
              Tell us a little about yourself. We usually reply within two business days.
            </p>
            <div className="mt-6 flex items-center gap-3 rounded-2xl border border-border-light bg-surface-0 p-5">
              <IconCircle icon={UserGroupIcon} />
              <p className="text-sm text-text-secondary">
                Questions first? Email{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-brand-600 hover:underline dark:text-brand-300">
                  {CONTACT_EMAIL}
                </a>
              </p>
            </div>
          </div>

          {sent ? (
            <div className="rounded-[22px] border border-border-light bg-surface-0 p-9 text-center shadow-[0_24px_60px_-34px_rgba(15,27,61,.35)] lg:col-span-3">
              <IconCircle icon={CheckmarkCircle02Icon} size="lg" className="mx-auto" />
              <h3 className="mt-5 text-xl font-bold text-text-primary">Application received</h3>
              <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-text-tertiary">
                Thank you, {name.split(" ")[0] || "partner"}. Our partner team will review it and get back to you at {email} within two
                business days.
              </p>
            </div>
          ) : (
          <form
            onSubmit={handleSubmit}
            noValidate
            className="rounded-[22px] border border-border-light bg-surface-0 p-7 shadow-[0_24px_60px_-34px_rgba(15,27,61,.35)] md:p-9 lg:col-span-3"
          >
            <SelectField
              label="Partner programme"
              required
              value={program}
              onChange={(e) => setProgram(e.target.value as ProgramId)}
            >
              {PROGRAMS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </SelectField>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <InputField label="Name" required value={name} error={errors.contactName} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Your full name" />
              <InputField
                label="Company or firm"
                required
                value={company}
                error={errors.companyName}
                onChange={(e) => setCompany(e.target.value)}
                autoComplete="organization"
                placeholder="Firm or company name"
              />
              <InputField
                label="Email"
                type="email"
                required
                value={email}
                error={errors.email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@yourfirm.com"
              />
              <div>
                <PhoneInput label="Phone" value={phone} onChange={setPhone} />
                {errors.phone ? <p className="mt-1 text-xs text-red-600">{errors.phone}</p> : null}
              </div>
              <InputField label="City" required value={city} error={errors.city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" placeholder="Mumbai" />
              <InputField label="Website" value={website} error={errors.website} onChange={(e) => setWebsite(e.target.value)} autoComplete="url" placeholder="yourfirm.com" />
              <SelectField label="Clients you serve" value={clientCount} onChange={(e) => setClientCount(e.target.value)}>
                <option value="">Choose…</option>
                {partnerClientCounts.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </SelectField>
            </div>
            <div className="mt-5">
              <TextareaField
                label="Tell us about your work"
                className="min-h-32"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="How many clients you serve, the tools you use today, anything we should know."
              />
            </div>
            <label className="mt-5 flex items-start gap-3 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={listPublicly}
                onChange={(e) => setListPublicly(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border-medium accent-brand-600"
              />
              <span>Once approved, list my firm in the Fintranzact partner directory (company name, city and website only).</span>
            </label>
            {submit.error ? (
              <p role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                {submit.error.message}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={submit.isPending}
              className="mt-7 inline-flex h-[52px] items-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-[0_12px_28px_-10px_rgba(59,94,170,.7)] transition hover:bg-brand-700 disabled:opacity-60"
            >
              <Icon icon={SentIcon} size={18} />
              {submit.isPending ? "Sending…" : "Send application"}
            </button>
            <p className="mt-3 text-xs text-text-tertiary">We usually reply within two business days.</p>
          </form>
          )}
        </div>
      </section>

      <TurnstileModal
        open={showTurnstile}
        onVerified={onVerified}
        onClose={() => {
          setShowTurnstile(false);
          pendingRef.current = null;
        }}
      />

      <CtaBand title="Want to try it first?" body="Create a free account and see how Fintranzact works for your clients." />
    </MarketingLayout>
  );
}

