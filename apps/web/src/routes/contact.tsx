import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import {
  CONTACT_EMAIL,
  CtaBand,
  DOCS_URL,
  MarketingLayout,
  PageHero,
  SECURITY_EMAIL,
} from "@/components/marketing/MarketingLayout";
import { ArrowRight01Icon, BookOpen01Icon, Mail01Icon, SecurityCheckIcon, SentIcon } from "@hugeicons/core-free-icons";
import { Icon, IconCircle, type IconSvgElement } from "@/components/ui/Icon";
import { InputField, TextareaField } from "@/components/ui/FormField";
import {
  EnquiryError,
  EnquirySent,
  HoneypotField,
  mailtoLink,
  useEnquiry,
} from "@/components/marketing/enquiry";

export const Route = createFileRoute("/contact")({
  component: ContactPage,
});

const CHANNELS: Array<{ icon: IconSvgElement; title: string; body: string; label: string; href: string }> = [
  {
    icon: Mail01Icon,
    title: "Sales & support",
    body: "Questions about plans, pricing or using Fintranzact.",
    label: CONTACT_EMAIL,
    href: `mailto:${CONTACT_EMAIL}`,
  },
  {
    icon: BookOpen01Icon,
    title: "Help centre",
    body: "Step-by-step guides for invoicing, GST, banking and more.",
    label: "Browse the docs",
    href: DOCS_URL,
  },
  {
    icon: SecurityCheckIcon,
    title: "Security",
    body: "Report a vulnerability or ask about how we protect your data.",
    label: SECURITY_EMAIL,
    href: `mailto:${SECURITY_EMAIL}`,
  },
];

function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const enquiry = useEnquiry();

  // Same message, ready to send from the visitor's own mail app if the form can't be sent.
  const mailto = mailtoLink(CONTACT_EMAIL, `Enquiry from ${name}`, `${message}\n\n— ${name} (${email})`);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    enquiry.submit({ kind: "contact", name, email, message, website: website || undefined });
  }

  function startOver() {
    setMessage("");
    enquiry.reset();
  }

  return (
    <MarketingLayout
      title="Contact"
      description="Contact Fintranzact about plans, pricing, onboarding or support. Send us a message and we usually reply within one business day."
    >
      <PageHero
        eyebrow="Contact"
        title="We're here to help"
        subtitle="Talk to us about plans, onboarding or anything else. We usually reply within one business day."
      />

      <section className="bg-surface-1">
        <div className="mx-auto grid max-w-6xl items-start gap-8 px-4 py-20 md:px-6 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-2">
            {CHANNELS.map((channel) => (
              <div key={channel.title} className="flex gap-4 rounded-2xl border border-border-light bg-surface-0 p-6">
                <IconCircle icon={channel.icon} size="lg" />
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-text-primary">{channel.title}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-text-tertiary">{channel.body}</p>
                  <a
                    href={channel.href}
                    className="mt-3 inline-flex items-center gap-1 break-all text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
                    {...(channel.href.startsWith("http")
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    {channel.label}
                    <Icon icon={ArrowRight01Icon} size={14} strokeWidth={2} />
                  </a>
                </div>
              </div>
            ))}
          </div>

          <div className="relative rounded-[22px] border border-border-light bg-surface-0 p-7 shadow-[0_24px_60px_-34px_rgba(15,27,61,.35)] md:p-9 lg:col-span-3">
            {enquiry.status === "sent" ? (
              <EnquirySent
                title="Thanks, your message is on its way"
                body={`We usually reply within one business day, to ${email}.`}
                againLabel="Send another message"
                onAgain={startOver}
              />
            ) : (
              <form onSubmit={handleSubmit}>
                <h2 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-[#0f1b3d] dark:text-white">
                  Send us a message
                </h2>
                <p className="mt-1.5 text-sm text-text-tertiary">
                  We reply by email. Prefer your own mail app?{" "}
                  <a href={mailto} className="font-semibold text-brand-600 hover:underline dark:text-brand-300">
                    Write to {CONTACT_EMAIL}
                  </a>
                </p>
                <div className="mt-7 grid gap-5 sm:grid-cols-2">
                  <InputField
                    label="Name"
                    required
                    minLength={2}
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    placeholder="Your full name"
                  />
                  <InputField
                    label="Email"
                    type="email"
                    required
                    maxLength={255}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="you@yourcompany.com"
                  />
                </div>
                <div className="mt-5">
                  <TextareaField
                    label="Message"
                    required
                    minLength={10}
                    maxLength={5000}
                    className="min-h-36"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="How can we help?"
                  />
                </div>
                <HoneypotField value={website} onChange={setWebsite} />
                {enquiry.status === "error" && <EnquiryError message={enquiry.error} mailto={mailto} />}
                <button
                  type="submit"
                  disabled={enquiry.busy}
                  className="mt-7 inline-flex h-[52px] items-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-[0_12px_28px_-10px_rgba(59,94,170,.7)] transition hover:bg-brand-700 disabled:cursor-wait disabled:opacity-70"
                >
                  <Icon icon={SentIcon} size={18} />
                  {enquiry.status === "sending" ? "Sending…" : "Send message"}
                </button>
              </form>
            )}
            {enquiry.turnstile}
          </div>
        </div>
      </section>

      <CtaBand
        title="Prefer to try it yourself?"
        body="Create a free account and send your first GST invoice in minutes."
      />
    </MarketingLayout>
  );
}
