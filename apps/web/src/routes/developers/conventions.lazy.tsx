import { createLazyFileRoute } from "@tanstack/react-router";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";
import { HEADING } from "@/components/marketing/sections";
import { DevelopersLayout, DocContent, DocHeader, PagerLinks } from "@/components/developers/DevelopersLayout";
import { CodeBlock } from "@/components/developers/code";
import { GUIDES } from "@/components/developers/guides";
import { InlineCode, RichText } from "@/components/developers/ui";
import { API_BASE_URL } from "@/content/developers/api-base";
import { cn } from "@/lib/utils";

export const Route = createLazyFileRoute("/developers/conventions")({
  component: ConventionsGuide,
});

const guide = GUIDES.find((g) => g.slug === "conventions")!;

const CONVENTIONS: Array<{ key: string; value: string }> = [
  {
    key: "Money",
    value:
      'All money values are strings such as `"1500.00"`, stored with NUMERIC(15,2) precision. Never send numbers: floating-point rounding would corrupt amounts.',
  },
  {
    key: "Dates",
    value:
      'Date and time fields use ISO 8601, for example `"2024-03-16T00:00:00.000Z"`. The financial year starts on 1 April by default.',
  },
  {
    key: "Pages",
    value: "List endpoints take `page` (starting at 1) and `limit` (1 to 100, default 20). Responses include the `total` count.",
  },
  {
    key: "Transport",
    value:
      "Queries are sent as GET with the input URL-encoded; mutations as POST with a JSON body. The tRPC client handles both for you.",
  },
  {
    key: "SuperJSON",
    value:
      "Inputs and results are serialised with SuperJSON, which keeps types such as Date intact. With plain HTTP, wrap the input as `{\"json\": …}`.",
  },
];

const LIMITS = [
  { origin: "A Fintranzact site (*.fintranzact.com)", auth: "Signed in", limit: "120" },
  { origin: "A Fintranzact site", auth: "Signed out", limit: "60" },
  { origin: "Anywhere else", auth: "Signed in", limit: "60" },
  { origin: "Anywhere else", auth: "Signed out", limit: "10" },
];

function ConventionsGuide() {
  return (
    <DevelopersLayout title={guide.title} description={guide.description} mobileLabel={guide.navLabel}>
      <DocContent>
        <DocHeader eyebrow="Get started" title={guide.title}>
          A few rules hold across every endpoint. Follow them and your integration will behave the same way the
          Fintranzact apps do.
        </DocHeader>

        <section className="mt-12">
          <h2 className={cn(HEADING, "text-2xl")}>Data conventions</h2>
          <dl className="mt-5 divide-y divide-border-light overflow-hidden rounded-xl border border-border-light">
            {CONVENTIONS.map((item) => (
              <div key={item.key} className="grid grid-cols-1 gap-1 px-4 py-4 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4">
                <dt className="font-mono text-ui font-bold text-brand-700 dark:text-brand-200">{item.key}</dt>
                <dd className="text-[15px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
                  <RichText text={item.value} />
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-12">
          <h2 className={cn(HEADING, "text-2xl")}>Calling the API without the tRPC client</h2>
          <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-text-secondary">
            <p>
              Any language that can make HTTP requests works. Put the procedure name after{" "}
              <InlineCode>/api/trpc/</InlineCode>. For a query, send the input as a URL-encoded{" "}
              <InlineCode>input</InlineCode> parameter; for a mutation, POST it as the JSON body.
            </p>
            <CodeBlock
              lang="bash"
              title="cURL"
              code={`# Query: list the first page of invoices
curl -G "${API_BASE_URL}/api/trpc/invoice.list" \\
  -H "Authorization: Bearer $FINTRANZACT_API_KEY" \\
  -H "x-business-id: $FINTRANZACT_BUSINESS_ID" \\
  --data-urlencode 'input={"json":{"page":1,"limit":20}}'

# Mutation: record a payment
curl -X POST "${API_BASE_URL}/api/trpc/payment.create" \\
  -H "Authorization: Bearer $FINTRANZACT_API_KEY" \\
  -H "x-business-id: $FINTRANZACT_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"partyId":"party-uuid","amount":"5000.00","mode":"upi"}}'`}
            />
          </div>
        </section>

        <section className="mt-12">
          <h2 className={cn(HEADING, "text-2xl")}>Rate limits</h2>
          <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-text-secondary">
            <p>
              Limits are counted per IP address, per minute, and depend on where the request comes from and whether it
              is signed in.
            </p>
            <div className="overflow-hidden rounded-xl border border-border-light">
              <table className="w-full table-fixed text-left text-sm">
                <thead className="bg-surface-1 text-xs font-semibold text-text-tertiary">
                  <tr>
                    <th className="px-3 py-2.5 sm:px-4">Where from</th>
                    <th className="w-[26%] px-3 py-2.5 sm:px-4">Sign-in</th>
                    <th className="w-[22%] px-3 py-2.5 text-right sm:px-4">Per minute</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {LIMITS.map((r) => (
                    <tr key={`${r.origin}-${r.auth}`}>
                      <td className="px-3 py-3 text-text-secondary [overflow-wrap:anywhere] sm:px-4">{r.origin}</td>
                      <td className="px-3 py-3 text-text-tertiary sm:px-4">{r.auth}</td>
                      <td className="px-3 py-3 text-right font-mono font-semibold text-text-primary sm:px-4">{r.limit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-400/20 dark:bg-amber-400/[0.06]">
              <Icon icon={Alert02Icon} size={18} className="mt-0.5 text-amber-600 dark:text-amber-300" />
              <p className="min-w-0 text-sm leading-relaxed">
                Going over the limit returns <InlineCode>429 Too Many Requests</InlineCode> with a{" "}
                <InlineCode>Retry-After: 60</InlineCode> header. "A Fintranzact site" means the{" "}
                <InlineCode>Origin</InlineCode> header matches a configured web address or a{" "}
                <InlineCode>*.fintranzact.com</InlineCode> subdomain; server-side calls without an Origin header count
                the same way.
              </p>
            </div>
          </div>
        </section>

        <PagerLinks
          prev={{ label: "Authentication and access", to: "/developers/authentication" }}
          next={{ label: "API questions and answers", to: "/developers/faq" }}
        />
      </DocContent>
    </DevelopersLayout>
  );
}
