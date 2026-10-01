/**
 * Loading help centre articles. Each article (src/content/help/**.mdx) is its
 * own chunk, fetched when its page opens; titles and descriptions for the
 * sidebar search come from `virtual:help-index` (see vite-help.ts) so the
 * search never has to load the articles themselves.
 */
import type { ComponentType } from "react";
import type { MDXProps } from "mdx/types";
import helpIndex from "virtual:help-index";
import { HELP_ENTRIES, type HelpNavEntry } from "@/lib/help-paths";

export type HelpFrontmatter = {
  title: string;
  description?: string;
  /** "splash" for the help home page. */
  template?: string;
  hero?: {
    tagline?: string;
    actions?: Array<{ text: string; link: string; variant?: string; icon?: string }>;
  };
};

export type HelpArticle = {
  slug: string;
  frontmatter: HelpFrontmatter;
  Content: ComponentType<MDXProps>;
};

type HelpModule = { default: ComponentType<MDXProps>; frontmatter?: HelpFrontmatter };

const modules = import.meta.glob<HelpModule>("../content/help/**/*.mdx");

/** "../content/help/invoicing/index.mdx" -> "invoicing"; the top-level index is "". */
function slugOf(key: string): string {
  return key
    .replace(/^\.\.\/content\/help\/?/, "")
    .replace(/\.mdx$/, "")
    .replace(/(^|\/)index$/, "");
}

const LOADERS = new Map(Object.entries(modules).map(([key, load]) => [slugOf(key), load]));

/** Load an article by slug, or null when there is none. */
export async function loadHelpArticle(slug: string): Promise<HelpArticle | null> {
  const clean = slug.replace(/^\/+|\/+$/g, "");
  const load = LOADERS.get(clean);
  if (!load) return null;
  const mod = await load();
  return {
    slug: clean,
    frontmatter: mod.frontmatter ?? { title: HELP_ENTRIES.find((e) => e.slug === clean)?.label ?? "Help" },
    Content: mod.default,
  };
}

export type HelpSearchEntry = HelpNavEntry & { title: string; description: string };

const INDEX_BY_SLUG = new Map(helpIndex.map((e) => [e.slug, e]));

/** Every article with its sidebar label, section trail, title and description, in reading order. */
export const HELP_SEARCH_INDEX: HelpSearchEntry[] = HELP_ENTRIES.map((entry) => ({
  ...entry,
  title: INDEX_BY_SLUG.get(entry.slug)?.title ?? entry.label,
  description: INDEX_BY_SLUG.get(entry.slug)?.description ?? "",
}));

/** Articles matching every word of the query, best matches (title hits) first. */
export function searchHelp(query: string, limit = 8): HelpSearchEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = HELP_SEARCH_INDEX.map((entry) => {
    const title = `${entry.title} ${entry.label}`.toLowerCase();
    const rest = `${entry.description} ${entry.trail.join(" ")}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (title.includes(w)) score += title.startsWith(w) ? 4 : 3;
      else if (rest.includes(w)) score += 1;
      else return { entry, score: 0 };
    }
    return { entry, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry);
}
