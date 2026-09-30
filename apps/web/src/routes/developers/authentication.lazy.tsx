import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";
import { HEADING } from "@/components/marketing/sections";
import { DevelopersLayout, DocContent, DocHeader, PagerLinks } from "@/components/developers/DevelopersLayout";
import { CodeBlock } from "@/components/developers/code";
import { GUIDES } from "@/components/developers/guides";
import { InlineCode } from "@/components/developers/ui";
import { API_BASE_URL } from "@/content/developers/api-base";
import { cn } from "@/lib/utils";

export const Route = createLazyFileRoute("/developers/authentication")({
  component: AuthenticationGuide,
});

const guide = GUIDES.find((g) => g.slug === "authentication")!;

const ROLES: Array<{ role: string; desc: string }> = [
  { role: "superadmin", desc: "Full access. Manages organisation members, businesses and all data." },
  { role: "owner", desc: "Full access within the organisation, including businesses and members." },
  { role: "admin", desc: "Full access to all business data. Cannot manage organisation-level members." },
  {
    role: "seller_manager",
    desc: "Creates and edits invoices, parties, items and payments. Can delete unpaid invoices within two hours of creating them. Manages store orders.",
  },
  {
    role: "seller",
    desc: "Creates invoices and payments. Read-only on items. Cannot delete. Can edit their own invoices for two hours.",
  },
  {
    role: "accountant",
    desc: "Payments, expenses, bank accounts, reports and GST. Read-only on invoices, parties and items.",
  },
];

function AuthenticationGuide() {
  return (
    <DevelopersLayout title={guide.title} description={guide.description} mobileLabel={guide.navLabel}>
      <DocContent>
        <DocHeader eyebrow="Get started" title={guide.title}>
          Every request identifies who is calling and, for business data, which business it is for. Pick the sign-in
          method that suits your client, then add the business header.
        </DocHeader>

        <Section title="Session cookie: web clients">
          <p>
            After <InlineCode>auth.login</InlineCode> or <InlineCode>auth.register</InlineCode>, the API sets an HttpOnly{" "}
            <InlineCode>session_id</InlineCode> cookie (30-day expiry, SameSite=Lax). Browsers send it automatically, so
            a web app on a Fintranzact domain needs nothing more.
          </p>
          <CodeBlock code="Cookie: session_id=sess_VbK2mQ9xP4nR7wA1..." lang="bash" title="Request header" />
        </Section>

        <Section title="Bearer token: mobile, server and agent clients">
          <p>
            Send the <InlineCode>sessionToken</InlineCode> returned by <InlineCode>auth.login</InlineCode>, or an API key
            from <InlineCode>apiKey.create</InlineCode>, in the <InlineCode>Authorization</InlineCode> header. Sessions
            live on the server, so logging out or revoking a key takes effect at once.
          </p>
          <CodeBlock code="Authorization: Bearer sess_VbK2mQ9xP4nR7wA1..." lang="bash" title="Request header" />
        </Section>

        <Section title="API keys">
          <p>
            For scripts, integrations and AI agents, use an API key rather than a password. Create one in Fintranzact
            under Settings → Account (on plans that include API access) or with <InlineCode>apiKey.create</InlineCode>.
            The full key is shown only once. Give each key a clear name, set an expiry for production keys, and revoke
            any key you no longer need with <InlineCode>apiKey.revoke</InlineCode>.
          </p>
          <GroupLink section="api-keys" label="API key endpoints" />
        </Section>

        <Section title="The x-business-id header">
          <p>
            One organisation can hold many businesses, such as a CA firm with a business for each client. Endpoints
            that read or change business data need the active business's UUID in the{" "}
            <InlineCode>x-business-id</InlineCode> header. Call <InlineCode>business.list</InlineCode> to get the IDs
            you can use.
          </p>
          <CodeBlock
            lang="bash"
            title="cURL"
            code={`curl "${API_BASE_URL}/api/trpc/invoice.list" \\
  -H "Authorization: Bearer $FINTRANZACT_API_KEY" \\
  -H "x-business-id: $FINTRANZACT_BUSINESS_ID"`}
          />
          <GroupLink section="businesses" label="Business endpoints" />
        </Section>

        <Section title="Which endpoints need what">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-text-primary">Public</strong>: no sign-in, for example sign-up, plans and the
              contact form.
            </li>
            <li>
              <strong className="text-text-primary">Sign-in required</strong>: a session or API key, for example your
              profile and organisation.
            </li>
            <li>
              <strong className="text-text-primary">Business required</strong>: a session or API key plus{" "}
              <InlineCode>x-business-id</InlineCode>, for example invoices, stock and reports.
            </li>
          </ul>
          <p>Each endpoint page shows which of these it needs, and the minimum role where one applies.</p>
        </Section>

        <Section title="Roles and permissions">
          <p>
            Permissions are checked on every call, using the caller's role in the organisation. Roles are given with{" "}
            <InlineCode>tenant.inviteMember</InlineCode>.
          </p>
          <div className="overflow-hidden rounded-xl border border-border-light">
            <dl className="divide-y divide-border-light">
              {ROLES.map(({ role, desc }) => (
                <div key={role} className="grid grid-cols-1 gap-1 px-4 py-3.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4">
                  <dt>
                    <code className="font-mono text-[13px] font-semibold text-brand-700 dark:text-brand-200">{role}</code>
                  </dt>
                  <dd className="text-sm leading-relaxed text-text-secondary">{desc}</dd>
                </div>
              ))}
            </dl>
          </div>
          <GroupLink section="tenant" label="Organisation and member endpoints" />
        </Section>

        <Section title="Sign-in endpoints">
          <p>
            Password sign-in, magic links, profile completion, session lists and short-lived access tokens are all
            documented in the Authentication group.
          </p>
          <GroupLink section="auth" label="Authentication endpoints" />
        </Section>

        <PagerLinks
          prev={{ label: "Overview", to: "/developers" }}
          next={{ label: "Conventions and rate limits", to: "/developers/conventions" }}
        />
      </DocContent>
    </DevelopersLayout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className={cn(HEADING, "text-2xl")}>{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-text-secondary">{children}</div>
    </section>
  );
}

function GroupLink({ section, label }: { section: string; label: string }) {
  return (
    <Link
      to="/developers/$section"
      params={{ section }}
      className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
    >
      {label}
      <Icon icon={ArrowRight01Icon} size={15} />
    </Link>
  );
}
