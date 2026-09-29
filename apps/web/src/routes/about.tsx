import { createFileRoute } from "@tanstack/react-router";
import {
  CtaBand,
  MarketingLayout,
  PageHero,
} from "@/components/marketing/MarketingLayout";

export const Route = createFileRoute("/about")({
  component: AboutPage,
});

const VALUES: Array<{ title: string; body: string }> = [
  {
    title: "Accuracy first",
    body: "Tax and money must add up to the last paisa. Every calculation is tested against how GST actually works.",
  },
  {
    title: "Built for India",
    body: "GSTINs, HSN codes, e-invoicing, e-way bills and Indian number formats are core features, not add-ons.",
  },
  {
    title: "Your data is yours",
    body: "Export everything whenever you want. We never sell your data or lock you in.",
  },
  {
    title: "Fast and simple",
    body: "Create an invoice in seconds, on any device, without accounting training.",
  },
];

function AboutPage() {
  return (
    <MarketingLayout title="About us">
      <PageHero
        eyebrow="About us"
        title="Your trustable accounting partner"
        subtitle="Fintranzact helps Indian businesses bill customers, stay GST-compliant and understand their numbers, without spreadsheets or expensive software."
      />

      <section className="mx-auto max-w-3xl px-4 py-16 text-base leading-relaxed text-text-secondary md:px-6">
        <h2 className="text-2xl font-semibold text-text-primary">Our story</h2>
        <p className="mt-4">
          Running a small business in India means juggling invoices, GST
          returns, payments and stock, often across notebooks, spreadsheets
          and several disconnected apps. We built Fintranzact to bring all of
          that into one place that's quick to learn and reliable enough to
          trust with your books.
        </p>
        <p className="mt-4">
          Today Fintranzact covers the full cycle: quotations and invoices,
          e-invoicing and e-way bills, payments and bank reconciliation,
          inventory, reports and an online store. It runs on the web, the
          desktop and your phone.
        </p>
      </section>

      <section className="border-t border-border-light bg-surface-1">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-6">
          <h2 className="text-2xl font-semibold">What we believe</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {VALUES.map((value) => (
              <div key={value.title} className="card p-6">
                <h3 className="font-semibold">{value.title}</h3>
                <p className="mt-2 text-sm text-text-tertiary">{value.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </MarketingLayout>
  );
}
