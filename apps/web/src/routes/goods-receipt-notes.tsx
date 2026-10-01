import { createFileRoute, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { DocumentListPage } from "@/components/DocumentListPage";

import { PackageReceiveIcon } from "@hugeicons/core-free-icons";
export const Route = createFileRoute("/goods-receipt-notes")({
  validateSearch: (search) => z.object({ id: z.string().uuid().optional() }).parse(search),
  component: GoodsReceiptNotesPage,
});

function GoodsReceiptNotesPage() {
  const { id } = useSearch({ from: "/goods-receipt-notes" });
  return (
    <DocumentListPage
      initialSelectedId={id}
      config={{
        trpcRouter: "goodsReceiptNote",
        documentType: "goods_receipt_note",
        defaultInvoiceType: "purchase",
        title: "Goods Receipt Notes",
        description: "Goods received into stock before the supplier's bill",
        buttonLabel: "+ New GRN",
        statusTabs: [
          { value: "", label: "All" },
          { value: "open", label: "Not billed" },
          { value: "partial", label: "Partly billed" },
          { value: "fulfilled", label: "Billed" },
          { value: "closed", label: "Closed" },
          { value: "cancelled", label: "Cancelled" },
        ],
        emptyTitle: "No goods receipt notes found",
        emptyDescription: (_type, status) =>
          `No GRNs${status ? ` with status "${status}"` : ""}. Record goods as they arrive; the stock comes in now and the bill made from the GRN won't add it again.`,
        emptyIcon: PackageReceiveIcon,
        col2Header: "GRN #",
        col4Variant: "dueDate",
        col4Header: "Due Date",
        markSent: true,
        fulfilment: {
          convertTo: [{ type: "invoice", label: "Purchase Invoice" }],
          labels: { open: "Not billed", partial: "Partly billed", fulfilled: "Billed" },
        },
      }}
    />
  );
}
