import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Add01Icon, MoreHorizontalIcon, StarIcon } from "@hugeicons/core-free-icons";
import {
  clientCountText,
  flattenClientSections,
  groupClientSections,
  leaveClientWarning,
  mergeClientPages,
  type ClientListItem,
} from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/hooks/useToast";

const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 200;

type Scope = "all" | "mine" | "clients";

export interface ClientSwitcherProps {
  /** The organisation open now (marked "Current"). */
  currentTenantId?: string | null;
  onSelect: (tenantId: string) => void;
  onCreateNew?: () => void;
  /** Present when the switcher can be dismissed (the boot-time picker cannot). */
  onClose?: () => void;
  /** After leaving a client: the parent refreshes the session (the selection may have been cleared). */
  onLeft?: (tenantId: string) => void;
}

/**
 * The organisation switcher for people with many organisations (an
 * accountant's clients): search, Pinned / Recent / My firm / Clients sections,
 * keyboard navigation, pin stars, role badges and "Leave this client".
 */
export function ClientSwitcher({ currentTenantId, onSelect, onCreateNew, onClose, onLeft }: ClientSwitcherProps) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState<ClientListItem[]>([]);
  const [active, setActive] = useState(0);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<ClientListItem | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  // A new search or scope starts again from the first page.
  useEffect(() => {
    setCursor(undefined);
    setActive(0);
  }, [debounced, scope]);

  const query = trpc.tenant.listClients.useQuery({
    search: debounced || undefined,
    scope,
    cursor,
    limit: PAGE_SIZE,
  });
  const data = query.data;

  useEffect(() => {
    if (!data) return;
    const items = data.items as ClientListItem[];
    setLoaded((prev) => (cursor ? mergeClientPages(prev, items) : items));
  }, [data, cursor]);

  const counts = data?.counts;
  const sections = useMemo(() => groupClientSections(loaded, { showRecent: !debounced }), [loaded, debounced]);
  const flat = useMemo(() => flattenClientSections(sections), [sections]);
  const safeActive = Math.min(active, Math.max(flat.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [safeActive, flat.length]);

  const refresh = () => {
    setCursor(undefined);
    void utils.tenant.listClients.invalidate();
  };

  const setPinned = trpc.tenant.setPinned.useMutation({
    onSuccess: refresh,
    onError: (err) => toast.error("Could not change the pin", err.message),
  });

  const leave = trpc.tenant.leave.useMutation({
    onSuccess: (_r, vars) => {
      const name = leaving?.name ?? "the organisation";
      setLeaving(null);
      setMenuFor(null);
      toast.success(`You left ${name}`);
      refresh();
      void utils.tenant.list.invalidate();
      onLeft?.(vars.tenantId);
    },
    onError: (err) => toast.error("Could not leave", err.message),
  });

  function onKeyDown(e: KeyboardEvent) {
    if (leaving) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const item = flat[safeActive];
      if (item) {
        e.preventDefault();
        onSelect(item.tenantId);
      }
    } else if (e.key === "Escape") {
      if (menuFor) setMenuFor(null);
      else onClose?.();
    }
  }

  const firstLoad = !data && query.isLoading && loaded.length === 0;
  const noOrgs = !!counts && counts.all === 0;
  const noMatches = !!data && flat.length === 0 && !noOrgs;
  const showScopes = !!counts && counts.mine > 0 && counts.clients > 0;
  const stale = query.isFetching && !firstLoad;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-border-light bg-surface-0 p-5 shadow-modal animate-scale-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-switcher-title"
        data-testid="client-switcher"
      >
        <h2 id="client-switcher-title" className="mb-1 text-base font-semibold text-text-primary">
          Select Organization
        </h2>
        <p className="mb-3 text-xs text-text-tertiary">
          Choose which organization to work in
          {counts && counts.clients > 0 ? ` · ${clientCountText(counts.clients)}` : ""}
        </p>

        <input
          type="text"
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search organizations"
          aria-label="Search organizations"
          className="input mb-2"
          data-testid="client-switcher-search"
        />

        {showScopes && (
          <div className="mb-2 flex gap-1" role="group" aria-label="Show">
            {([["all", "All"], ["mine", "My firm"], ["clients", "Clients"]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  scope === value ? "bg-brand-600 text-white" : "bg-surface-2 text-text-secondary hover:text-text-primary",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div
          ref={listRef}
          role="listbox"
          aria-label="Organizations"
          aria-busy={stale}
          className={cn("min-h-[3rem] flex-1 overflow-y-auto pr-1", stale && "opacity-70")}
        >
          {firstLoad && <p className="px-2 py-6 text-center text-sm text-text-tertiary">Loading…</p>}
          {query.isError && !data && (
            <p className="px-2 py-6 text-center text-sm text-red-600">Could not load your organizations.</p>
          )}
          {noOrgs && <p className="px-2 py-6 text-center text-sm text-text-tertiary">You are not a member of any organization yet.</p>}
          {noMatches && (
            <p className="px-2 py-6 text-center text-sm text-text-tertiary">
              {debounced ? `No organizations match “${debounced}”.` : "Nothing to show here."}
            </p>
          )}

          {sections.map((section) => (
            <div key={section.key} role="group" aria-label={section.title} className="mb-2">
              <p className="px-2 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-text-tertiary">{section.title}</p>
              {section.items.map((t) => {
                const index = flat.indexOf(t);
                const isActive = index === safeActive;
                const isCurrent = t.tenantId === currentTenantId;
                return (
                  <div
                    key={`${section.key}:${t.tenantId}`}
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    data-testid="client-row"
                    className={cn(
                      "group relative flex items-center gap-1 rounded-lg border px-2 py-1.5",
                      isActive ? "border-brand-400 bg-brand-600/5" : "border-transparent hover:border-border-light",
                    )}
                    onMouseEnter={() => setActive(index)}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(t.tenantId)}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1 text-left"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-sm font-semibold text-brand-700">
                        {t.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-text-primary">{t.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span className={cn(
                            "rounded px-1.5 py-0.5 text-2xs font-medium",
                            t.isOwnFirm ? "bg-brand-50 text-brand-700" : t.role === "admin" ? "bg-emerald-50 text-emerald-700" : "bg-surface-2 text-text-secondary",
                          )}>
                            {t.roleLabel}
                          </span>
                          {t.isCa && (
                            <span className="rounded bg-violet-50 px-1.5 py-0.5 text-2xs font-semibold text-violet-700" title="Accountant access">CA</span>
                          )}
                          {isCurrent && <span className="text-2xs font-medium text-emerald-700">Current</span>}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={t.pinned ? `Unpin ${t.name}` : `Pin ${t.name}`}
                      aria-pressed={t.pinned}
                      disabled={setPinned.isPending}
                      onClick={() => setPinned.mutate({ tenantId: t.tenantId, pinned: !t.pinned })}
                      className={cn(
                        "grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors hover:bg-surface-2",
                        t.pinned ? "text-amber-500" : "text-text-tertiary",
                      )}
                    >
                      <Icon icon={StarIcon} size={15} className={t.pinned ? "fill-current" : undefined} />
                    </button>
                    {!t.isOwnFirm && (
                      <div className="relative">
                        <button
                          type="button"
                          aria-label={`More actions for ${t.name}`}
                          aria-haspopup="menu"
                          aria-expanded={menuFor === t.tenantId}
                          onClick={() => setMenuFor(menuFor === t.tenantId ? null : t.tenantId)}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-tertiary transition-colors hover:bg-surface-2"
                        >
                          <Icon icon={MoreHorizontalIcon} size={15} />
                        </button>
                        {menuFor === t.tenantId && (
                          <div role="menu" className="absolute right-0 top-9 z-10 w-44 rounded-lg border border-border-light bg-surface-0 py-1 shadow-modal">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => setLeaving(t)}
                              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                            >
                              Leave this client
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {data?.nextCursor && (
            <div className="px-2 py-2">
              <button
                type="button"
                className="btn-secondary btn-sm w-full"
                disabled={query.isFetching}
                onClick={() => setCursor(data.nextCursor ?? undefined)}
              >
                Load more
              </button>
            </div>
          )}
        </div>

        {onCreateNew && (
          <button
            type="button"
            onClick={onCreateNew}
            className="group mt-3 flex w-full items-center gap-3 rounded-lg border border-dashed border-border-medium px-4 py-3 text-left transition-colors hover:border-brand-400 hover:bg-brand-600/5"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-secondary group-hover:text-brand-600">
              <Icon icon={Add01Icon} size={16} />
            </div>
            <span className="text-sm font-medium text-text-secondary transition-colors group-hover:text-brand-700">
              Create new organization
            </span>
          </button>
        )}
      </div>

      {leaving && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmDialog
            open
            variant="danger"
            title={leaveClientWarning(leaving.name).title}
            description={leaveClientWarning(leaving.name).description}
            confirmLabel={leaveClientWarning(leaving.name).confirmLabel}
            loading={leave.isPending}
            onCancel={() => setLeaving(null)}
            onConfirm={() => leave.mutate({ tenantId: leaving.tenantId })}
          />
        </div>
      )}
    </div>
  );
}
