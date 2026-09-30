import { createFileRoute, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { DocumentListPage } from "@/components/DocumentListPage";

import { ShoppingBasket01Icon } from "@hugeicons/core-free-icons";
export const Route = createFileRoute("/purchase-orders")({
  validateSearch: (search) => z.object({ id: z.string().uuid().optional() }).parse(search),
  component: PurchaseOrdersPage,
});

function PurchaseOrdersPage() {
  const { id } = useSearch({ from: "/purchase-orders" });
  return (
    <DocumentListPage
      initialSelectedId={id}
      config={{
        trpcRouter: "purchaseOrder",
        documentType: "purchase_order",
        defaultInvoiceType: "purchase",
        title: "Purchase Orders",
        description: "Orders placed with suppliers and what is still to arrive",
        buttonLabel: "+ New Purchase Order",
        statusTabs: [
          { value: "", label: "All" },
          { value: "open", label: "Open" },
          { value: "partial", label: "Partly received" },
          { value: "fulfilled", label: "Received" },
          { value: "closed", label: "Closed" },
          { value: "cancelled", label: "Cancelled" },
        ],
        emptyTitle: "No purchase orders found",
        emptyDescription: (_type, status) =>
          `No purchase orders${status ? ` with status "${status}"` : ""}. Send suppliers an order, then receive the goods on a GRN or the bill.`,
        emptyIcon: ShoppingBasket01Icon,
        col2Header: "PO #",
        col4Variant: "dueDate",
        col4Header: "Delivery by",
        markSent: true,
        fulfilment: {
          convertTo: [
            { type: "goods_receipt_note", label: "Goods Receipt Note" },
            { type: "invoice", label: "Purchase Invoice" },
          ],
          labels: { partial: "Partly received", fulfilled: "Received" },
        },
      }}
    />
  );
}
