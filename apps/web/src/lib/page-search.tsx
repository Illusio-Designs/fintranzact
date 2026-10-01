import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * One search box for the whole app, in the header.
 *
 * A list page calls `usePageSearch("Search parties…")`: while it is mounted the
 * header box filters that page's list (the page reads the returned query).
 * Pages without a list leave the header as the app-wide "Search or jump to…"
 * command palette, which ⌘K opens from anywhere.
 */
interface PageSearchState {
  /** Placeholder of the page currently using the header box, or null. */
  placeholder: string | null;
  query: string;
  setQuery: (query: string) => void;
  register: (placeholder: string) => void;
  unregister: (placeholder: string) => void;
}

const PageSearchContext = createContext<PageSearchState | null>(null);

export function PageSearchProvider({ children }: { children: ReactNode }) {
  const [placeholder, setPlaceholder] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const value = useMemo<PageSearchState>(() => ({
    placeholder,
    query,
    setQuery,
    register: (next) => {
      setPlaceholder(next);
      setQuery("");
    },
    unregister: (current) => {
      setPlaceholder((p) => (p === current ? null : p));
      setQuery("");
    },
  }), [placeholder, query]);

  return <PageSearchContext.Provider value={value}>{children}</PageSearchContext.Provider>;
}

/** Header side: the page search currently registered, if any. */
export function usePageSearchSlot() {
  return useContext(PageSearchContext);
}

/**
 * Page side: hand the header search box to this page and get back its query.
 * Returns [query, setQuery] so a page can also clear it (e.g. on filter reset).
 */
export function usePageSearch(placeholder: string): [string, (query: string) => void] {
  const ctx = useContext(PageSearchContext);
  const register = ctx?.register;
  const unregister = ctx?.unregister;

  useEffect(() => {
    register?.(placeholder);
    return () => unregister?.(placeholder);
    // register/unregister change identity with state; the slot only needs
    // to follow the page mounting and its placeholder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeholder]);

  // Outside a provider (tests, isolated renders) behave like a local search.
  const [localQuery, setLocalQuery] = useState("");
  return ctx ? [ctx.query, ctx.setQuery] : [localQuery, setLocalQuery];
}
