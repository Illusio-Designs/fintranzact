import { createFileRoute, Link } from "@tanstack/react-router";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { Icon, IconCircle } from "@/components/ui/Icon";
import { HelpLayout, HelpSearch } from "@/components/help/HelpLayout";
import { HELP_MDX_COMPONENTS } from "@/components/help/mdx";
import { loadHelpArticle, type HelpArticle } from "@/lib/help-content";

/** Every help article: /help/<folder> and /help/<folder>/<page>. */
export const Route = createFileRoute("/help/$")({
  loader: ({ params }) => loadHelpArticle(params._splat ?? ""),
  component: HelpArticleRoute,
});

function HelpArticleRoute() {
  const article = Route.useLoaderData();
  return article ? <HelpArticlePage article={article} /> : <HelpNotFound />;
}

function HelpArticlePage({ article }: { article: HelpArticle }) {
  const { Content, frontmatter } = article;
  return (
    <HelpLayout slug={article.slug} title={frontmatter.title} description={frontmatter.description}>
      <Content components={HELP_MDX_COMPONENTS} />
    </HelpLayout>
  );
}

function HelpNotFound() {
  return (
    <HelpLayout slug="" title="Article not found" description="There is no help article at this address." wide>
      <section className="mx-auto flex max-w-2xl flex-col items-center px-4 py-20 text-center md:px-6 md:py-28">
        <IconCircle icon={Search01Icon} size="lg" />
        <h1 className="mt-6 font-display text-3xl font-extrabold tracking-[-0.025em] text-[#0f1b3d] md:text-4xl dark:text-white">
          We could not find that article
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-text-secondary">
          It may have moved. Search the help centre or start from the home page.
        </p>
        <HelpSearch className="mt-8 w-full text-left" large />
        <Link
          to="/help"
          className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
        >
          <Icon icon={Search01Icon} size={16} />
          Browse all help articles
        </Link>
      </section>
    </HelpLayout>
  );
}
