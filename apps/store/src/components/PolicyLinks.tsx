// The five policy pages every store carries. Each has its own URL under the
// store: /<slug>/policies/<kind>. Kinds match the API (GET /store/:slug/policies.json).
export const POLICY_PAGES = [
  { kind: "terms", label: "Terms & Conditions" },
  { kind: "refund", label: "Refund & Cancellation" },
  { kind: "shipping", label: "Shipping & Delivery" },
  { kind: "contact", label: "Contact Us" },
  { kind: "privacy", label: "Privacy Policy" },
] as const;

export type PolicyKind = (typeof POLICY_PAGES)[number]["kind"];

export function isPolicyKind(value: string | undefined): value is PolicyKind {
  return POLICY_PAGES.some((p) => p.kind === value);
}

export function policyHref(slug: string, kind: PolicyKind): string {
  return `/${slug}/policies/${kind}`;
}

interface PolicyLinksProps {
  slug: string;
  className?: string;
  /** Pages to list; defaults to all five. */
  kinds?: readonly PolicyKind[];
  /** Open in a new tab (used at checkout so the order form is not left). */
  newTab?: boolean;
  current?: PolicyKind;
}

/** Plain anchors, so every link also works without JavaScript and is crawlable. */
export function PolicyLinks({ slug, className, kinds, newTab, current }: PolicyLinksProps) {
  const pages = POLICY_PAGES.filter((p) => !kinds || kinds.includes(p.kind));
  return (
    <nav aria-label="Store policies" className={className}>
      {pages.map((p, i) => (
        <span key={p.kind} className="flex items-center gap-x-4">
          {i > 0 && (
            <span className="text-xs" style={{ color: "var(--store-border)" }} aria-hidden="true">
              |
            </span>
          )}
          <a
            href={policyHref(slug, p.kind)}
            className="text-xs font-medium hover:underline"
            style={{ color: "var(--store-text-secondary)", fontWeight: current === p.kind ? 700 : undefined }}
            aria-current={current === p.kind ? "page" : undefined}
            {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {p.label}
          </a>
        </span>
      ))}
    </nav>
  );
}
