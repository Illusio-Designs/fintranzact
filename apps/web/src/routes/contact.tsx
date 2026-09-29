import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import {
  CONTACT_EMAIL,
  DOCS_URL,
  MarketingLayout,
  PageHero,
  SECURITY_EMAIL,
} from "@/components/marketing/MarketingLayout";

export const Route = createFileRoute("/contact")({
  component: ContactPage,
});

const CHANNELS: Array<{ title: string; body: string; label: string; href: string }> = [
  {
    title: "Sales & support",
    body: "Questions about plans, pricing or using Fintranzact.",
    label: CONTACT_EMAIL,
    href: `mailto:${CONTACT_EMAIL}`,
  },
  {
    title: "Help centre",
    body: "Step-by-step guides for invoicing, GST, banking and more.",
    label: "Browse the docs",
    href: DOCS_URL,
  },
  {
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

  // No backend endpoint for enquiries yet: hand the message to the visitor's
  // mail client, pre-filled, so nothing typed here is lost.
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const subject = `Enquiry from ${name}`;
    const body = `${message}\n\n— ${name} (${email})`;
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <MarketingLayout title="Contact">
      <PageHero
        eyebrow="Contact"
        title="We're here to help"
        subtitle="Talk to us about plans, onboarding or anything else. We usually reply within one business day."
      />

      <section className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-5 md:px-6">
        <div className="space-y-4 md:col-span-2">
          {CHANNELS.map((channel) => (
            <div key={channel.title} className="card p-5">
              <h2 className="font-semibold">{channel.title}</h2>
              <p className="mt-1 text-sm text-text-tertiary">{channel.body}</p>
              <a
                href={channel.href}
                className="mt-3 inline-block text-sm font-semibold text-brand-600 hover:underline"
                {...(channel.href.startsWith("http")
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {channel.label}
              </a>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4 p-6 md:col-span-3">
          <h2 className="text-lg font-semibold">Send us a message</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium">Name</span>
              <input
                className="input mt-1 w-full"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium">Email</span>
              <input
                className="input mt-1 w-full"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="font-medium">Message</span>
            <textarea
              className="input mt-1 min-h-32 w-full"
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <button type="submit" className="btn-primary">
            Send message
          </button>
        </form>
      </section>
    </MarketingLayout>
  );
}
