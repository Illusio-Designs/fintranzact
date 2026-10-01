// Types for the help centre articles (src/content/help/**.mdx), compiled by
// vite-help.ts. This is a script file (no top-level import) so it augments
// the "*.mdx" module declared by @types/mdx.

declare module "*.mdx" {
  /** The article's YAML frontmatter. */
  export const frontmatter: import("@/lib/help-content").HelpFrontmatter;
}

declare module "virtual:help-index" {
  /** Title and description of every article, in sidebar order. */
  const entries: Array<{ slug: string; title: string; description: string }>;
  export default entries;
}
