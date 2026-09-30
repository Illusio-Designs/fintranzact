/**
 * Build-time support for the help centre (src/content/help/**.mdx, served at
 * /help):
 *   - compiles the articles with MDX, GitHub-flavoured Markdown (tables),
 *     frontmatter (exported as `frontmatter`) and ":::note / :::tip /
 *     :::caution / :::danger" asides, which become <Aside> components;
 *   - serves `virtual:help-index`, the title and description of every
 *     article, so the sidebar search does not have to load the articles;
 *   - fails the build when an article is missing from the table of contents
 *     in src/lib/help-paths.ts (which also feeds the sitemap), or the other
 *     way round.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import type { Plugin } from "vite";
import mdx from "@mdx-js/rollup";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import { visit, SKIP } from "unist-util-visit";
import { parse as parseYaml } from "yaml";
import { HELP_SLUGS } from "./src/lib/help-paths";

export const HELP_CONTENT_DIR = path.resolve(__dirname, "src/content/help");

const ASIDE_TYPES = new Set(["note", "tip", "caution", "danger"]);

// Minimal mdast shapes; the full types live in @types/mdast, which is only a
// transitive dependency here.
type MdNode = {
  type: string;
  name?: string;
  value?: string;
  depth?: number;
  children?: MdNode[];
  attributes?: unknown;
  data?: Record<string, unknown> & { directiveLabel?: boolean; hProperties?: Record<string, unknown> };
};

function textOf(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(textOf).join("");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Turn Starlight-style asides into <Aside type title> elements, give each
 * heading an id (never linked to with a #hash, but handy for the "on this
 * page" list), and put any other ":name" directive back as plain text so a
 * stray colon in the prose is left alone.
 */
function remarkHelp() {
  return (tree: MdNode) => {
    const seen = new Map<string, number>();
    visit(tree as never, (node: MdNode, index: number | undefined, parent: MdNode | undefined) => {
      if (node.type === "heading") {
        const base = slugify(textOf(node)) || "section";
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: n ? `${base}-${n}` : base } };
        return;
      }
      if (node.type === "containerDirective" && node.name && ASIDE_TYPES.has(node.name)) {
        const children = node.children ?? [];
        const label = children[0]?.data?.directiveLabel ? children.shift() : undefined;
        const attributes = [{ type: "mdxJsxAttribute", name: "type", value: node.name }];
        if (label) attributes.push({ type: "mdxJsxAttribute", name: "title", value: textOf(label) });
        Object.assign(node, { type: "mdxJsxFlowElement", name: "Aside", attributes, children, data: undefined });
        return;
      }
      if (
        (node.type === "textDirective" || node.type === "leafDirective" || node.type === "containerDirective") &&
        parent &&
        index !== undefined
      ) {
        const marker = node.type === "textDirective" ? ":" : node.type === "leafDirective" ? "::" : ":::";
        const label = node.children?.length ? [{ type: "text", value: "[" }, ...node.children, { type: "text", value: "]" }] : [];
        const inline = [{ type: "text", value: `${marker}${node.name}` }, ...label];
        const replacement = node.type === "textDirective" ? inline : [{ type: "paragraph", children: inline }];
        parent.children!.splice(index, 1, ...(replacement as MdNode[]));
        return [SKIP, index + replacement.length];
      }
    });
  };
}

/** Every article file under src/content/help, as slugs ("" for the home page). */
export function scanHelpSlugs(dir = HELP_CONTENT_DIR): string[] {
  const slugs: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = path.join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".mdx")) {
        slugs.push(
          path
            .relative(dir, full)
            .split(path.sep)
            .join("/")
            .replace(/\.mdx$/, "")
            .replace(/(^|\/)index$/, ""),
        );
      }
    }
  };
  walk(dir);
  return slugs.sort();
}

function slugToFile(slug: string): string {
  const direct = path.join(HELP_CONTENT_DIR, `${slug}.mdx`);
  try {
    if (slug && statSync(direct).isFile()) return direct;
  } catch {
    // Not a flat file: the folder's index.mdx.
  }
  return path.join(HELP_CONTENT_DIR, slug, "index.mdx");
}

function readFrontmatter(file: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, "utf-8"));
  return match ? ((parseYaml(match[1]) as Record<string, unknown>) ?? {}) : {};
}

const INDEX_ID = "virtual:help-index";
const RESOLVED_INDEX_ID = `\0${INDEX_ID}`;

function helpIndexPlugin(): Plugin {
  return {
    name: "fintranzact-help-index",
    buildStart() {
      const onDisk = scanHelpSlugs();
      const listed = [...HELP_SLUGS].sort();
      const unlisted = onDisk.filter((s) => !listed.includes(s));
      const missing = listed.filter((s) => !onDisk.includes(s));
      if (unlisted.length || missing.length) {
        this.error(
          `Help centre table of contents (src/lib/help-paths.ts) is out of step with src/content/help.` +
            (unlisted.length ? ` Not listed: ${unlisted.join(", ")}.` : "") +
            (missing.length ? ` No article for: ${missing.join(", ")}.` : ""),
        );
      }
    },
    resolveId(id) {
      return id === INDEX_ID ? RESOLVED_INDEX_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_INDEX_ID) return;
      const entries = HELP_SLUGS.map((slug) => {
        const file = slugToFile(slug);
        this.addWatchFile(file);
        const fm = readFrontmatter(file);
        return { slug, title: String(fm.title ?? slug), description: String(fm.description ?? "") };
      });
      return `export default ${JSON.stringify(entries)};`;
    },
  };
}

export function helpPlugins(): Plugin[] {
  return [
    {
      enforce: "pre",
      ...mdx({
        include: ["**/src/content/help/**/*.mdx"],
        remarkPlugins: [
          remarkFrontmatter,
          [remarkMdxFrontmatter, { name: "frontmatter" }],
          remarkGfm,
          remarkDirective,
          remarkHelp,
        ],
      }),
    } as Plugin,
    helpIndexPlugin(),
  ];
}
