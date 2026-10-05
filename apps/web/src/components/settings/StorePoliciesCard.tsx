import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  STORE_POLICY_KINDS,
  STORE_POLICY_MAX_LENGTH,
  STORE_POLICY_PLACEHOLDERS,
  STORE_POLICY_SHORT_TITLES,
  STORE_POLICY_TITLES,
  parsePolicyMarkdown,
  fillPolicyPlaceholders,
  type PolicyBlock,
  type PolicyInline,
  type StorePolicyKind,
  type StorePolicyVariables,
} from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { apiUrl } from "@/lib/api-url";
import { cn } from "@/lib/utils";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Preview: rendered from the same safe block tree the public page uses.
// Never HTML: every piece of text is a React text node.
// ---------------------------------------------------------------------------

function Inline({ parts }: { parts: PolicyInline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.type === "text") return <span key={i}>{p.text}</span>;
        if (p.type === "strong") return <strong key={i}>{p.text}</strong>;
        return (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-600 underline">
            {p.text}
          </a>
        );
      })}
    </>
  );
}

function PreviewBlock({ block }: { block: PolicyBlock }): ReactNode {
  if (block.type === "heading") {
    return (
      <h4 className="text-sm font-semibold text-text-primary mt-4 mb-1">
        <Inline parts={block.inline} />
      </h4>
    );
  }
  if (block.type === "paragraph") {
    return (
      <p className="text-sm text-text-secondary my-2">
        <Inline parts={block.inline} />
      </p>
    );
  }
  const List = block.ordered ? "ol" : "ul";
  return (
    <List className={cn("pl-5 space-y-1 text-sm text-text-secondary my-2", block.ordered ? "list-decimal" : "list-disc")}>
      {block.items.map((item, i) => (
        <li key={i}>
          <Inline parts={item} />
        </li>
      ))}
    </List>
  );
}

export function PolicyPreview({ text }: { text: string }) {
  const blocks = useMemo(() => parsePolicyMarkdown(text), [text]);
  return (
    <div data-testid="policy-preview">
      {blocks.map((b, i) => (
        <PreviewBlock key={i} block={b} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// URL list for the payment gateway review
// ---------------------------------------------------------------------------

export function policyUrls(storeBaseUrl: string): Array<{ kind: StorePolicyKind; title: string; url: string }> {
  return STORE_POLICY_KINDS.map((kind) => ({
    kind,
    title: STORE_POLICY_TITLES[kind],
    url: `${storeBaseUrl}/policies/${kind}`,
  }));
}

function PolicyUrlList({ storeBaseUrl, slug }: { storeBaseUrl: string; slug: string }) {
  const urls = policyUrls(storeBaseUrl);

  async function copy(text: string, what: string) {
    if (await copyText(text)) toast.success(`${what} copied`);
    else toast.error("Could not copy", "Select the text and copy it by hand.");
  }

  return (
    <div className="mb-5 rounded-lg border border-border-light p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="text-sm font-medium text-text-primary">Public links for Razorpay</p>
          <p className="text-xs text-text-tertiary">Each page has its own link. Paste these where the payment provider asks for your policy pages.</p>
        </div>
        <button
          type="button"
          className="btn-secondary shrink-0"
          onClick={() => copy(urls.map((u) => `${u.title}: ${u.url}`).join("\n"), "All five links")}
        >
          Copy all links
        </button>
      </div>
      <ul className="divide-y divide-border-light">
        {urls.map((u) => (
          <li key={u.kind} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-text-primary">{u.title}</p>
              <a href={u.url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 hover:text-brand-700 break-all">
                {u.url}
              </a>
              <a
                href={apiUrl(`/store/${slug}/policies/${u.kind}`)}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 text-2xs text-text-tertiary hover:text-text-secondary"
              >
                plain page
              </a>
            </div>
            <button
              type="button"
              className="text-xs text-brand-600 hover:text-brand-700"
              aria-label={`Copy link for ${u.title}`}
              onClick={() => copy(u.url, `${u.title} link`)}
            >
              Copy
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One page's editor
// ---------------------------------------------------------------------------

interface EditorPolicy {
  kind: StorePolicyKind;
  title: string;
  template: string;
  content: string | null;
  isCustom: boolean;
  updatedAt: string | null;
}

function PolicyEditor({
  policy,
  variables,
  publicUrl,
}: {
  policy: EditorPolicy;
  variables: StorePolicyVariables;
  publicUrl: string | null;
}) {
  const utils = trpc.useUtils();
  const saved = policy.content ?? policy.template;
  const [draft, setDraft] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const text = draft ?? saved;
  const dirty = draft !== null && draft !== saved;

  const save = trpc.store.updatePolicy.useMutation({
    onSuccess: () => {
      toast.success(`${policy.title} saved`);
      setDraft(null);
      utils.store.getPolicies.invalidate();
    },
    onError: (err) => toast.error("Could not save the page", err.message),
  });
  const reset = trpc.store.resetPolicy.useMutation({
    onSuccess: () => {
      toast.success(`${policy.title} is back to the template`);
      setDraft(null);
      utils.store.getPolicies.invalidate();
    },
    onError: (err) => toast.error("Could not reset the page", err.message),
  });

  const preview = useMemo(() => fillPolicyPlaceholders(text, variables), [text, variables]);
  const tooLong = text.length > STORE_POLICY_MAX_LENGTH;
  const status = policy.isCustom
    ? `Edited${policy.updatedAt ? ` on ${formatDate(policy.updatedAt)}` : ""}`
    : "Using the template, filled from your business details";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-xs text-text-tertiary" data-testid="policy-status">{status}</p>
        {publicUrl && (
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 hover:text-brand-700">
            View public page
          </a>
        )}
      </div>

      <div className="flex gap-2 mb-2" role="group" aria-label="Editor view">
        <button type="button" className={cn("text-xs px-2.5 py-1 rounded-md", !showPreview ? "bg-surface-2 text-text-primary font-medium" : "text-text-tertiary")} aria-pressed={!showPreview} onClick={() => setShowPreview(false)}>
          Edit
        </button>
        <button type="button" className={cn("text-xs px-2.5 py-1 rounded-md", showPreview ? "bg-surface-2 text-text-primary font-medium" : "text-text-tertiary")} aria-pressed={showPreview} onClick={() => setShowPreview(true)}>
          Preview
        </button>
      </div>

      {showPreview ? (
        <div className="rounded-lg border border-border-light p-4 max-h-[28rem] overflow-y-auto">
          <h3 className="text-base font-semibold text-text-primary mb-1">{policy.title}</h3>
          <PolicyPreview text={preview} />
        </div>
      ) : (
        <>
          <label className="label" htmlFor={`policy-${policy.kind}`}>{policy.title} text</label>
          <textarea
            id={`policy-${policy.kind}`}
            className="input font-mono text-xs leading-relaxed w-full"
            rows={16}
            value={text}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck
          />
          <p className="text-2xs text-text-tertiary mt-1">
            Plain text with simple formatting: <code>## Heading</code>, <code>- list item</code>, <code>**bold**</code>, <code>[link](https://…)</code>. HTML is not allowed and is shown as text.
            Placeholders fill in automatically:{" "}
            {STORE_POLICY_PLACEHOLDERS.map((p) => `{{${p.key}}}`).join(", ")}.
          </p>
          {tooLong && <p className="text-2xs text-red-600 mt-1">Too long: keep it under {STORE_POLICY_MAX_LENGTH.toLocaleString("en-IN")} characters.</p>}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          type="button"
          className="btn-primary"
          disabled={!dirty || tooLong || !text.trim() || save.isPending}
          onClick={() => save.mutate({ kind: policy.kind, content: text })}
        >
          {save.isPending ? "Saving…" : "Save page"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={(!policy.isCustom && draft === null) || reset.isPending}
          onClick={() => {
            if (policy.isCustom) reset.mutate({ kind: policy.kind });
            else setDraft(null);
          }}
        >
          Reset to template
        </button>
        <button
          type="button"
          className="text-xs text-brand-600 hover:text-brand-700"
          title="Replace the placeholders with your current business details so you can edit them as plain text. They will no longer update if your details change."
          onClick={() => setDraft(preview)}
          disabled={preview === text}
        >
          Fill in my details
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function StorePoliciesCard({ storeBaseUrl }: { storeBaseUrl: string | null }) {
  const { data, isLoading } = trpc.store.getPolicies.useQuery();
  const [active, setActive] = useState<StorePolicyKind>("terms");

  if (isLoading || !data) {
    return (
      <div className="card p-6 mt-6" aria-busy="true">
        <div className="skeleton h-5 w-36 mb-4" />
        <div className="skeleton h-40 w-full" />
      </div>
    );
  }

  const policy = data.policies.find((p) => p.kind === active)!;
  const publicUrl = storeBaseUrl ? `${storeBaseUrl}/policies/${active}` : null;

  return (
    <div className="card p-6 mt-6">
      <h3 className="text-sm font-semibold text-text-primary mb-1">Policy pages</h3>
      <p className="text-xs text-text-tertiary mb-4">
        Payment providers such as Razorpay check that a store has these five pages before approving online payments. They are linked in your store footer and at checkout.
        Each page starts as a template filled from your business details; edit it to fit how you work. The templates are plain-language starting points, not legal advice.
      </p>

      {storeBaseUrl && data.storeSlug ? (
        <PolicyUrlList storeBaseUrl={storeBaseUrl} slug={data.storeSlug} />
      ) : (
        <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">
          Choose a store URL and switch the store on to get public links for these pages.
        </p>
      )}

      <div role="tablist" aria-label="Policy pages" className="flex flex-wrap gap-1.5 mb-4">
        {STORE_POLICY_KINDS.map((kind) => {
          const p = data.policies.find((x) => x.kind === kind)!;
          return (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={active === kind}
              className={cn(
                "text-xs px-3 py-1.5 rounded-lg border transition-colors",
                active === kind
                  ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300 font-medium"
                  : "border-border-light text-text-secondary hover:bg-surface-1",
              )}
              onClick={() => setActive(kind)}
            >
              {STORE_POLICY_SHORT_TITLES[kind]}
              {p.isCustom && <span className="ml-1.5 text-2xs text-text-tertiary">edited</span>}
            </button>
          );
        })}
      </div>

      {/* key: switching pages starts a fresh draft */}
      <PolicyEditor key={active} policy={policy} variables={data.variables} publicUrl={publicUrl} />
    </div>
  );
}
