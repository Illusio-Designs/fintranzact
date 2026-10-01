import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";
import { DevelopersLayout, DeveloperNotFound, DocContent, PagerLinks } from "@/components/developers/DevelopersLayout";
import { EndpointDoc } from "@/components/developers/EndpointDoc";
import { groupById } from "@/content/developers";
import type { EndpointDef, EndpointGroup } from "@/content/developers/types";

export const Route = createLazyFileRoute("/developers/$section/$endpoint")({
  component: EndpointRoute,
});

function EndpointRoute() {
  const { section, endpoint } = Route.useParams();
  const group = groupById.get(section);
  const ep = group?.endpoints.find((e) => e.id === endpoint);
  return group && ep ? <EndpointPage group={group} endpoint={ep} /> : <DeveloperNotFound what="endpoint" />;
}

function metaDescription(endpoint: EndpointDef) {
  const base = `${endpoint.path}: ${endpoint.description.replace(/`/g, "")}`;
  if (base.length <= 160) return base;
  const cut = base.slice(0, 157);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

function EndpointPage({ group, endpoint }: { group: EndpointGroup; endpoint: EndpointDef }) {
  const index = group.endpoints.findIndex((e) => e.id === endpoint.id);
  const prev = group.endpoints[index - 1];
  const next = group.endpoints[index + 1];

  return (
    <DevelopersLayout
      title={`${endpoint.title} · ${group.title} API`}
      description={metaDescription(endpoint)}
      mobileLabel={endpoint.title}
    >
      <DocContent wide>
        <Link
          to="/developers/$section"
          params={{ section: group.id }}
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
        >
          <Icon icon={ArrowLeft01Icon} size={15} />
          {group.title}
        </Link>
        <EndpointDoc endpoint={endpoint} standalone />
        <PagerLinks
          prev={
            prev
              ? { label: prev.title, to: "/developers/$section/$endpoint", params: { section: group.id, endpoint: prev.id } }
              : { label: group.title, to: "/developers/$section", params: { section: group.id } }
          }
          next={
            next
              ? { label: next.title, to: "/developers/$section/$endpoint", params: { section: group.id, endpoint: next.id } }
              : undefined
          }
        />
      </DocContent>
    </DevelopersLayout>
  );
}
