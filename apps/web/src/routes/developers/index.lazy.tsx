import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight01Icon, HelpCircleIcon, Key01Icon, SourceCodeIcon } from "@hugeicons/core-free-icons";
import { Icon, IconCircle, type IconSvgElement } from "@/components/ui/Icon";
import { EYEBROW, HEADING } from "@/components/marketing/sections";
import { DevelopersLayout, DocContent, DocHeader } from "@/components/developers/DevelopersLayout";
import { CodeBlock, CopyButton } from "@/components/developers/code";
import { GUIDES } from "@/components/developers/guides";
import { PersonaBanner } from "@/components/developers/PersonaSelector";
import { usePersona } from "@/components/developers/persona";
import { API_BASE_URL } from "@/content/developers/api-base";
import { allEndpointGroups, allSections, totalEndpoints } from "@/content/developers";
import { cn } from "@/lib/utils";

export const Route = createLazyFileRoute("/developers/")({
  component: DevelopersOverview,
});

const QUICK_START_CODE = `import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@fintranzact/api";

const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "${API_BASE_URL}/api/trpc",
      transformer: superjson,
      headers() {
        return {
          authorization: \`Bearer \${process.env.FINTRANZACT_API_KEY}\`,
          "x-business-id": process.env.FINTRANZACT_BUSINESS_ID ?? "",
        };
      },
    }),
  ],
});

// 1. List your businesses
const { data: businesses } = await trpc.business.list.query();
// e.g. [{ id: "biz-uuid", name: "Sharma Traders", gstin: "07AABCS1429B1ZP" }]

// 2. Create an invoice (sale to a customer, 5% GST on Basmati Rice)
const invoice = await trpc.invoice.create.mutate({
  partyId: "gupta-enterprises-party-uuid",
  type: "sale",
  lineItems: [{
    itemName: "Basmati Rice 25kg",
    quantity: "20.000",   // 20 bags
    unitPrice: "1250.00", // ₹1,250 per bag
    taxPercent: "5.00",   // GST 5%, HSN 1006
    itemId: "basmati-rice-item-uuid",
  }],
  notes: "Delivery to warehouse on 28th. NEFT payment preferred.",
});
// invoice.invoiceNumber → "BB-14821"
// invoice.totalAmount   → "26250.00" (₹25,000 + ₹1,250 GST)`;

const GUIDE_ICONS: Record<string, IconSvgElement> = {
  authentication: Key01Icon,
  conventions: SourceCodeIcon,
  faq: HelpCircleIcon,
};

function DevelopersOverview() {
  const { persona, personaInfo } = usePersona();
  const highlighted = new Set<string>(personaInfo?.highlightedGroups ?? []);
  const baseUrl = `${API_BASE_URL}/api/trpc`;

  return (
    <DevelopersLayout
      title="API reference"
      mobileLabel="Overview"
      description={`Build on Fintranzact: ${totalEndpoints}+ tRPC endpoints for GST invoicing, payments, inventory, banking and reports, with JavaScript, cURL and Python examples.`}
    >
      <DocContent wide>
        <DocHeader eyebrow="Developers" title="Fintranzact API reference">
          Everything the web app, mobile app and AI agents can do is available through one tRPC API. Each endpoint
          below comes with its parameters, an example response and code in JavaScript, cURL and Python.
        </DocHeader>

        <div className="mt-6 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 dark:border-brand-400/30 dark:bg-brand-400/10 dark:text-brand-200">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            tRPC + SuperJSON
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {allEndpointGroups.length} groups · {totalEndpoints}+ endpoints
          </span>
        </div>

        {/* ── Base URL + quick start ─────────────────────────── */}
        <div className="mt-12 grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
          <div className="min-w-0">
            <h2 className={cn(HEADING, "text-2xl")}>Base URL</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-text-secondary">
              Queries are sent as GET and mutations as POST to this address. The tRPC client does this for you.
            </p>
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#1f2c4f] bg-[#0b1530] py-1.5 pl-4 pr-1.5">
              <span className="shrink-0 rounded border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-300">
                HTTPS
              </span>
              <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-slate-200">{baseUrl}</code>
              <CopyButton text={baseUrl} />
            </div>

            <h2 className={cn(HEADING, "mt-10 text-2xl")}>Get started in three steps</h2>
            <ol className="mt-5 space-y-5">
              {[
                {
                  title: "Get a key",
                  body: "In Fintranzact, open Settings → Account and create an API key (on plans that include API access), or call apiKey.create. The key is shown once, so keep it safe.",
                },
                {
                  title: "Choose a business",
                  body: "Call business.list and send the business ID in the x-business-id header with every business request.",
                },
                {
                  title: "Make your first call",
                  body: "Use the typed tRPC client (shown here) or plain HTTP from any language. Every endpoint page has cURL and Python too.",
                },
              ].map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 font-display text-sm font-extrabold text-white">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-[16px] font-bold text-text-primary">{step.title}</p>
                    <p className="mt-1 text-[15px] leading-relaxed text-text-secondary">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="min-w-0">
            <CodeBlock code={QUICK_START_CODE} lang="javascript" title="Quick start · JavaScript" />
          </div>
        </div>

        {/* ── Guides ─────────────────────────────────────────── */}
        <div className="mt-16 grid grid-cols-1 gap-4 md:grid-cols-3">
          {GUIDES.map((guide) => (
            <Link
              key={guide.slug}
              to={`/developers/${guide.slug}`}
              className="group flex flex-col rounded-2xl border border-border-light bg-surface-0 p-6 transition duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[0_18px_40px_-18px_rgba(15,27,61,.28)] dark:hover:border-brand-800"
            >
              <IconCircle icon={GUIDE_ICONS[guide.slug]} size="md" />
              <h3 className="mt-4 text-base font-bold text-text-primary">{guide.navLabel}</h3>
              <p className="mt-1.5 flex-1 text-sm leading-relaxed text-text-tertiary">{guide.description}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 dark:text-brand-300">
                Read the guide
                <Icon icon={ArrowRight01Icon} size={15} className="transition group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>

        {/* ── Persona ────────────────────────────────────────── */}
        <div className="mt-16 rounded-3xl border border-border-light bg-surface-1 p-5 md:p-8">
          <PersonaBanner />
        </div>

        {/* ── Endpoint groups ────────────────────────────────── */}
        <div className="mt-16">
          <p className={EYEBROW}>Endpoint groups</p>
          <h2 className={cn(HEADING, "mt-2 text-3xl")}>Browse the API</h2>
          <p className="mt-3 text-[15px] text-text-secondary">
            {allEndpointGroups.length} groups and {totalEndpoints}+ endpoints.
            {persona && " Groups marked with a dot are the most useful for your role."}
          </p>

          {allSections.map((section) => (
            <div key={section.id} className="mt-10">
              <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-text-tertiary">{section.title}</h3>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {section.groups.map((group) => {
                  const isHighlighted = highlighted.has(group.id);
                  return (
                    <Link
                      key={group.id}
                      to="/developers/$section"
                      params={{ section: group.id }}
                      className={cn(
                        "relative flex min-w-0 flex-col rounded-2xl border p-5 transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-18px_rgba(15,27,61,.28)]",
                        isHighlighted
                          ? "border-brand-300 bg-brand-50/70 dark:border-brand-400/40 dark:bg-brand-400/10"
                          : "border-border-light bg-surface-0 hover:border-brand-200 dark:hover:border-brand-800",
                      )}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 text-[15px] font-bold text-text-primary">
                          {group.title}
                          {isHighlighted && <span className="h-2 w-2 rounded-full bg-brand-500" title="Suggested for you" />}
                        </span>
                        <span className="shrink-0 text-xs text-text-tertiary">
                          {group.endpoints.length} endpoint{group.endpoints.length === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="mt-2 line-clamp-3 text-sm leading-relaxed text-text-tertiary [overflow-wrap:anywhere]">{group.description}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </DocContent>
    </DevelopersLayout>
  );
}
