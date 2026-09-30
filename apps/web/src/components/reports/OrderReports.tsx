/**
 * Pending order reports: sales orders not yet delivered, purchase orders not
 * yet received, GRNs not yet billed and delivery challans not yet billed.
 * Rendered from the Reports page; all four read orders.pending.
 */
import { useState } from "react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { cn, downloadCSV, formatCurrency, formatDate } from "@/lib/utils";
import { PartyCombobox } from "@/components/ui/PartyCombobox";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { formatQty } from "@/components/inventory/shared";
import { ExportButton, LoadError, Loading, ReportTable } from "@/components/reports/InventoryReports";

type PendingKind = "sales_order" | "purchase_order" | "goods_receipt_note" | "delivery_challan";

const COPY: Record<PendingKind, {
  file: string;
  what: string;
  number: string;
  done: string;
  partyType: "customer" | "supplier";
  due: boolean;
  empty: string;
}> = {
  sales_order: {
    file: "pending-sales-orders",
    what: "pending sales orders",
    number: "Order #",
    done: "Delivered",
    partyType: "customer",
    due: true,
    empty: "Every sales order has been delivered or closed.",
  },
  purchase_order: {
    file: "pending-purchase-orders",
    what: "pending purchase orders",
    number: "PO #",
    done: "Received",
    partyType: "supplier",
    due: true,
    empty: "Every purchase order has been received or closed.",
  },
  goods_receipt_note: {
    file: "pending-grns",
    what: "pending GRNs",
    number: "GRN #",
    done: "Billed",
    partyType: "supplier",
    due: false,
    empty: "Every goods receipt has been billed.",
  },
  delivery_challan: {
    file: "pending-delivery-challans",
    what: "pending delivery challans",
    number: "Challan #",
    done: "Billed",
    partyType: "customer",
    due: false,
    empty: "Every delivery challan has been billed.",
  },
};

function PendingReport({ kind }: { kind: PendingKind }) {
  const copy = COPY[kind];
  const [partyId, setPartyId] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const { data, isLoading, error } = trpc.orders.pending.useQuery({
    documentType: kind,
    partyId: partyId || undefined,
    overdueOnly,
  });

  return (
    <div>
      <div className="flex items-end gap-3 mb-4 flex-wrap">
        <div className="w-64">
          <PartyCombobox value={partyId} onChange={setPartyId} partyType={copy.partyType} label="" placeholder="All parties" />
        </div>
        {partyId && (
          <button className="text-xs text-text-tertiary hover:text-text-primary pb-2" onClick={() => setPartyId("")}>
            Clear
          </button>
        )}
        {copy.due && (
          <label className="flex items-center gap-2 text-xs text-text-secondary pb-2">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
            Past delivery date only
          </label>
        )}
        {data && data.data.length > 0 && (
          <p className="text-xs text-text-tertiary pb-2">
            {data.totals.documents} documents, <span className="font-semibold text-text-primary">{formatCurrency(data.totals.value)}</span> pending before tax
          </p>
        )}
        {data && data.data.length > 0 && (
          <div className="ml-auto">
            <ExportButton onClick={() => downloadCSV(
              copy.file,
              ["Date", "Number", "Party", "Item", "Ordered", copy.done, "Pending", "Pending free", "Rejected", "Unit", "Rate", "Pending value", ...(copy.due ? ["Delivery by"] : [])],
              data.data.map((r) => [
                formatDate(r.documentDate), r.documentNumber, r.partyName, r.itemName,
                r.ordered, r.fulfilled, r.pending, r.freePending, r.rejected, r.unit ?? "", r.rate, r.pendingValue,
                ...(copy.due ? [r.dueDate ? formatDate(r.dueDate) : ""] : []),
              ]),
            )} />
          </div>
        )}
      </div>
      {isLoading ? (
        <Loading />
      ) : error || !data ? (
        <LoadError what={copy.what} />
      ) : data.data.length === 0 ? (
        <EmptyState
          icon={<Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />}
          title="Nothing pending"
          description={copy.empty}
        />
      ) : (
        <ReportTable
          rows={data.data}
          rowKey={(r) => r.lineId}
          columns={[
            { label: "Date", hideBelow: "md", render: (r) => formatDate(r.documentDate) },
            { label: copy.number, render: (r) => <span className="font-mono text-[13px] text-text-secondary">{r.documentNumber}</span> },
            { label: "Party", render: (r) => r.partyName },
            { label: "Item", render: (r) => r.itemName },
            { label: "Ordered", align: "right", hideBelow: "lg", render: (r) => formatQty(r.ordered, r.unit) },
            { label: copy.done, align: "right", hideBelow: "lg", render: (r) => formatQty(r.fulfilled) },
            { label: "Pending", align: "right", render: (r) => (
              <div>
                <span className="font-semibold">{formatQty(r.pending, r.unit)}</span>
                {r.freePending > 0 && <span className="block text-xs text-text-tertiary">+ {formatQty(r.freePending)} free</span>}
                {r.rejected > 0 && <span className="block text-xs text-amber-600">{formatQty(r.rejected)} rejected</span>}
              </div>
            ) },
            { label: "Value", align: "right", hideBelow: "md", render: (r) => formatCurrency(r.pendingValue) },
            ...(copy.due ? [{
              label: "Delivery by",
              align: "right" as const,
              render: (r: (typeof data.data)[number]) => (
                <span className={cn(r.overdue && "text-red-600 dark:text-red-400 font-medium")}>
                  {r.dueDate ? formatDate(r.dueDate) : "—"}
                </span>
              ),
            }] : []),
          ]}
        />
      )}
    </div>
  );
}

export function PendingSalesOrdersReport() {
  return <PendingReport kind="sales_order" />;
}

export function PendingPurchaseOrdersReport() {
  return <PendingReport kind="purchase_order" />;
}

export function PendingGrnReport() {
  return <PendingReport kind="goods_receipt_note" />;
}

export function PendingDeliveryChallansReport() {
  return <PendingReport kind="delivery_challan" />;
}
