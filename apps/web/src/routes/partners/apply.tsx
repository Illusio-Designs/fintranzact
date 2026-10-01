import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useRef, useState, type FormEvent } from "react";
import { partnerApplicationSchema, partnerClientCounts, type PartnerType } from "@fintranzact/shared";
import {
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  SentIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { TurnstileModal } from "@/components/ui/TurnstileModal";
import { CONTACT_EMAIL, MarketingLayout, PageHero } from "@/components/marketing/MarketingLayout";
import { EYEBROW, HEADING } from "@/components/marketing/sections";
import { Icon, IconCircle } from "@/components/ui/Icon";
import { InputField, SelectField, TextareaField } from "@/components/ui/FormField";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { PARTNER_PROGRAMS, parsePartnerType } from "@/lib/partner-programs";
import { cn } from "@/lib/utils";

type ApplySearch = {
  /** Programme to pick on the form, from the "Apply as …" buttons on /partners. */
  type?: PartnerType;
};

export const Route = createFileRoute("/partners/apply")({
  validateSearch: (search: Record<string, unknown>): ApplySearch => {
    const type = parsePartnerType(search.type);
    return type ? { type } : {};
  },
  component: PartnerApplyPage,
});

const NEXT_STEPS: Array<[string, string]> = [
  ["We review your application", "Our partner team reads every application and replies by email, usually within two business days."],
  [
    "Follow it in the partner portal",
    "Sign in to the partner portal with the email you applied with to see where your application stands.",
  ],
  [
    "Get your referral code",
    "Once you're approved, your referral code, badge and the businesses you bring on appear in the portal.",
  ],
];

type FieldErrors = Partial<Record<"contactName" | "companyName" | "email" | "phone" | "city" | "website", string>>;

function PartnerApplyPage() {
  const search = Route.useSearch();
  const [program, setProgram] = useState<PartnerType>(search.type ?? "accountant");
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
    <MarketingLayout
      title="Apply to become a partner"
      description="Apply to the Fintranzact partner programme as an accountant, CA firm, reseller or technology partner. We usually reply within two business days."
    >
      <PageHero
        eyebrow="Partner with us"
        title="Apply to become a Fintranzact partner"
        subtitle="Tell us about you or your firm. It takes a few minutes, and our partner team usually replies within two business days."
      >
        <Link
          to="/partners"
          className="mt-6 inline-flex items-center gap-1.5 text-[15px] font-semibold text-brand-600 hover:underline dark:text-brand-300"
        >
          <Icon icon={ArrowLeft01Icon} size={16} strokeWidth={2} />
          About the partner programme
        </Link>
      </PageHero>

      <section className="bg-surface-1">
        <div className="mx-auto grid max-w-6xl items-start gap-10 px-4 py-16 md:px-6 md:py-20 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <p className={EYEBROW}>What happens next</p>
            <h2 className={cn(HEADING, "mt-3 text-2xl leading-tight md:text-[32px]")}>From application to your first referral</h2>
            <ol className="mt-7 space-y-6">
              {NEXT_STEPS.map(([title, body], i) => (
                <li key={title} className="flex gap-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 font-display text-base font-extrabold text-white">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-base font-bold text-text-primary">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-text-tertiary">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-8 flex items-center gap-3 rounded-2xl border border-border-light bg-surface-0 p-5">
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

          {sent ? (
            <div className="rounded-[22px] border border-border-light bg-surface-0 p-7 text-center shadow-[0_24px_60px_-34px_rgba(15,27,61,.35)] md:p-9 lg:col-span-3">
              <IconCircle icon={CheckmarkCircle02Icon} size="lg" className="mx-auto" />
              <h2 className="mt-5 text-xl font-bold text-text-primary">Application received</h2>
              <p className="mx-auto mt-2 max-w-md break-words text-[15px] leading-relaxed text-text-tertiary">
                Thank you, {name.split(" ")[0] || "partner"}. Our partner team will review it and get back to you at {email} within two
                business days.
              </p>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
                <Link to="/partner-portal" className="btn-primary inline-flex">
                  Open the partner portal
                </Link>
                <Link
                  to="/find-a-partner"
                  className="inline-flex h-10 items-center px-2 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
                >
                  See the partner directory
                </Link>
              </div>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              noValidate
              aria-label="Partner application"
              className="rounded-[22px] border border-border-light bg-surface-0 p-5 shadow-[0_24px_60px_-34px_rgba(15,27,61,.35)] sm:p-7 md:p-9 lg:col-span-3"
            >
              <SelectField
                label="Partner programme"
                required
                value={program}
                onChange={(e) => setProgram(e.target.value as PartnerType)}
              >
                {PARTNER_PROGRAMS.map((p) => (
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
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-medium accent-brand-600"
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
    </MarketingLayout>
  );
}
