/**
 * AI business assistant (Phase 3): help-centre answers.
 *
 * The assistant answers "how do I..." questions from the help articles. The
 * index of articles (title, summary, headings, path, platform) is GENERATED
 * from apps/web/src/content/help into help-index.generated.ts, so the API can
 * search it without reading the web app's source, and a web test fails when the
 * generated file is stale. This module is the pure search plus the one check
 * the link validator needs: is this path an article that exists?
 */

import { HELP_INDEX } from "./help-index.generated.js";

export interface HelpIndexEntry {
  /** "invoicing/create-invoice"; "" for the help home page. */
  slug: string;
  /** "/help/invoicing/create-invoice"; "/help" for the home page. */
  path: string;
  title: string;
  summary: string;
  headings: string[];
  /** The article's first numbered steps (at most 8, each short). */
  steps: string[];
  /** web = web app steps only, web_and_mobile = both, any = not tied to one. */
  platform: "web" | "web_and_mobile" | "any";
}

export { HELP_INDEX };

const HELP_PATHS: ReadonlySet<string> = new Set(HELP_INDEX.map((e) => e.path));

/** True for the path of an article that exists in the help centre (exact match, no query string, no hash). */
export function isAiHelpPath(path: unknown): path is string {
  return typeof path === "string" && HELP_PATHS.has(path);
}

export function findHelpEntry(path: string): HelpIndexEntry | undefined {
  return HELP_INDEX.find((e) => e.path === path);
}

const STOPWORDS = new Set([
  "a", "an", "the", "i", "me", "my", "we", "our", "you", "your", "to", "of", "in", "on", "for", "and", "or", "is", "are", "it", "its", "with", "at", "by",
  "how", "do", "does", "can", "could", "should", "would", "what", "where", "when", "which", "who", "why", "about", "from", "into", "this", "that",
  "please", "want", "need", "help", "using", "use", "fintranzact", "app", "way", "steps", "step", "get", "make",
]);

/** Lower-case word stems: plural and -ing/-ed endings removed from longer words. */
export function helpStems(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (STOPWORDS.has(raw)) continue;
    let w = raw;
    if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
    else if (w.length > 4 && /(?:[sxz]|ch|sh)es$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith("s")) w = w.slice(0, -1);
    if (w.length >= 2) out.push(w);
  }
  return out;
}

interface Tokenised {
  entry: HelpIndexEntry;
  title: string[];
  headings: string[];
  slug: string[];
  summary: string[];
}

let tokenised: Tokenised[] | null = null;
function tokens(): Tokenised[] {
  tokenised ??= HELP_INDEX.map((entry) => ({
    entry,
    title: helpStems(entry.title),
    headings: helpStems(entry.headings.join(" ")),
    slug: helpStems(entry.slug.replace(/[/-]/g, " ")),
    summary: helpStems(entry.summary),
  }));
  return tokenised;
}

const has = (words: string[], q: string): boolean => words.some((w) => w === q || (q.length >= 4 && (w.startsWith(q) || q.startsWith(w)) && w.length >= 4));

export const HELP_SEARCH_MAX_QUERY_CHARS = 120;

/** The best-matching articles for a question, most relevant first. Empty when nothing matches. */
export function searchHelpIndex(query: string, limit = 4): HelpIndexEntry[] {
  const words = [...new Set(helpStems(query.slice(0, HELP_SEARCH_MAX_QUERY_CHARS)))];
  if (words.length === 0) return [];
  const scored = tokens().flatMap((t) => {
    let score = 0;
    let matched = 0;
    for (const q of words) {
      let s = 0;
      if (has(t.title, q)) s += 6;
      if (has(t.slug, q)) s += 3;
      if (has(t.headings, q)) s += 3;
      if (has(t.summary, q)) s += 1.5;
      if (s > 0) matched++;
      score += s;
    }
    if (matched === 0) return [];
    // Articles that cover more of the question's words rank higher; a lone weak match is dropped.
    score += (matched / words.length) * 4;
    if (words.length > 1 && matched < 2 && score < 6) return [];
    // The home page and section overviews only ever win by default.
    if (t.entry.slug === "") score -= 5;
    return score > 1 ? [{ entry: t.entry, score }] : [];
  });
  return scored
    .sort((a, b) => b.score - a.score || (a.entry.slug < b.entry.slug ? -1 : 1))
    .slice(0, Math.max(1, Math.min(8, limit)))
    .map((s) => s.entry);
}
