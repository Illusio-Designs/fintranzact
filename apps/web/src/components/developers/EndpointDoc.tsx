import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Alert02Icon, ArrowDown01Icon, ArrowRight01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import type { EndpointDef } from "@/content/developers/types";
import { endpointById, groupByEndpointId } from "@/content/developers";
import { CodePanel, HighlightedCode } from "./code";
import { ParamTable } from "./ParamTable";
import { AuthBadge, BlockLabel, MethodBadge, RichText } from "./ui";

/**
 * One endpoint: description, parameters, response and gotchas on the left,
 * code samples on the right (stacked underneath on narrower screens).
 * On a group page the title links to the endpoint's own page.
 */
export function EndpointDoc({ endpoint, standalone = false }: { endpoint: EndpointDef; standalone?: boolean }) {
  const group = groupByEndpointId.get(endpoint.id);
  const TitleTag = standalone ? "h1" : "h2";

  return (
    <section
      id={endpoint.id}
      className={cn("scroll-mt-32", !standalone && "border-t border-border-light pt-12 first:border-t-0 first:pt-0")}
    >
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,500px)]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <MethodBadge method={endpoint.method} />
            <code className="rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1 font-mono text-[13px] font-semibold text-brand-700 [overflow-wrap:anywhere] dark:border-brand-400/30 dark:bg-brand-400/10 dark:text-brand-200">
              {endpoint.path}
            </code>
            <AuthBadge auth={endpoint.auth} />
            {endpoint.requiredRole && (
              <span className="rounded-full border border-border-light px-2.5 py-[3px] text-[11px] text-text-tertiary">
                min role: <code className="font-mono font-semibold text-text-secondary">{endpoint.requiredRole}</code>
              </span>
            )}
          </div>

          <TitleTag
            className={cn(
              "mt-4 font-display font-extrabold tracking-[-0.02em] text-[#0f1b3d] dark:text-white",
              standalone ? "text-3xl leading-tight md:text-4xl" : "text-2xl leading-snug",
            )}
          >
            {standalone || !group ? (
              endpoint.title
            ) : (
              <Link
                to="/developers/$section/$endpoint"
                params={{ section: group.id, endpoint: endpoint.id }}
                className="hover:text-brand-600 dark:hover:text-brand-200"
              >
                {endpoint.title}
              </Link>
            )}
          </TitleTag>
          <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">
            <RichText text={endpoint.description} />
          </p>

          <ParamTable params={endpoint.input} />

          <div className="mt-8">
            <BlockLabel>Response</BlockLabel>
            <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">
              <RichText text={endpoint.output.description} />
            </p>
            {endpoint.output.example != null && <ResponsePreview example={endpoint.output.example} />}
          </div>

          {endpoint.gotchas && endpoint.gotchas.length > 0 && (
            <div className="mt-8">
              <BlockLabel>Watch out for</BlockLabel>
              <ul className="mt-3 space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-400/20 dark:bg-amber-400/[0.06]">
                {endpoint.gotchas.map((gotcha, i) => (
                  <li key={i} className="flex gap-2.5">
                    <Icon icon={Alert02Icon} size={17} className="mt-0.5 text-amber-600 dark:text-amber-300" />
                    <p className="min-w-0 text-sm leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
                      <RichText text={gotcha} />
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {endpoint.relatedEndpoints && endpoint.relatedEndpoints.length > 0 && (
            <RelatedEndpoints ids={endpoint.relatedEndpoints} />
          )}
        </div>

        <div className="min-w-0 xl:sticky xl:top-[96px] xl:self-start">
          <CodePanel examples={endpoint.codeExamples} outputExample={endpoint.output.example} />
        </div>
      </div>
    </section>
  );
}

/** Collapsible example response, shown inline for readers without the code panel in view. */
function ResponsePreview({ example }: { example: unknown }) {
  const [open, setOpen] = useState(false);
  const json = JSON.stringify(example, null, 2);
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-border-light xl:hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 bg-surface-1 px-4 py-2.5 text-left text-sm font-semibold text-text-secondary transition hover:bg-surface-2"
      >
        <span className="flex items-center gap-2">
          <Icon icon={CheckmarkCircle02Icon} size={16} className="text-emerald-600 dark:text-emerald-400" />
          Example response
        </span>
        <Icon icon={ArrowDown01Icon} size={16} className={cn("text-text-tertiary transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="max-h-[360px] overflow-auto bg-[#0b1530] p-4">
          <HighlightedCode code={json} lang="json" />
        </div>
      )}
    </div>
  );
}

function RelatedEndpoints({ ids }: { ids: string[] }) {
  const related = ids.flatMap((id) => {
    const ep = endpointById.get(id);
    const group = groupByEndpointId.get(id);
    return ep && group ? [{ ep, group }] : [];
  });
  if (related.length === 0) return null;

  return (
    <div className="mt-8">
      <BlockLabel>Related endpoints</BlockLabel>
      <ul className="mt-3 space-y-1.5">
        {related.map(({ ep, group }) => (
          <li key={ep.id}>
            <Link
              to="/developers/$section/$endpoint"
              params={{ section: group.id, endpoint: ep.id }}
              className="group inline-flex max-w-full items-start gap-2 text-sm text-text-secondary hover:text-brand-600 dark:hover:text-brand-200"
            >
              <Icon icon={ArrowRight01Icon} size={16} className="mt-0.5 text-brand-500 transition group-hover:translate-x-0.5" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <code className="font-mono text-[13px]">{ep.path}</code>
                <span className="text-text-tertiary"> · {ep.title}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
