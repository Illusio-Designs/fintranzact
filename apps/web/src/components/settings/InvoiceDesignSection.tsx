/**
 * Settings → Documents → Invoice design: which of the printed designs the
 * business's A4 invoices use, the thermal roll width for POS receipts, and a
 * "Preview PDF" of the chosen design filled with sample lines.
 */
import { useState } from "react";
import {
  INVOICE_TEMPLATE_INFO,
  type InvoiceTemplate,
  type ThermalWidth,
} from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { openPdf } from "@/lib/open-pdf";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { InvoiceDesignThumbnail } from "./InvoiceDesignThumbnail";

interface Props {
  biz: { id: string; invoiceTemplate?: string | null; thermalWidth?: number | null };
}

export function InvoiceDesignSection({ biz }: Props) {
  const savedTemplate = (biz.invoiceTemplate ?? "classic") as InvoiceTemplate;
  const savedWidth = (biz.thermalWidth === 58 ? 58 : 80) as ThermalWidth;
  const [template, setTemplate] = useState<InvoiceTemplate>(savedTemplate);
  const [width, setWidth] = useState<ThermalWidth>(savedWidth);
  const [previewing, setPreviewing] = useState<"a4" | "thermal" | null>(null);
  const dirty = template !== savedTemplate || width !== savedWidth;

  const utils = trpc.useUtils();
  const save = trpc.business.update.useMutation({
    onSuccess: () => {
      toast.success("Invoice design saved");
      utils.business.list.invalidate();
    },
    onError: (err) => toast.error("Failed to save invoice design", err.message),
  });

  async function preview(kind: "a4" | "thermal") {
    setPreviewing(kind);
    try {
      const q = kind === "thermal" ? `format=thermal&width=${width}` : `template=${template}`;
      await openPdf(`/api/invoice-templates/preview?${q}`, `invoice-design-${kind === "thermal" ? `thermal-${width}` : template}.pdf`);
    } catch {
      toast.error("Could not open the preview");
    }
    setPreviewing(null);
  }

  return (
    <div className="card overflow-hidden" data-testid="invoice-design">
      <div className="px-4 sm:px-6 py-4 border-b border-border-light flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id="invoice-design-heading" className="text-sm font-semibold text-text-primary">Invoice design</h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            How your A4 invoices look when printed or downloaded. Bills of supply, export invoices and quotations always print in their own layout.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={() => preview("a4")} disabled={previewing !== null}>
            {previewing === "a4" ? "Opening…" : "Preview PDF"}
          </button>
          {dirty && (
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => save.mutate({ id: biz.id, data: { invoiceTemplate: template, thermalWidth: width } })}
              disabled={save.isPending}
            >
              {save.isPending ? "Saving…" : "Save invoice design"}
            </button>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-6">
        <div
          role="radiogroup"
          aria-labelledby="invoice-design-heading"
          className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3"
        >
          {INVOICE_TEMPLATE_INFO.map((t) => {
            const checked = template === t.id;
            const descId = `invoice-design-desc-${t.id}`;
            const nameId = `invoice-design-name-${t.id}`;
            return (
              <label
                key={t.id}
                className={cn(
                  "relative flex flex-col rounded-lg border bg-surface-1 cursor-pointer transition-colors min-w-0",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 has-[:focus-visible]:ring-offset-2",
                  checked ? "border-brand-600 ring-1 ring-brand-600" : "border-border-light hover:border-border",
                )}
              >
                <input
                  type="radio"
                  name="invoice-design"
                  value={t.id}
                  checked={checked}
                  onChange={() => setTemplate(t.id)}
                  aria-labelledby={nameId}
                  aria-describedby={descId}
                  className="sr-only"
                />
                <InvoiceDesignThumbnail template={t.id} />
                <span className="p-2.5 sm:p-3 flex flex-col gap-1 min-w-0">
                  <span className="flex items-start justify-between gap-2">
                    <span id={nameId} className="text-sm font-medium text-text-primary leading-tight">{t.name}</span>
                    {checked && <span className="text-2xs font-semibold uppercase tracking-wide text-brand-600 shrink-0">Selected</span>}
                  </span>
                  <span className="text-2xs text-text-tertiary">{t.size}{t.id === savedTemplate ? " · in use" : ""}</span>
                  <span id={descId} className="text-xs text-text-secondary line-clamp-3 sm:line-clamp-none">{t.description}</span>
                </span>
              </label>
            );
          })}
        </div>

        <fieldset className="border-t border-border-light pt-5">
          <legend className="float-left w-full text-sm font-medium text-text-primary">Thermal receipt width</legend>
          <p className="clear-left text-xs text-text-tertiary pt-0.5 mb-3">
            Point-of-Sale and thermal receipts print on this roll: 58 mm fits about 32 characters a line, 80 mm about 48.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {([58, 80] as const).map((w) => (
              <label
                key={w}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer",
                  width === w ? "border-brand-600 text-text-primary" : "border-border-light text-text-secondary",
                )}
              >
                <input type="radio" name="thermal-width" value={w} checked={width === w} onChange={() => setWidth(w)} className="accent-brand-600" />
                {w} mm
              </label>
            ))}
            <button type="button" className="btn-ghost btn-sm" onClick={() => preview("thermal")} disabled={previewing !== null}>
              {previewing === "thermal" ? "Opening…" : "Preview receipt"}
            </button>
          </div>
        </fieldset>
      </div>
    </div>
  );
}
