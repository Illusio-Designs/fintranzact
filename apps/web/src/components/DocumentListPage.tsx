import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { invalidateStockViews } from "@/lib/stock-cache";
import { formatCurrency, formatDate, cn, getDocumentTypeLabel } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { usePageSearch } from "@/lib/page-search";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PillTabs } from "@/components/ui/Tabs";
import { SegmentedControl } from "@/components/ui/Tabs";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SlideOver } from "@/components/ui/SlideOver";
import { ShareLinkSection } from "@/components/ShareLinkSection";
import { DocumentCreator, type DocumentType } from "@/components/DocumentCreator";
import { ConvertDocumentDialog, type ConvertTarget } from "@/components/ConvertDocumentDialog";
import { ReturnRejectedDialog } from "@/components/ReturnRejectedDialog";
import { formatQty } from "@/components/inventory/shared";
import { toast } from "@/hooks/useToast";

import { Icon, type IconSvgElement } from "@/components/ui/Icon";
// ── Types ─────────────────────────────────────────────────────────

interface Tab {
  value: string;
  label: string;
}

export type TrpcRouterKey =
  | "quotation"
  | "proforma"
  | "deliveryChallan"
  | "salesReturn"
  | "purchaseReturn"
  | "creditNote"
  | "salesOrder"
  | "purchaseOrder"
  | "goodsReceiptNote";

/** List page of each document type, for links to a referenced document. */
const DOCUMENT_PAGES: Record<string, string> = {
  invoice: "/invoices",
  quotation: "/quotations",
  proforma: "/proforma-invoices",
  delivery_challan: "/delivery-challans",
  sales_order: "/sales-orders",
  purchase_order: "/purchase-orders",
  goods_receipt_note: "/goods-receipt-notes",
  sales_return: "/sales-returns",
  purchase_return: "/purchase-returns",
};

/** Status tabs with these values filter on how much is still pending. */
const FULFILMENT_FILTERS = ["open", "partial", "fulfilled", "closed"];

export interface ConvertConfig {
  /** The id of the document currently being converted (null if none) */
  convertingId: string | null;
  /** What it can be converted into (an invoice when not given). */
  targets?: ConvertTarget[];
  onConvert: (id: string, target: DocumentType) => void;
}

export interface DocumentListPageConfig {
  /** tRPC router namespace — must match the key on the trpc object */
  trpcRouter: TrpcRouterKey;
  /** DocumentCreator's documentType prop */
  documentType: DocumentType;
  /**
   * Fixed invoiceType for routes with no type toggle (quotations, proforma,
   * sales-returns, purchase-returns). Ignored when hasTypeFilter is true.
   */
  defaultInvoiceType?: "sale" | "purchase";
  /** Show the sale/purchase SegmentedControl (delivery-challans, credit-notes) */
  hasTypeFilter?: boolean;

  // PageHeader
  title: string;
  description: string;
  /** Label for the "create" button, e.g. "+ New Challan" */
  buttonLabel: string;

  // Status pill-tabs
  statusTabs: Tab[];

  // Empty state copy
  emptyTitle: string;
  /**
   * Receives current type and status filter; returns the description string.
   * Use it to compose contextual copy like "No sales delivery challans with status 'draft'."
   */
  emptyDescription: (type: "sale" | "purchase", status: string) => string;
  /** SVG path d-value for the empty-state icon */
  /** Hugeicon shown in the empty state. */
  emptyIcon: IconSvgElement;

  // Table column 2
  /** Column 2 header label, e.g. "Challan #", "Quotation #" */
  col2Header: string;
  /**
   * Column 4 variant:
   * - "dueDate"    — shows doc.dueDate (delivery-challans, quotations, proforma)
   * - "refInvoice" — shows a "Linked" badge from doc.referenceDocumentId
   *                  (sales-returns, purchase-returns, credit-notes)
   */
  col4Variant: "dueDate" | "refInvoice";
  /** Column 4 header label */
  col4Header: string;

  // Row-level actions
  /** Show "Mark Sent" button when doc.status === "draft" */
  markSent?: boolean;
  /** Show "Mark Paid" button when doc.status === "sent" (credit-notes only) */
  markPaid?: boolean;
  /**
   * Issued documents can be cancelled from their panel. Cancelling gives back
   * any stock they moved and, for a note or return, what it took off its
   * invoice.
   */
  cancellable?: boolean;
  /**
   * When provided, a "Convert to Invoice" button is shown for every row.
   * Pass a ConvertConfig from the route wrapper that owns the convert mutation.
   */
  convert?: ConvertConfig;
  /**
   * Orders, challans and GRNs: show what is still pending, convert all or
   * part of it into these document types, and short-close.
   */
  fulfilment?: {
    convertTo: ConvertTarget[];
    /** Labels for open / partial / fulfilled / closed, e.g. "Unbilled" on a challan. */
    labels?: Partial<Record<"open" | "partial" | "fulfilled" | "closed", string>>;
  };
}

// ── Component ─────────────────────────────────────────────────────

const typeOptions = [
  { value: "sale", label: "Sales" },
  { value: "purchase", label: "Purchases" },
];

interface DocumentListPageProps {
  config: DocumentListPageConfig;
  initialSelectedId?: string;
}

export function DocumentListPage({ config, initialSelectedId }: DocumentListPageProps) {
  const {
    trpcRouter,
    documentType,
    defaultInvoiceType = "sale",
    hasTypeFilter = false,
    title,
    description,
    buttonLabel,
    statusTabs,
    emptyTitle,
    emptyDescription,
    emptyIcon,
    col2Header,
    col4Variant,
    col4Header,
    markSent = false,
    markPaid = false,
    cancellable = false,
    convert,
    fulfilment,
  } = config;

  const [type, setType] = useState<"sale" | "purchase">(
    hasTypeFilter ? "sale" : defaultInvoiceType
  );
  const [status, setStatus] = useState("");
  const [search] = usePageSearch(`Search ${title.toLowerCase()} by party or number…`);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteNumber, setDeleteNumber] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [editId, setEditId] = useState<string | undefined>(undefined);
  const [convertId, setConvertId] = useState<string | null>(null);
  const [cancelDoc, setCancelDoc] = useState<{ id: string; number: string } | null>(null);
  const convertTargets: ConvertTarget[] = convert?.targets ?? [{ type: "invoice", label: "Invoice" }];
  // GRN whose rejected goods are going back on a purchase return / debit note.
  const [returnRejectedId, setReturnRejectedId] = useState<string | null>(null);

  // Auto-open slider when navigated with ?id= param
  useEffect(() => {
    if (initialSelectedId) setSelectedId(initialSelectedId);
  }, [initialSelectedId]);

  const utils = trpc.useUtils();

  // Because trpc is typed as `any` (see lib/trpc.ts), dynamic key access is safe.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = (trpc as any)[trpcRouter];

  const { data: selectedDoc } = trpc.invoice.getById.useQuery(
    { id: selectedId! },
    { enabled: !!selectedId }
  );

  // Resolve reference invoice number for clickable link
  const refDocId = selectedDoc?.referenceDocumentId ?? "";
  const { data: refDoc } = trpc.invoice.getById.useQuery(
    { id: refDocId },
    { enabled: !!refDocId }
  );

  const { data: selectedFulfilment } = trpc.orders.fulfilment.useQuery(
    { id: selectedId! },
    { enabled: !!selectedId && !!fulfilment },
  );

  const byFulfilment = !!fulfilment && FULFILMENT_FILTERS.includes(status);
  const { data, isLoading } = router.list.useQuery({
    type,
    status: (status && !byFulfilment ? status : undefined) as never,
    fulfilment: byFulfilment ? status : undefined,
    search: search.trim() || undefined,
    page: 1,
    limit: 50,
  });

  const updateStatus = router.updateStatus.useMutation({
    onSuccess: (_: unknown, vars: { id: string; status: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any)[trpcRouter].list.invalidate();
      // This document's panel; and a cancelled return or note changes its
      // invoice, the stock and the party's balance.
      utils.invoice.invalidate();
      void invalidateStockViews(utils);
      utils.party.invalidate();
      utils.orders.invalidate();
      if (vars.status === "cancelled") setCancelDoc(null);
      toast.success(vars.status === "cancelled" ? "Cancelled" : "Status updated");
    },
    onError: (err: { message: string }) =>
      toast.error("Failed to update status", err.message),
  });

  const deleteMutation = router.delete.useMutation({
    onSuccess: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any)[trpcRouter].list.invalidate();
      // Deleting a document puts back the stock it moved.
      void invalidateStockViews(utils);
      utils.party.invalidate();
      toast.success(`Deleted successfully`);
      setDeleteId(null);
    },
    onError: (err: { message: string }) => {
      toast.error("Failed to delete", err.message);
      setDeleteId(null);
    },
  });

  const closeMutation = trpc.orders.close.useMutation({
    onSuccess: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any)[trpcRouter].list.invalidate();
      utils.orders.invalidate();
      toast.success("Closed — nothing more is expected against it");
    },
    onError: (err) => toast.error("Failed to close", err.message),
  });
  const reopenMutation = trpc.orders.reopen.useMutation({
    onSuccess: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (utils as any)[trpcRouter].list.invalidate();
      utils.orders.invalidate();
      toast.success("Reopened");
    },
    onError: (err) => toast.error("Failed to reopen", err.message),
  });

  function fulfilmentLabel(s: string) {
    const key = s as "open" | "partial" | "fulfilled" | "closed";
    return fulfilment?.labels?.[key] ?? s.charAt(0).toUpperCase() + s.slice(1);
  }

  function confirmDelete(id: string, number: string) {
    setDeleteId(id);
    setDeleteNumber(number);
  }

  // Singular form for dialog copy: strip trailing "s" for simple plurals
  const singular = title.replace(/s$/, "");

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            {buttonLabel}
          </button>
        }
      />

      <div className="rounded-2xl border border-border-light bg-surface-0 overflow-hidden">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border-light px-4 py-3">
          {hasTypeFilter && (
            <SegmentedControl
              tabs={typeOptions}
              value={type}
              onChange={(v) => setType(v as "sale" | "purchase")}
            />
          )}
          <div className={hasTypeFilter ? "ml-auto" : undefined}>
            <PillTabs tabs={statusTabs} value={status} onChange={setStatus} />
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-14 rounded-lg" />
            ))}
          </div>
        ) : !data?.data.length ? (
          <EmptyState
            icon={<Icon icon={emptyIcon} size={26} />}
            title={emptyTitle}
            description={search ? `Nothing matches "${search}".` : emptyDescription(type, status)}
            action={
              search ? undefined : (
                <button className="btn-primary" onClick={() => setShowCreate(true)}>
                  {buttonLabel}
                </button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Party</th>
                  <th>{col2Header}</th>
                  <th>Date</th>
                  <th>{col4Header}</th>
                  <th>Status</th>
                  {fulfilment && <th>Pending</th>}
                  <th className="text-right">Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {data.data.map((doc: any) => (
                  <tr key={doc.id} className="group cursor-pointer" onClick={() => setSelectedId(doc.id)}>
                    <td className="font-medium">{doc.partyName}</td>
                    <td className="font-mono text-[13px] text-text-secondary">
                      {doc.invoiceNumber}
                    </td>
                    <td className="text-text-secondary">
                      {formatDate(doc.invoiceDate)}
                    </td>
                    <td className="text-text-secondary">
                      {col4Variant === "dueDate" ? (
                        doc.dueDate ? (
                          formatDate(doc.dueDate)
                        ) : (
                          "—"
                        )
                      ) : doc.referenceDocumentId ? (
                        <span className="font-mono text-[13px] text-brand-600">
                          Linked
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <StatusBadge status={doc.status} size="sm" />
                    </td>
                    {fulfilment && (
                      <td>
                        {doc.fulfilmentStatus && doc.fulfilmentStatus !== "cancelled" ? (
                          <StatusBadge status={doc.fulfilmentStatus} label={fulfilmentLabel(doc.fulfilmentStatus)} size="sm" />
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                    <td className="text-right tabular-nums font-medium">
                      {formatCurrency(doc.totalAmount)}
                    </td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {markSent && doc.status === "draft" && (
                          <button
                            onClick={() =>
                              updateStatus.mutate({ id: doc.id, status: "sent" })
                            }
                            className="text-xs px-2 py-1 rounded font-medium text-text-secondary hover:bg-surface-2 transition-colors"
                          >
                            Mark Sent
                          </button>
                        )}
                        {markPaid && doc.status === "sent" && (
                          <button
                            onClick={() =>
                              updateStatus.mutate({ id: doc.id, status: "paid" })
                            }
                            className="text-xs px-2 py-1 rounded font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-colors"
                          >
                            Mark Paid
                          </button>
                        )}
                        {convert && doc.status !== "cancelled" && convertTargets.map((t) => (
                          <button
                            key={t.type}
                            onClick={() => convert.onConvert(doc.id, t.type)}
                            disabled={convert.convertingId === doc.id}
                            className="text-xs px-2 py-1 rounded font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950 transition-colors disabled:opacity-50"
                          >
                            {convert.convertingId === doc.id
                              ? "Converting…"
                              : `Convert to ${t.label}`}
                          </button>
                        ))}
                        {fulfilment && (doc.fulfilmentStatus === "open" || doc.fulfilmentStatus === "partial") && (
                          <button
                            onClick={() => setConvertId(doc.id)}
                            className="text-xs px-2 py-1 rounded font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950 transition-colors"
                          >
                            Convert
                          </button>
                        )}
                        {doc.status === "draft" && (
                          <button
                            onClick={() =>
                              confirmDelete(doc.id, doc.invoiceNumber)
                            }
                            className="text-xs px-2 py-1 rounded font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Document detail slide-over */}
      <SlideOver
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        title={selectedDoc ? selectedDoc.invoiceNumber : "Loading…"}
        description={selectedDoc ? `${selectedDoc.party?.name ?? ""} — ${formatDate(selectedDoc.invoiceDate)}` : undefined}
        footer={
          selectedDoc ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex gap-2">
                {selectedDoc.status === "draft" && (
                  <button
                    onClick={() => {
                      setSelectedId(null);
                      confirmDelete(selectedDoc.id, selectedDoc.invoiceNumber);
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 border border-red-200 dark:border-red-800 transition-colors"
                  >
                    Delete
                  </button>
                )}
                {cancellable && selectedDoc.status !== "draft" && selectedDoc.status !== "cancelled" && (
                  <button
                    onClick={() => setCancelDoc({ id: selectedDoc.id, number: selectedDoc.invoiceNumber })}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 border border-red-200 dark:border-red-800 transition-colors"
                  >
                    Cancel {singular}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                {fulfilment && selectedFulfilment && selectedDoc.status !== "cancelled" && (
                  selectedFulfilment.closedAt ? (
                    <button
                      onClick={() => reopenMutation.mutate({ id: selectedDoc.id })}
                      disabled={reopenMutation.isPending}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors disabled:opacity-50"
                    >
                      Reopen
                    </button>
                  ) : selectedFulfilment.status !== "fulfilled" && (
                    <button
                      onClick={() => closeMutation.mutate({ id: selectedDoc.id })}
                      disabled={closeMutation.isPending}
                      title="Nothing more is expected against it, whatever is still pending"
                      className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors disabled:opacity-50"
                    >
                      Short-close
                    </button>
                  )
                )}
                {fulfilment && (selectedFulfilment?.status === "open" || selectedFulfilment?.status === "partial") && (
                  <button
                    onClick={() => setConvertId(selectedDoc.id)}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors"
                  >
                    Convert
                  </button>
                )}
                {markSent && selectedDoc.status === "draft" && (
                  <button
                    onClick={() => updateStatus.mutate({ id: selectedDoc.id, status: "sent" })}
                    disabled={updateStatus.isPending}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors disabled:opacity-50"
                  >
                    Mark Sent
                  </button>
                )}
                {convert && selectedDoc.status !== "cancelled" && convertTargets.map((t) => (
                  <button
                    key={t.type}
                    onClick={() => convert.onConvert(selectedDoc.id, t.type)}
                    disabled={convert.convertingId === selectedDoc.id}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors disabled:opacity-50"
                  >
                    {convert.convertingId === selectedDoc.id ? "Converting…" : `Convert to ${t.label}`}
                  </button>
                ))}
                {selectedDoc.status === "draft" && (
                  <button
                    onClick={() => {
                      setSelectedId(null);
                      setEditId(selectedDoc.id);
                      setShowCreate(true);
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors"
                  >
                    Edit
                  </button>
                )}
              </div>
            </div>
          ) : null
        }
      >
        {!selectedDoc ? (
          <div className="space-y-3 animate-pulse">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 bg-surface-2 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            {/* Header info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-1">Party</p>
                  <p className="font-semibold text-text-primary">{selectedDoc.party?.name ?? "—"}</p>
                  {selectedDoc.party?.phone && (
                    <p className="text-xs text-text-tertiary">{selectedDoc.party.phone}</p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-1">Status</p>
                  <StatusBadge status={selectedDoc.status} size="sm" />
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-1">Date</p>
                  <p className="text-sm text-text-primary">{formatDate(selectedDoc.invoiceDate)}</p>
                </div>
                {selectedDoc.dueDate && (
                  <div>
                    <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-1">Due Date</p>
                    <p className="text-sm text-text-primary">{formatDate(selectedDoc.dueDate)}</p>
                  </div>
                )}
                {selectedDoc.referenceDocumentId && (
                  <div>
                    <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-1">
                      {refDoc && refDoc.documentType !== "invoice" ? `Made from ${getDocumentTypeLabel(refDoc.documentType)}` : "Reference Invoice"}
                    </p>
                    <button
                      onClick={() => {
                        setSelectedId(null);
                        const page = (refDoc && DOCUMENT_PAGES[refDoc.documentType]) || "/invoices";
                        window.location.href = `${page}?id=${selectedDoc.referenceDocumentId}`;
                      }}
                      className="text-sm font-mono text-brand-600 hover:text-brand-700 hover:underline"
                    >
                      {refDoc?.invoiceNumber ?? "Loading…"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* What is still pending, and what was made from it */}
            {fulfilment && selectedFulfilment && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide">Fulfilment</p>
                  {selectedFulfilment.status !== "cancelled" && (
                    <StatusBadge status={selectedFulfilment.status} label={fulfilmentLabel(selectedFulfilment.status)} size="sm" />
                  )}
                </div>
                <div className="overflow-hidden rounded-xl border border-border-light">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-surface-1 border-b border-border-light">
                        <th className="px-3 py-2 text-left font-medium text-text-tertiary">Item</th>
                        <th className="px-3 py-2 text-right font-medium text-text-tertiary">Ordered</th>
                        <th className="px-3 py-2 text-right font-medium text-text-tertiary">Done</th>
                        <th className="px-3 py-2 text-right font-medium text-text-tertiary">Pending</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-light">
                      {selectedFulfilment.lines.map((l) => (
                        <tr key={l.lineId}>
                          <td className="px-3 py-2 text-text-primary">
                            {l.itemName}
                            {l.rejected > 0 && (
                              <span className="block text-[11px] text-amber-600">{formatQty(l.rejected)} rejected</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                            {formatQty(l.ordered, l.selectedUnit)}
                            {l.freeOrdered > 0 && <span className="block text-[11px]">+ {formatQty(l.freeOrdered)} free</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                            {formatQty(l.fulfilled)}
                            {l.freeFulfilled > 0 && <span className="block text-[11px]">+ {formatQty(l.freeFulfilled)} free</span>}
                          </td>
                          <td className={cn("px-3 py-2 text-right tabular-nums font-medium", l.pending > 0 || l.freePending > 0 ? "text-amber-600" : "text-text-tertiary")}>
                            {formatQty(l.pending)}
                            {l.freePending > 0 && <span className="block text-[11px] font-normal">+ {formatQty(l.freePending)} free</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {selectedFulfilment.rejections.length > 0 && (
                  <div data-testid="grn-rejections" className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs dark:border-amber-900 dark:bg-amber-950/30">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-amber-800 dark:text-amber-300">Rejected on receipt</p>
                      {selectedDoc.status !== "cancelled" && selectedFulfilment.rejections.some((r) => r.open > 0) && (
                        <button
                          type="button"
                          onClick={() => setReturnRejectedId(selectedDoc.id)}
                          className="text-xs px-2.5 py-1 rounded-lg font-medium text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                        >
                          Return rejected goods
                        </button>
                      )}
                    </div>
                    <ul className="mt-1 space-y-0.5 text-amber-900 dark:text-amber-200">
                      {selectedFulfilment.rejections.map((r) => (
                        <li key={r.lineId}>
                          {r.itemName}: {formatQty(r.rejected, r.selectedUnit)}{r.reason ? ` (${r.reason})` : ""}
                          {r.returned > 0 && ` · ${formatQty(r.returned)} returned`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {selectedFulfilment.linkedDocuments.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {selectedFulfilment.linkedDocuments.map((d) => (
                      <li key={d.id} className="flex items-center justify-between text-xs">
                        <span className="text-text-secondary">
                          {getDocumentTypeLabel(d.documentType)}{" "}
                          <span className="font-mono text-text-primary">{d.invoiceNumber}</span>
                          {" · "}
                          {formatDate(d.invoiceDate)}
                        </span>
                        <StatusBadge status={d.status} size="sm" />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Line items */}
            <div>
              <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-2">Items</p>
              <div className={cn("overflow-hidden rounded-xl border border-border-light")}>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-1 border-b border-border-light">
                      <th className="px-3 py-2 text-left font-medium text-text-tertiary">Item</th>
                      <th className="px-3 py-2 text-right font-medium text-text-tertiary">Qty</th>
                      <th className="px-3 py-2 text-right font-medium text-text-tertiary">Price</th>
                      <th className="px-3 py-2 text-right font-medium text-text-tertiary">Tax%</th>
                      <th className="px-3 py-2 text-right font-medium text-text-tertiary">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {selectedDoc.lineItems.map((li: any) => (
                      <tr key={li.id}>
                        <td className="px-3 py-2">
                          <p className="font-medium text-text-primary">{li.itemName}</p>
                          {li.description && (
                            <p className="text-[11px] italic text-text-secondary mt-0.5">{li.description}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                          {li.quantity}
                          {parseFloat(li.freeQuantity ?? "0") > 0 && (
                            <span className="block text-[11px] text-emerald-700 dark:text-emerald-400">+ {parseFloat(li.freeQuantity)} free</span>
                          )}
                          {parseFloat(li.rejectedQuantity ?? "0") > 0 && (
                            <span className="block text-[11px] text-amber-600" title={li.rejectionReason ?? undefined}>
                              {parseFloat(li.rejectedQuantity)} rejected{li.rejectionReason ? ` (${li.rejectionReason})` : ""}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{formatCurrency(li.unitPrice)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{li.taxPercent}%</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-text-primary">{formatCurrency(li.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-64 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Subtotal</span>
                  <span className="tabular-nums text-text-primary">{formatCurrency(selectedDoc.subtotal)}</span>
                </div>
                {parseFloat(selectedDoc.discountAmount) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Discount</span>
                    <span className="tabular-nums text-emerald-600">-{formatCurrency(selectedDoc.discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Tax</span>
                  <span className="tabular-nums text-text-primary">{formatCurrency(selectedDoc.taxAmount)}</span>
                </div>
                {parseFloat(selectedDoc.additionalCharges ?? "0") > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Additional Charges</span>
                    <span className="tabular-nums text-text-primary">{formatCurrency(selectedDoc.additionalCharges ?? "0")}</span>
                  </div>
                )}
                {parseFloat(selectedDoc.roundOff ?? "0") !== 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Round Off</span>
                    <span className="tabular-nums text-text-primary">{formatCurrency(selectedDoc.roundOff)}</span>
                  </div>
                )}
                <div className="pt-2 border-t border-border-light flex justify-between">
                  <span className="text-sm font-semibold text-text-primary">Total</span>
                  <span className="text-base font-bold tabular-nums text-text-primary">{formatCurrency(selectedDoc.totalAmount)}</span>
                </div>
              </div>
            </div>

            {selectedDoc.type === "sale" && (
              <ShareLinkSection
                documentId={selectedDoc.id}
                documentLabel={`${getDocumentTypeLabel(selectedDoc.documentType)} ${selectedDoc.invoiceNumber}`}
                partyPhone={selectedDoc.party?.phone}
              />
            )}

            {/* Notes & Terms */}
            {(selectedDoc.notes || selectedDoc.termsAndConditions) && (
              <div className="grid grid-cols-2 gap-4">
                {selectedDoc.notes && (
                  <div>
                    <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-1">Notes</p>
                    <p className="text-xs text-text-secondary whitespace-pre-wrap">{selectedDoc.notes}</p>
                  </div>
                )}
                {selectedDoc.termsAndConditions && (
                  <div>
                    <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-1">Terms &amp; Conditions</p>
                    <p className="text-xs text-text-secondary whitespace-pre-wrap">{selectedDoc.termsAndConditions}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </SlideOver>

      {/* Delete confirm dialog */}
      <ConfirmDialog
        open={!!deleteId}
        title={`Delete ${singular}`}
        description={`Delete ${singular.toLowerCase()} ${deleteNumber}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteId && deleteMutation.mutate({ id: deleteId })}
        onCancel={() => setDeleteId(null)}
      />

      <ConfirmDialog
        open={!!cancelDoc}
        title={`Cancel ${singular}`}
        description={`Cancel ${singular.toLowerCase()} ${cancelDoc?.number ?? ""}? It stays on record as cancelled; any stock it moved goes back, and a return or note no longer counts against its invoice.`}
        confirmLabel={`Cancel ${singular}`}
        cancelLabel="Keep it"
        variant="danger"
        loading={updateStatus.isPending}
        onConfirm={() => cancelDoc && updateStatus.mutate({ id: cancelDoc.id, status: "cancelled" })}
        onCancel={() => setCancelDoc(null)}
      />

      {/* Document creator */}
      {showCreate && (
        <DocumentCreator
          documentType={documentType}
          invoiceType={type}
          editInvoiceId={editId}
          onClose={() => {
            setShowCreate(false);
            setEditId(undefined);
          }}
        />
      )}

      {convertId && fulfilment && (
        <ConvertDocumentDialog
          sourceId={convertId}
          targets={fulfilment.convertTo}
          onClose={() => setConvertId(null)}
        />
      )}

      {returnRejectedId && (
        <ReturnRejectedDialog grnId={returnRejectedId} onClose={() => setReturnRejectedId(null)} />
      )}
    </div>
  );
}
