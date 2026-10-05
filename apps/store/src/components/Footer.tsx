import type { StoreConfig } from "../types";
import { PolicyLinks } from "./PolicyLinks";

interface FooterProps {
  config: StoreConfig;
  slug: string;
}

export function Footer({ config, slug }: FooterProps) {
  const { business } = config;

  return (
    <footer
      className="border-t mt-8"
      style={{
        borderColor: "var(--store-border-light)",
        background: "var(--store-bg)",
      }}
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Business contact info */}
        {(business.phone || business.email || business.address) && (
          <div className="mb-5 pb-5 border-b" style={{ borderColor: "var(--store-border-light)" }}>
            <p
              className="text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: "var(--store-muted)" }}
            >
              Contact
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {business.phone && (
                <a
                  href={`tel:${business.phone}`}
                  className="text-sm flex items-center gap-1.5"
                  style={{ color: "var(--store-text-secondary)" }}
                >
                  <PhoneIcon />
                  {business.phone}
                </a>
              )}
              {business.email && (
                <a
                  href={`mailto:${business.email}`}
                  className="text-sm flex items-center gap-1.5"
                  style={{ color: "var(--store-text-secondary)" }}
                >
                  <MailIcon />
                  {business.email}
                </a>
              )}
              {business.address && (
                <span
                  className="text-sm flex items-center gap-1.5"
                  style={{ color: "var(--store-text-secondary)" }}
                >
                  <MapPinIcon />
                  {business.address}
                  {business.city ? `, ${business.city}` : ""}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Policy pages: each has its own URL, /<slug>/policies/<page> */}
        <PolicyLinks slug={slug} className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4" />

        {/* Ownership + Powered by */}
        <div className="space-y-1.5">
          <p className="text-xs" style={{ color: "var(--store-muted)" }}>
            All content and products on this page are owned by{" "}
            <span className="font-medium" style={{ color: "var(--store-text-secondary)" }}>
              {business.name}
            </span>
          </p>
          <p className="text-xs" style={{ color: "var(--store-muted)" }}>
            Powered by{" "}
            <a
              href="https://fintranzact-web.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold hover:underline"
              style={{ color: "var(--store-text-secondary)" }}
            >
              Fintranzact
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}

function PhoneIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="14"
      height="14"
      className="flex-shrink-0"
    >
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="14"
      height="14"
      className="flex-shrink-0"
    >
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="14"
      height="14"
      className="flex-shrink-0"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
