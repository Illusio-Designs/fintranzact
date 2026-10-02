/**
 * "Share link" block for a document's detail panel: make a public link the
 * customer can open without signing in, copy it, send it on WhatsApp, see
 * how often it was opened, and turn it off.
 */
import { useState } from "react";
import { Copy01Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface ShareLinkSectionProps {
  documentId: string;
  /** e.g. "Invoice INV-001", used in the WhatsApp message. */
  documentLabel: string;
  /** The customer's phone, to open WhatsApp straight to their chat. */
  partyPhone?: string | null;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** wa.me wants the number in international form with digits only. */
function whatsappNumber(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits.length >= 11 ? digits : "";
}

export function ShareLinkSection({ documentId, documentLabel, partyPhone }: ShareLinkSectionProps) {
  const utils = trpc.useUtils();
  const [confirmOff, setConfirmOff] = useState(false);
  const { data: link, isLoading } = trpc.share.get.useQuery({ documentId });

  const create = trpc.share.create.useMutation({
    onSuccess: async (made) => {
      utils.share.get.setData({ documentId }, made);
      toast.success((await copyText(made.url)) ? "Link copied" : "Link ready");
    },
    onError: (err) => toast.error("Could not make a link", err.message),
  });

  const revoke = trpc.share.revoke.useMutation({
    onSuccess: () => {
      utils.share.get.setData({ documentId }, null);
      setConfirmOff(false);
      toast.success("Link turned off", "The old link no longer opens this document.");
    },
    onError: (err) => toast.error("Could not turn off the link", err.message),
  });

  if (isLoading) return null;

  const message = link ? `${documentLabel}: ${link.url}` : "";
  const wa = link ? `https://wa.me/${whatsappNumber(partyPhone)}?text=${encodeURIComponent(message)}` : "";

  return (
    <div data-testid="share-link-section">
      <p className="text-2xs font-medium text-text-tertiary uppercase tracking-wide mb-2">Share link</p>
      {!link ? (
        <div className="card p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-text-secondary">
            Anyone with the link can view it, pay and download the PDF — no sign-in.
          </p>
          <button
            onClick={() => create.mutate({ documentId })}
            disabled={create.isPending}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950 border border-brand-200 dark:border-brand-800 transition-colors disabled:opacity-50"
          >
            <Icon icon={Link01Icon} size={14} />
            Get link
          </button>
        </div>
      ) : (
        <div className="card p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={link.url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Share link"
              className="input flex-1 min-w-0 text-xs font-mono"
            />
            <button
              onClick={async () =>
                (await copyText(link.url)) ? toast.success("Link copied") : toast.error("Could not copy the link")
              }
              className="shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors"
            >
              <Icon icon={Copy01Icon} size={14} />
              Copy
            </button>
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 transition-colors"
            >
              WhatsApp
            </a>
          </div>
          <div className="flex items-center justify-between text-2xs text-text-tertiary">
            <span>
              {link.viewCount === 0
                ? "Not opened yet"
                : `Opened ${link.viewCount} ${link.viewCount === 1 ? "time" : "times"}${
                    link.lastViewedAt ? `, last on ${formatDate(link.lastViewedAt)}` : ""
                  }`}
            </span>
            <button onClick={() => setConfirmOff(true)} className="font-medium text-red-600 hover:underline">
              Turn off link
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOff}
        onCancel={() => setConfirmOff(false)}
        onConfirm={() => revoke.mutate({ documentId })}
        title="Turn off this link?"
        description="Anyone who has it will no longer be able to open the document. You can make a new link later."
        confirmLabel="Turn off"
        variant="danger"
        loading={revoke.isPending}
      />
    </div>
  );
}
