/**
 * Store policy pages: building the pages for one business, and the
 * server-rendered HTML shell for the public crawlable URL.
 *
 * Pure functions over a business row. The template text, placeholder fill
 * and the safe markdown subset live in @fintranzact/shared so the web
 * editor preview and these public pages cannot drift apart.
 */
import {
  STORE_POLICY_KINDS,
  STORE_POLICY_TITLES,
  STORE_POLICY_SHORT_TITLES,
  STORE_RETURN_WINDOW_DEFAULT_DAYS,
  composeBusinessAddress,
  defaultPolicyTemplate,
  escapeHtml,
  isPolicyCustomised,
  parsePolicyMarkdown,
  policyBlocksToHtml,
  renderPolicyText,
  type PolicyBlock,
  type StorePolicyKind,
  type StorePolicyVariables,
  type StoredStorePolicies,
} from "@fintranzact/shared";

/** The business columns the policy pages read. */
export interface PolicyBusinessRow {
  name: string;
  gstRegistrationType: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  storeReturnWindowDays: number | null;
  storePolicies: StoredStorePolicies | null;
}

/**
 * What the policy pages publish about the business. The store already shows
 * name, phone, email and address in its footer; the GSTIN is added here (the
 * Contact and Terms pages carry it, as Indian e-commerce sites usually do) and
 * only when the business is GST registered. PAN and other IDs are never used.
 */
export function policyVariables(biz: PolicyBusinessRow): StorePolicyVariables {
  const street = biz.address?.trim() || composeBusinessAddress([biz.addressLine1, biz.addressLine2]);
  const registered = biz.gstRegistrationType !== "unregistered";
  return {
    businessName: biz.name,
    address: composeBusinessAddress([street, biz.city, biz.state, biz.pincode]),
    gstin: registered ? biz.gstin : null,
    phone: biz.phone,
    email: biz.email,
    returnWindowDays: biz.storeReturnWindowDays ?? STORE_RETURN_WINDOW_DEFAULT_DAYS,
  };
}

export interface PublicPolicyPage {
  kind: StorePolicyKind;
  title: string;
  shortTitle: string;
  /** Path on the storefront: /<slug>/policies/<kind>. */
  path: string;
  blocks: PolicyBlock[];
  /** ISO time of the owner's last edit; null while the page still follows the default template. */
  updatedAt: string | null;
}

export function buildPublicPolicyPages(slug: string, biz: PolicyBusinessRow): PublicPolicyPage[] {
  const vars = policyVariables(biz);
  return STORE_POLICY_KINDS.map((kind) => ({
    kind,
    title: STORE_POLICY_TITLES[kind],
    shortTitle: STORE_POLICY_SHORT_TITLES[kind],
    path: `/${slug}/policies/${kind}`,
    blocks: parsePolicyMarkdown(renderPolicyText(kind, biz.storePolicies, vars)),
    updatedAt: isPolicyCustomised(kind, biz.storePolicies) ? (biz.storePolicies?.[kind]?.updatedAt ?? null) : null,
  }));
}

/** The editor's view: raw template, saved text and the filled text for every page. */
export function buildEditorPolicies(biz: PolicyBusinessRow) {
  const vars = policyVariables(biz);
  return {
    variables: vars,
    policies: STORE_POLICY_KINDS.map((kind) => {
      const customised = isPolicyCustomised(kind, biz.storePolicies);
      return {
        kind,
        title: STORE_POLICY_TITLES[kind],
        template: defaultPolicyTemplate(kind),
        content: customised ? (biz.storePolicies?.[kind]?.content ?? null) : null,
        isCustom: customised,
        updatedAt: customised ? (biz.storePolicies?.[kind]?.updatedAt ?? null) : null,
      };
    }),
  };
}

const PAGE_CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1c1b1a;--muted:#6b6862;--line:#e5e2dc;--link:#2f5fb3}
@media (prefers-color-scheme:dark){:root{--bg:#161514;--fg:#ece9e4;--muted:#a09b93;--line:#33302c;--link:#8fb2f0}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main,header,footer{max-width:46rem;margin:0 auto;padding:0 1rem}
header{padding-top:1.5rem;padding-bottom:1rem;border-bottom:1px solid var(--line)}
header .biz{font-weight:600;font-size:1.05rem}
nav{display:flex;flex-wrap:wrap;gap:.25rem 1rem;margin-top:.5rem;font-size:.9rem}
a{color:var(--link)}
nav a[aria-current=page]{color:var(--fg);font-weight:600;text-decoration:none}
h1{font-size:1.6rem;line-height:1.25;margin:1.5rem 0 1rem}
h2{font-size:1.1rem;margin:1.6rem 0 .4rem}
h3{font-size:1rem;margin:1.2rem 0 .3rem}
p,ul,ol{margin:.5rem 0}
li{margin:.2rem 0}
.meta{color:var(--muted);font-size:.85rem;margin-top:2rem}
footer{padding-top:1rem;padding-bottom:2rem;color:var(--muted);font-size:.8rem;border-top:1px solid var(--line);margin-top:2rem}
`;

/**
 * Full HTML document for one policy page. Every dynamic value is escaped or
 * comes from the safe block renderer, so the owner's text can never inject
 * markup or script. A strict CSP is sent alongside it by the route.
 */
export function renderPolicyPageHtml(args: {
  slug: string;
  businessName: string;
  pages: PublicPolicyPage[];
  kind: StorePolicyKind;
  /** Base path the policy pages are served under on this host, e.g. "/store/my-shop/policies". */
  basePath: string;
}): string {
  const page = args.pages.find((p) => p.kind === args.kind);
  if (!page) throw new Error("Unknown policy page");
  const nav = args.pages
    .map((p) => {
      const current = p.kind === args.kind ? ' aria-current="page"' : "";
      return `<a href="${escapeHtml(`${args.basePath}/${p.kind}`)}"${current}>${escapeHtml(p.shortTitle)}</a>`;
    })
    .join("");
  const title = `${page.title} - ${args.businessName}`;
  const updated = page.updatedAt
    ? `<p class="meta">Last updated: ${escapeHtml(page.updatedAt.slice(0, 10))}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(`${page.title} of ${args.businessName}`)}">
<meta name="robots" content="index, follow">
<style>${PAGE_CSS}</style>
</head>
<body>
<header>
<div class="biz">${escapeHtml(args.businessName)}</div>
<nav aria-label="Store policies">${nav}</nav>
</header>
<main>
<h1>${escapeHtml(page.title)}</h1>
${policyBlocksToHtml(page.blocks)}
${updated}
</main>
<footer>Online store of ${escapeHtml(args.businessName)}. Powered by Fintranzact.</footer>
</body>
</html>
`;
}
