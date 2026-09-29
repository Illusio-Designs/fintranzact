import { Link } from "@tanstack/react-router";
import { CtaBand, MarketingLayout } from "@/components/marketing/MarketingLayout";

/**
 * Public landing page shown at "/" to visitors who are not signed in.
 * Sign-in / sign-up happen on /login; this page only links there.
 */

const FEATURES: Array<{ title: string; body: string; icon: string }> = [
  {
    icon: "🧾",
    title: "GST invoicing",
    body: "Create GST-compliant sale and purchase invoices, quotations, credit notes and delivery challans in seconds.",
  },
  {
    icon: "⚡",
    title: "e-Invoice & e-Way Bill",
    body: "Generate IRN, QR codes and e-way bills straight from your invoices — no copy-pasting into government portals.",
  },
  {
    icon: "📊",
    title: "GST returns & reports",
    body: "GSTR-1, GSTR-3B, GSTR-2B reconciliation, ITC tracking, P&L, balance sheet and day book, always up to date.",
  },
  {
    icon: "💳",
    title: "Payments & banking",
    body: "Record receipts and payments, track outstanding balances and reconcile bank statements against your books.",
  },
  {
    icon: "📦",
    title: "Inventory & POS",
    body: "Manage items, variants, stock and warehouses, and bill walk-in customers from a fast point-of-sale screen.",
  },
  {
    icon: "🏢",
    title: "Multiple businesses & teams",
    body: "Run several businesses under one organization and invite your team with role-based access.",
  },
];

export function LandingPage() {
  return (
    <MarketingLayout>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden text-white"
        style={{
          background:
            "linear-gradient(135deg, #182850 0%, #243c77 35%, #3b5eaa 75%, #2a437f 100%)",
        }}
      >
        <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-300">
            Billing & accounting for Indian businesses
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight md:text-5xl">
            GST billing, inventory and accounts — all in one place.
          </h1>
          <p className="mt-5 max-w-2xl text-base text-white/80 md:text-lg">
            Create invoices, file-ready GST reports, track payments and
            stock, and keep your books clean without spreadsheets.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/login"
              search={{ mode: "register" }}
              className="rounded-lg bg-white px-5 py-3 text-sm font-semibold text-brand-700 shadow-sm transition hover:bg-brand-50"
            >
              Create free account
            </Link>
            <Link
              to="/login"
              search={{ mode: "login" }}
              className="rounded-lg border border-white/40 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Log in
            </Link>
            <Link
              to="/pricing"
              className="rounded-lg px-5 py-3 text-sm font-semibold text-white/90 transition hover:text-white"
            >
              View pricing →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
        <h2 className="text-2xl font-semibold md:text-3xl">
          Everything your business needs
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-text-tertiary md:text-base">
          Built for GST-registered and unregistered businesses, from a
          single shop to multi-branch operations.
        </p>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="card p-6">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-xl"
                aria-hidden
              >
                {feature.icon}
              </div>
              <h3 className="mt-4 text-base font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-text-tertiary">{feature.body}</p>
            </div>
          ))}
        </div>

        <Link
          to="/features"
          className="mt-8 inline-flex text-sm font-semibold text-brand-600 hover:underline"
        >
          See all features →
        </Link>
      </section>

      <CtaBand />
    </MarketingLayout>
  );
}
