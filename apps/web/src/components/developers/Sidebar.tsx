import { useMemo, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ArrowRight01Icon, Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import { allEndpointGroups, allSections } from "@/content/developers";
import { DEVELOPERS_PATH } from "@/lib/developer-paths";
import { GUIDES } from "./guides";
import { usePersona } from "./persona";
import { PersonaPill } from "./PersonaSelector";
import { MethodBadge } from "./ui";

/** Where the reader is: /developers/<page>/<endpoint>. */
export function useDeveloperLocation() {
  const { pathname } = useLocation();
  const [, , page = null, endpoint = null] = pathname.replace(/\/+$/, "").split("/");
  return { page, endpoint };
}

const ROW =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-white/5 dark:hover:text-white";
const ROW_ACTIVE = "bg-brand-50 font-semibold text-brand-700 dark:bg-white/10 dark:text-white";

/**
 * Docs navigation: guides, then every endpoint group by section. The open
 * group lists its endpoints, each a page of its own. A search box filters
 * endpoints by name or path.
 */
export function DeveloperSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { page, endpoint } = useDeveloperLocation();
  const { personaInfo } = usePersona();
  const highlighted = new Set<string>(personaInfo?.highlightedGroups ?? []);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return allEndpointGroups
      .map((group) => ({
        group,
        endpoints: group.endpoints.filter(
          (ep) =>
            ep.title.toLowerCase().includes(q) ||
            ep.path.toLowerCase().includes(q) ||
            group.title.toLowerCase().includes(q),
        ),
      }))
      .filter((r) => r.endpoints.length > 0);
  }, [query]);

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const resultCount = results?.reduce((n, r) => n + r.endpoints.length, 0) ?? 0;

  return (
    <nav aria-label="API reference" className="flex h-full flex-col">
      <div className="shrink-0 px-4 pb-3 pt-5">
        <label className="relative block">
          <span className="sr-only">Search endpoints</span>
          <Icon
            icon={Search01Icon}
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search endpoints…"
            className="h-10 w-full rounded-lg border border-border-light bg-surface-0 pl-9 pr-9 text-sm text-text-primary outline-none transition placeholder:text-text-tertiary focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900/60 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-text-tertiary hover:text-text-primary"
            >
              <Icon icon={Cancel01Icon} size={14} />
            </button>
          )}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {results ? (
          <div>
            <p className="px-2.5 pb-2 pt-1 text-xs font-semibold text-text-tertiary" aria-live="polite">
              {resultCount} result{resultCount === 1 ? "" : "s"}
            </p>
            {results.length === 0 && <p className="px-2.5 py-6 text-center text-sm text-text-tertiary">No endpoints found</p>}
            {results.map(({ group, endpoints }) => (
              <div key={group.id} className="mb-3">
                <p className="px-2.5 py-1 text-xs font-bold uppercase tracking-[0.1em] text-text-tertiary">{group.title}</p>
                {endpoints.map((ep) => (
                  <EndpointLink
                    key={ep.id}
                    groupId={group.id}
                    id={ep.id}
                    title={ep.title}
                    method={ep.method}
                    active={endpoint === ep.id}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <>
            <p className="px-2.5 pb-1 pt-1 text-xs font-bold uppercase tracking-[0.1em] text-text-tertiary">Get started</p>
            <Link
              to={DEVELOPERS_PATH}
              onClick={onNavigate}
              className={cn(ROW, page === null ? ROW_ACTIVE : "text-text-secondary")}
            >
              Overview
            </Link>
            {GUIDES.map((g) => (
              <Link
                key={g.slug}
                to={`${DEVELOPERS_PATH}/${g.slug}`}
                onClick={onNavigate}
                className={cn(ROW, page === g.slug ? ROW_ACTIVE : "text-text-secondary")}
              >
                {g.navLabel}
              </Link>
            ))}

            {allSections.map((section) => {
              const isCollapsed = collapsed.has(section.id);
              return (
                <div key={section.id} className="mt-5">
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => setCollapsed((s) => toggle(s, section.id))}
                    className="flex w-full items-center justify-between rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-[0.1em] text-text-tertiary hover:text-text-primary"
                  >
                    {section.title}
                    <Icon icon={ArrowRight01Icon} size={14} className={cn("transition", !isCollapsed && "rotate-90")} />
                  </button>
                  {!isCollapsed && (
                    <ul className="mt-1">
                      {section.groups.map((group) => {
                        const isActive = page === group.id;
                        const isOpen = isActive ? !expanded.has(`closed:${group.id}`) : expanded.has(group.id);
                        return (
                          <li key={group.id}>
                            <div className="flex items-center">
                              <Link
                                to="/developers/$section"
                                params={{ section: group.id }}
                                onClick={onNavigate}
                                className={cn(
                                  ROW,
                                  "min-w-0 flex-1",
                                  isActive && !endpoint ? ROW_ACTIVE : isActive ? "font-semibold text-text-primary" : "text-text-secondary",
                                )}
                              >
                                <span className="truncate">{group.title}</span>
                                {highlighted.has(group.id) && (
                                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" title="Suggested for you" />
                                )}
                              </Link>
                              <button
                                type="button"
                                aria-expanded={isOpen}
                                aria-label={`${isOpen ? "Hide" : "Show"} ${group.title} endpoints`}
                                onClick={() =>
                                  setExpanded((s) => toggle(s, isActive ? `closed:${group.id}` : group.id))
                                }
                                className="flex h-8 w-9 shrink-0 items-center justify-center gap-1 rounded-md text-2xs text-text-tertiary hover:bg-surface-2 hover:text-text-primary"
                              >
                                {group.endpoints.length}
                                <Icon icon={ArrowRight01Icon} size={12} className={cn("transition", isOpen && "rotate-90")} />
                              </button>
                            </div>
                            {isOpen && (
                              <div className="mb-1 ml-3 border-l border-border-light pl-2">
                                {group.endpoints.map((ep) => (
                                  <EndpointLink
                                    key={ep.id}
                                    groupId={group.id}
                                    id={ep.id}
                                    title={ep.title}
                                    method={ep.method}
                                    active={endpoint === ep.id}
                                    onNavigate={onNavigate}
                                  />
                                ))}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-border-light px-4 py-3">
        <PersonaPill />
      </div>
    </nav>
  );
}

function EndpointLink({
  groupId,
  id,
  title,
  method,
  active,
  onNavigate,
}: {
  groupId: string;
  id: string;
  title: string;
  method: "query" | "mutation";
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to="/developers/$section/$endpoint"
      params={{ section: groupId, endpoint: id }}
      onClick={onNavigate}
      className={cn(ROW, "py-1 text-ui", active ? ROW_ACTIVE : "text-text-tertiary")}
    >
      <MethodBadge method={method} size="sm" />
      <span className="truncate">{title}</span>
    </Link>
  );
}
