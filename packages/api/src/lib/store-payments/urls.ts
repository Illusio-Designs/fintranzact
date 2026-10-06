/**
 * Where a shopper is sent back to after paying, and where order emails link.
 *
 * Only ever built from the configured STORE_URL (the storefront's own origin,
 * e.g. https://store.fintranzact.com), never from a request header: nothing a
 * visitor sends can decide where Razorpay redirects them. With STORE_URL unset
 * (or not an http(s) URL) there is no return link at all and the shopper just
 * stays on Razorpay's confirmation page.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function storeBaseUrl(): string | null {
  const raw = (process.env.STORE_URL ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** The storefront's order page for one order, or null when no storefront URL is configured. */
export function storeOrderUrl(slug: string, orderId: string): string | null {
  const base = storeBaseUrl();
  if (!base || !SLUG_RE.test(slug) || !UUID_RE.test(orderId)) return null;
  return `${base}/${slug}/order/${orderId}`;
}
