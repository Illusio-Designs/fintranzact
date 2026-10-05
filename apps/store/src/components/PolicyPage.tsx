import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { fetchPolicies } from "../api";
import type { PolicyBlock, PolicyInline, StorePolicies } from "../types";
import { PolicyLinks, type PolicyKind } from "./PolicyLinks";

interface PolicyPageProps {
  slug: string;
  kind: PolicyKind;
}

/**
 * One policy page at /<slug>/policies/<kind>. The text arrives as a block tree
 * from the API (never HTML) and is rendered as React text nodes, so nothing the
 * owner types can inject markup. A plain-HTML copy of the same page is served
 * by the API for crawlers at /store/<slug>/policies/<kind>.
 */
export function PolicyPage({ slug, kind }: PolicyPageProps) {
  const [data, setData] = useState<StorePolicies | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    fetchPolicies(slug)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const page = data?.policies.find((p) => p.kind === kind);

  useEffect(() => {
    if (data && page) document.title = `${page.title} — ${data.business.name}`;
  }, [data, page]);

  if (error || (data && !page)) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-dvh px-4 text-center"
        style={{ background: "var(--store-bg-secondary)" }}
      >
        <p className="text-lg font-semibold mb-2" style={{ color: "var(--store-text)" }}>
          Page not found
        </p>
        <p className="text-sm mb-4" style={{ color: "var(--store-muted)" }}>
          This page is not available.
        </p>
        <a href={`/${slug}`} className="text-sm underline" style={{ color: "var(--store-accent)" }}>
          Back to the store
        </a>
      </div>
    );
  }

  if (!data || !page) {
    return (
      <div className="flex items-center justify-center min-h-dvh" style={{ background: "var(--store-bg-secondary)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--store-muted)" }}>
          Loading...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh" style={{ background: "var(--store-bg-secondary)" }}>
      <header className="border-b" style={{ borderColor: "var(--store-border-light)", background: "var(--store-bg)" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <a href={`/${slug}`} className="text-base font-bold" style={{ color: "var(--store-text)" }}>
            {data.business.name}
          </a>
          <a href={`/${slug}`} className="text-sm underline" style={{ color: "var(--store-accent)" }}>
            Back to store
          </a>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <article
          className="rounded-2xl p-5 sm:p-8"
          style={{ background: "var(--store-bg)", border: "1px solid var(--store-border-light)" }}
        >
          <h1
            className="text-2xl font-bold mb-4"
            style={{ color: "var(--store-text)", letterSpacing: "-0.02em" }}
          >
            {page.title}
          </h1>
          {page.blocks.map((block, i) => (
            <Block key={i} block={block} />
          ))}
          {page.updatedAt && (
            <p className="text-xs mt-6" style={{ color: "var(--store-muted)" }}>
              Last updated: {page.updatedAt.slice(0, 10)}
            </p>
          )}
        </article>
        <PolicyLinks
          slug={slug}
          current={kind}
          className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-6 justify-center"
        />
      </main>
    </div>
  );
}

function Block({ block }: { block: PolicyBlock }): ReactNode {
  const text = { color: "var(--store-text-secondary)" };
  if (block.type === "heading") {
    const Tag = block.level === 2 ? "h2" : "h3";
    return (
      <Tag
        className={block.level === 2 ? "text-base font-semibold mt-6 mb-2" : "text-sm font-semibold mt-4 mb-1.5"}
        style={{ color: "var(--store-text)" }}
      >
        <Inline parts={block.inline} />
      </Tag>
    );
  }
  if (block.type === "paragraph") {
    return (
      <p className="text-sm leading-relaxed my-2" style={text}>
        <Inline parts={block.inline} />
      </p>
    );
  }
  const List = block.ordered ? "ol" : "ul";
  return (
    <List
      className={`${block.ordered ? "list-decimal" : "list-disc"} pl-5 space-y-1 text-sm leading-relaxed my-2`}
      style={text}
    >
      {block.items.map((item, i) => (
        <li key={i}>
          <Inline parts={item} />
        </li>
      ))}
    </List>
  );
}

function Inline({ parts }: { parts: PolicyInline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.type === "text") return <span key={i}>{p.text}</span>;
        if (p.type === "strong") {
          return (
            <strong key={i} style={{ color: "var(--store-text)" }}>
              {p.text}
            </strong>
          );
        }
        return (
          <a
            key={i}
            href={p.href}
            className="underline"
            style={{ color: "var(--store-accent)" }}
            rel="noopener noreferrer nofollow"
            target={p.href.startsWith("http") ? "_blank" : undefined}
          >
            {p.text}
          </a>
        );
      })}
    </>
  );
}
