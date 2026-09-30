import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { DevelopersLayout, DeveloperNotFound, DocContent, DocHeader, PagerLinks } from "@/components/developers/DevelopersLayout";
import { EndpointDoc } from "@/components/developers/EndpointDoc";
import { MethodBadge, RichText } from "@/components/developers/ui";
import { allEndpointGroups, groupById, sectionByGroupId } from "@/content/developers";
import type { EndpointGroup } from "@/content/developers/types";

export const Route = createLazyFileRoute("/developers/$section/")({
  component: EndpointGroupRoute,
});

function EndpointGroupRoute() {
  const { section } = Route.useParams();
  const group = groupById.get(section);
  return group ? <EndpointGroupPage group={group} /> : <DeveloperNotFound />;
}

/** Meta description from the group description, trimmed to about 160 characters. */
function metaDescription(group: EndpointGroup) {
  const base = `${group.title} API for Fintranzact: ${group.description.replace(/`/g, "")}`;
  if (base.length <= 160) return base;
  const cut = base.slice(0, 157);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

function EndpointGroupPage({ group }: { group: EndpointGroup }) {
  const section = sectionByGroupId.get(group.id);
  const index = allEndpointGroups.findIndex((g) => g.id === group.id);
  const prev = allEndpointGroups[index - 1];
  const next = allEndpointGroups[index + 1];

  return (
    <DevelopersLayout title={`${group.title} API`} description={metaDescription(group)} mobileLabel={group.title}>
      <DocContent wide>
        <DocHeader eyebrow={section?.title ?? "API reference"} title={group.title}>
          <RichText text={group.description} />
        </DocHeader>

        {/* Endpoints in this group, each linking to its own page */}
        <div className="mt-8 overflow-hidden rounded-2xl border border-border-light">
          <p className="border-b border-border-light bg-surface-1 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-text-tertiary">
            {group.endpoints.length} endpoint{group.endpoints.length === 1 ? "" : "s"}
          </p>
          <ul className="divide-y divide-border-light">
            {group.endpoints.map((ep) => (
              <li key={ep.id}>
                <Link
                  to="/developers/$section/$endpoint"
                  params={{ section: group.id, endpoint: ep.id }}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition hover:bg-brand-50/60 dark:hover:bg-white/5"
                >
                  <MethodBadge method={ep.method} size="sm" />
                  <span className="text-[15px] font-semibold text-text-primary">{ep.title}</span>
                  <code className="min-w-0 font-mono text-xs text-text-tertiary [overflow-wrap:anywhere]">{ep.path}</code>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-14 space-y-14">
          {group.endpoints.map((ep) => (
            <EndpointDoc key={ep.id} endpoint={ep} />
          ))}
        </div>

        <PagerLinks
          prev={
            prev
              ? { label: prev.title, to: "/developers/$section", params: { section: prev.id } }
              : { label: "API questions and answers", to: "/developers/faq" }
          }
          next={next ? { label: next.title, to: "/developers/$section", params: { section: next.id } } : undefined}
        />
      </DocContent>
    </DevelopersLayout>
  );
}
