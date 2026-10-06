/**
 * Store policy pages (Terms, Refund, Shipping, Contact, Privacy).
 *
 * Every online store needs these pages (payment gateways check for them
 * before approving online payments). This module holds the pure logic shared
 * by the API (public pages, editor preview) and the clients:
 *
 *   - the five page kinds and their public URL segments
 *   - default templates with {{placeholders}} filled from the business
 *   - a tiny, safe markdown subset parsed into a block tree (no raw HTML is
 *     ever passed through; renderers escape or use React text nodes)
 *
 * The templates are plain-language starting points the owner edits. They are
 * not legal advice.
 */

export const STORE_POLICY_KINDS = ["terms", "refund", "shipping", "contact", "privacy"] as const;
export type StorePolicyKind = (typeof STORE_POLICY_KINDS)[number];

export function isStorePolicyKind(value: unknown): value is StorePolicyKind {
  return typeof value === "string" && (STORE_POLICY_KINDS as readonly string[]).includes(value);
}

export const STORE_POLICY_TITLES: Record<StorePolicyKind, string> = {
  terms: "Terms & Conditions",
  refund: "Refund & Cancellation Policy",
  shipping: "Shipping & Delivery Policy",
  contact: "Contact Us",
  privacy: "Privacy Policy",
};

/** Short label for footer links and tabs. */
export const STORE_POLICY_SHORT_TITLES: Record<StorePolicyKind, string> = {
  terms: "Terms & Conditions",
  refund: "Refund & Cancellation",
  shipping: "Shipping & Delivery",
  contact: "Contact Us",
  privacy: "Privacy Policy",
};

/** URL segment under the store address: /<slug>/policies/<segment>. Equal to the kind. */
export function storePolicyPath(slug: string, kind: StorePolicyKind): string {
  return `/${slug}/policies/${kind}`;
}

export const STORE_POLICY_MAX_LENGTH = 20_000;
export const STORE_RETURN_WINDOW_DEFAULT_DAYS = 7;
export const STORE_RETURN_WINDOW_MAX_DAYS = 365;

export interface StorePolicyVariables {
  businessName: string;
  address?: string | null;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  returnWindowDays: number;
  /** The store's delivery charge in words (see describeStoreDelivery); empty when it charges nothing. */
  deliveryCharges?: string | null;
}

/** Placeholders usable in policy text, with what each one is filled with. */
export const STORE_POLICY_PLACEHOLDERS: ReadonlyArray<{ key: keyof StorePolicyVariables; label: string }> = [
  { key: "businessName", label: "Business name" },
  { key: "address", label: "Address" },
  { key: "gstin", label: "GSTIN" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "returnWindowDays", label: "Return window (days)" },
  { key: "deliveryCharges", label: "Delivery charge (from your delivery settings)" },
];

// ── Templates ──────────────────────────────────────────────────

const TERMS = `These terms apply to every order you place on the online store of **{{businessName}}** ("we", "us"). By placing an order you agree to them.

## About us

- Business name: {{businessName}}
- Address: {{address}}
- GSTIN: {{gstin}}
- Phone: {{phone}}
- Email: {{email}}

## Orders and prices

- All prices are in Indian Rupees (INR) and include or exclude GST as shown on the item and at checkout.
- An order is confirmed only when we accept it. We may decline or cancel an order, for example when an item is out of stock or a price was listed wrongly. If you have already paid, we will refund you.
- Please check the details you enter (name, phone, delivery address) before you place the order.

## Payments

- Payment options are shown at checkout. Online payments are processed by our payment partner; we do not see or store your card, UPI PIN or bank login details.
- A GST invoice is issued for your order where applicable.

## Returns, delivery and privacy

- Our Refund & Cancellation Policy explains returns, refunds and cancellations.
- Our Shipping & Delivery Policy explains delivery areas, charges and timelines.
- Our Privacy Policy explains how we handle your personal information.

## Changes to these terms

We may update these terms from time to time. The version on this page when you place your order applies to that order.

## Disputes

These terms are governed by the laws of India. For any complaint, please write to us first using the details on the Contact Us page and we will try to resolve it.`;

const REFUND = `This policy explains how cancellations, returns and refunds work for orders placed on the online store of **{{businessName}}**.

## Cancellations

- You can ask us to cancel an order before it is dispatched. Contact us as soon as possible using the details below.
- Once an order is dispatched it can no longer be cancelled, but you may return it as described below.
- If we cancel your order (for example because an item is out of stock), any amount you paid is refunded in full.

## Returns

- You can request a return within **{{returnWindowDays}} days** of receiving your order.
- Items should be unused, in their original condition and packaging, with the invoice.
- Some items may not be returnable, such as perishable goods or items made to order. These are stated on the item page where applicable.
- If you receive a damaged, defective or wrong item, tell us within {{returnWindowDays}} days of delivery with a photo, and we will replace it or refund you.

## Refunds

- Approved refunds are sent to the original payment method.
- Refunds are usually processed within 7 working days after we receive and check the returned item. Your bank or payment provider may take a few more days to show the credit.
- For cash on delivery orders, we will agree a refund method with you.

## How to contact us

- Business: {{businessName}}
- Phone: {{phone}}
- Email: {{email}}
- Address: {{address}}`;

const SHIPPING = `This policy explains how orders from **{{businessName}}** are shipped and delivered.

## Where we deliver

We deliver to the addresses and pincodes we are able to serve. If we cannot deliver to your location we will tell you after you place the order, and any amount you paid will be refunded.

## Processing and delivery time

- Orders are processed after we confirm them. The expected delivery time is shown at checkout or told to you when the order is confirmed.
- Delivery times are estimates. Delays can happen because of weather, holidays or courier issues.

## Shipping charges

Delivery charges, if any, are shown at checkout before you pay. Any minimum order value for delivery is also shown there.

- Delivery charge: {{deliveryCharges}}

## Delivery

- Please give a complete and correct address and a phone number we can reach, so the delivery partner can contact you.
- Please check the package at delivery. If it looks damaged or tampered with, tell us within {{returnWindowDays}} days of delivery.

## Questions about your order

- Phone: {{phone}}
- Email: {{email}}
- Address: {{address}}`;

const CONTACT = `We are happy to help with orders, deliveries, returns and anything else about **{{businessName}}**.

- Business name: {{businessName}}
- Address: {{address}}
- Phone: {{phone}}
- Email: {{email}}
- GSTIN: {{gstin}}

When you write to us, please mention your order number so we can help faster.`;

const PRIVACY = `This policy explains what personal information **{{businessName}}** collects through this online store and how we use it. It is written in plain language and is not a substitute for legal advice.

## What we collect

- Your name, phone number and email address.
- Your delivery address and any delivery notes you add.
- Your order details, such as items, amounts and order status.

## Why we use it

- To confirm, deliver and support your order, and to send you updates about it.
- To issue invoices and keep records the law requires us to keep (for example, tax records).
- To prevent fraud and misuse of the store.

We use your information only for these purposes and for the other purposes you agree to.

## Who we share it with

- Delivery and payment partners, only as needed to deliver your order and process your payment.
- The software provider that hosts this store for us, which stores the data on our behalf.
- Authorities, where the law requires it.

We do not sell your personal information.

## Payments

Online payments are handled by our payment partner. We do not see or store your card number, UPI PIN or bank login details.

## How long we keep it

We keep order and invoice records for as long as the law requires and as long as needed to handle returns and complaints. After that we delete or anonymise them.

## Your choices

Under Indian law, including the Digital Personal Data Protection Act, 2023, you may ask us to give you a copy of the personal data we hold about you, to correct it, or to delete it where we no longer need it. You may also withdraw consent for optional uses. Write to us using the details below.

## Security

We take reasonable steps to protect your information. No online system is completely secure, so please tell us at once if you think your information has been misused.

## Contact for privacy questions

- Business: {{businessName}}
- Address: {{address}}
- Phone: {{phone}}
- Email: {{email}}`;

const TEMPLATES: Record<StorePolicyKind, string> = {
  terms: TERMS,
  refund: REFUND,
  shipping: SHIPPING,
  contact: CONTACT,
  privacy: PRIVACY,
};

/** The default template for a page, with {{placeholders}} unfilled. */
export function defaultPolicyTemplate(kind: StorePolicyKind): string {
  return TEMPLATES[kind];
}

// ── Placeholder fill ───────────────────────────────────────────

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

function variableValue(vars: StorePolicyVariables, key: string): string {
  switch (key) {
    case "businessName": return vars.businessName.trim();
    case "address": return (vars.address ?? "").trim();
    case "gstin": return (vars.gstin ?? "").trim();
    case "phone": return (vars.phone ?? "").trim();
    case "email": return (vars.email ?? "").trim();
    case "returnWindowDays": return String(vars.returnWindowDays);
    case "deliveryCharges": return (vars.deliveryCharges ?? "").trim();
    default: return "";
  }
}

const KNOWN_KEYS = new Set<string>(STORE_POLICY_PLACEHOLDERS.map((p) => p.key));

/**
 * Fill {{placeholders}}. A line that uses a placeholder whose value is empty
 * is dropped entirely, so a business with no GSTIN or phone never shows
 * "GSTIN: " with nothing after it. Unknown placeholders are left as written
 * so the owner can see and fix the typo.
 */
export function fillPolicyPlaceholders(text: string, vars: StorePolicyVariables): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    let dropLine = false;
    const filled = line.replace(PLACEHOLDER_RE, (match, key: string) => {
      if (!KNOWN_KEYS.has(key)) return match;
      const value = variableValue(vars, key);
      if (!value) {
        dropLine = true;
        return "";
      }
      return value;
    });
    if (!dropLine) out.push(filled);
  }
  // Collapse blank-line runs and headings left without any content.
  return tidyBlankLines(out.join("\n")).trim();
}

function tidyBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

/** Strip control characters and normalise newlines; caps the length. */
export function sanitizePolicyInput(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, STORE_POLICY_MAX_LENGTH);
}

// ── Safe markdown subset ───────────────────────────────────────

export type PolicyInline =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "link"; text: string; href: string };

export type PolicyBlock =
  | { type: "heading"; level: 2 | 3; inline: PolicyInline[] }
  | { type: "paragraph"; inline: PolicyInline[] }
  | { type: "list"; ordered: boolean; items: PolicyInline[][] };

/** Only these URL schemes become links; anything else stays plain text. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^https?:\/\/[^\s<>"']+$/i.test(href)) return href;
  if (/^mailto:[^\s<>"']+$/i.test(href)) return href;
  if (/^tel:[+0-9()\-\s]+$/i.test(href)) return href.replace(/\s+/g, "");
  return null;
}

const INLINE_RE = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>"')]+)/g;

export function parsePolicyInline(text: string): PolicyInline[] {
  const out: PolicyInline[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) {
      out.push({ type: "strong", text: m[1] });
    } else if (m[2] !== undefined) {
      const href = safeHref(m[3] ?? "");
      out.push(href ? { type: "link", text: m[2], href } : { type: "text", text: m[0] });
    } else if (m[4] !== undefined) {
      const href = safeHref(m[4]);
      out.push(href ? { type: "link", text: m[4], href } : { type: "text", text: m[4] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/**
 * Parse the markdown subset: `##` / `###` headings, `-`/`*` bullet lists,
 * `1.` numbered lists, paragraphs, **bold**, [text](url) and bare URLs.
 * Everything else, including any HTML tags, is kept as literal text.
 */
export function parsePolicyMarkdown(text: string): PolicyBlock[] {
  const blocks: PolicyBlock[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", inline: parsePolicyInline(paragraph.join(" ")) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ type: "list", ordered: list.ordered, items: list.items.map(parsePolicyInline) });
      list = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      // Page title is rendered by the page itself; # and ## are the section level.
      const level = heading[1]!.length <= 2 ? 2 : 3;
      blocks.push({ type: "heading", level, inline: parsePolicyInline(heading[2]!.trim()) });
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!.trim());
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

// ── HTML rendering (for server-rendered pages) ─────────────────

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineHtml(parts: PolicyInline[]): string {
  return parts
    .map((p) => {
      if (p.type === "text") return escapeHtml(p.text);
      if (p.type === "strong") return `<strong>${escapeHtml(p.text)}</strong>`;
      return `<a href="${escapeHtml(p.href)}" rel="noopener noreferrer nofollow">${escapeHtml(p.text)}</a>`;
    })
    .join("");
}

/** Render a block tree to escaped HTML. Safe to embed: only our own tags are emitted. */
export function policyBlocksToHtml(blocks: PolicyBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === "heading") return `<h${b.level}>${inlineHtml(b.inline)}</h${b.level}>`;
      if (b.type === "paragraph") return `<p>${inlineHtml(b.inline)}</p>`;
      const tag = b.ordered ? "ol" : "ul";
      return `<${tag}>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</${tag}>`;
    })
    .join("\n");
}

// ── Resolution ─────────────────────────────────────────────────

export interface StoredStorePolicy {
  content: string;
  updatedAt: string;
}

export type StoredStorePolicies = Partial<Record<StorePolicyKind, StoredStorePolicy>>;

/** The markdown source for a page: the owner's text if saved, else the default template. */
export function policySource(kind: StorePolicyKind, stored: StoredStorePolicies | null | undefined): string {
  const custom = stored?.[kind]?.content;
  return custom && custom.trim() ? custom : defaultPolicyTemplate(kind);
}

export function isPolicyCustomised(kind: StorePolicyKind, stored: StoredStorePolicies | null | undefined): boolean {
  const custom = stored?.[kind]?.content;
  return !!custom && !!custom.trim();
}

/** Final markdown for a page with placeholders filled. */
export function renderPolicyText(
  kind: StorePolicyKind,
  stored: StoredStorePolicies | null | undefined,
  vars: StorePolicyVariables,
): string {
  return fillPolicyPlaceholders(policySource(kind, stored), vars);
}

/** Compose a one-line postal address from the business's address parts without repeating any part. */
export function composeBusinessAddress(parts: Array<string | null | undefined>): string {
  const kept: string[] = [];
  for (const raw of parts) {
    const part = (raw ?? "").trim();
    if (!part) continue;
    const joined = kept.join(", ").toLowerCase();
    if (joined.includes(part.toLowerCase())) continue;
    kept.push(part);
  }
  return kept.join(", ");
}
