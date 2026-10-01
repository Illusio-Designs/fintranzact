import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { DevelopersLayout, DocContent, DocHeader, PagerLinks } from "@/components/developers/DevelopersLayout";
import { DeveloperFaq } from "@/components/developers/faq";
import { GUIDES } from "@/components/developers/guides";
import { allEndpointGroups } from "@/content/developers";

export const Route = createLazyFileRoute("/developers/faq")({
  component: DeveloperFaqPage,
});

const guide = GUIDES.find((g) => g.slug === "faq")!;
const firstGroup = allEndpointGroups[0];

function DeveloperFaqPage() {
  return (
    <DevelopersLayout title={guide.title} description={guide.description} mobileLabel={guide.navLabel}>
      <DocContent>
        <DocHeader eyebrow="Get started" title={guide.title}>
          Common questions about building on Fintranzact. Filter by role, or{" "}
          <Link to="/contact" className="font-semibold text-brand-600 hover:underline dark:text-brand-300">
            ask us
          </Link>{" "}
          if yours is not here.
        </DocHeader>
        <div className="mt-10">
          <DeveloperFaq />
        </div>
        <PagerLinks
          prev={{ label: "Conventions and rate limits", to: "/developers/conventions" }}
          next={{ label: firstGroup.title, to: "/developers/$section", params: { section: firstGroup.id } }}
        />
      </DocContent>
    </DevelopersLayout>
  );
}
