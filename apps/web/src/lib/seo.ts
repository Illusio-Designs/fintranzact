/**
 * Site URL and sitemap helpers. Pure and free of UI or `import.meta.env`
 * imports so vite.config.ts can use them at build time as well as the app.
 */
import { HELP_PAGE_PATHS, MARKETING_PATHS, SOLUTION_PAGE_PATHS } from "./public-paths";
import { DEVELOPER_PAGE_PATHS } from "./developer-paths";

/**
 * The production web origin, used when VITE_SITE_URL is not set. It is the
 * same address index.html ships in its og: tags; the build rewrites those to
 * VITE_SITE_URL when one is configured.
 */
export const DEFAULT_SITE_URL = "https://fintranzact-web.vercel.app";

/** Normalise a configured site URL to a bare origin-plus-path with no trailing slash. */
export function resolveSiteUrl(value: string | undefined | null): string {
  const raw = value?.trim();
  if (!raw) return DEFAULT_SITE_URL;
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return DEFAULT_SITE_URL;
  }
}

/**
 * Lists of indexable pages from public-paths.ts. To add another group of
 * public pages (e.g. SOLUTION_PATHS), append its list here: the sitemap and
 * the robots.txt test both follow.
 */
export const INDEXABLE_PATH_LISTS: ReadonlyArray<readonly string[]> = [
  MARKETING_PATHS,
  SOLUTION_PAGE_PATHS,
  HELP_PAGE_PATHS,
  DEVELOPER_PAGE_PATHS,
];

/** Every public page a search engine should index: the home page plus every list above, de-duplicated. */
export function sitemapPaths(): string[] {
  return [...new Set(["/", ...INDEXABLE_PATH_LISTS.flat()])];
}

/** Absolute URL for a path on the site ("/" stays as the bare site URL plus "/"). */
export function absoluteUrl(siteUrl: string, path: string): string {
  const clean = path.replace(/[?#].*$/, "").replace(/\/+$/, "");
  return `${siteUrl}${clean || "/"}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** sitemap.xml for the given site URL. Paths default to the home page plus MARKETING_PATHS. */
export function buildSitemap(siteUrl: string, paths: string[] = sitemapPaths()): string {
  const urls = paths
    .map((path) => {
      const priority = path === "/" ? "1.0" : "0.8";
      return `  <url>\n    <loc>${escapeXml(absoluteUrl(siteUrl, path))}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
