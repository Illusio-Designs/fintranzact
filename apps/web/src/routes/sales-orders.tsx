import { createFileRoute, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { DocumentListPage } from "@/components/DocumentListPage";

import { ShoppingCartCheck01Icon } from "@hugeicons/core-free-icons";
export const Route = createFileRoute("/sales-orders")({
  validateSearch: (search) => z.object({ id: z.string().uuid().optional() }).parse(search),
  component: SalesOrdersPage,
});

function SalesOrdersPage() {
  const { id } = useSearch({ from: "/sales-orders" });
  return (
    <DocumentListPage
      initialSelectedId={id}
      config={{
        trpcRouter: "salesOrder",
        documentType: "sales_order",
        defaultInvoiceType: "sale",
        title: "Sales Orders",
        description: "Customer orders and what is still to be delivered",
        buttonLabel: "+ New Sales Order",
        statusTabs: [
          { value: "", label: "All" },
          { value: "open", label: "Open" },
          { value: "partial", label: "Partly delivered" },
          { value: "fulfilled", label: "Fulfilled" },
          { value: "closed", label: "Closed" },
          { value: "cancelled", label: "Cancelled" },
        ],
        emptyTitle: "No sales orders found",
        emptyDescription: (_type, status) =>
          `No sales orders${status ? ` with status "${status}"` : ""}. Record an order when a customer places it, then deliver or invoice it in one go or in parts.`,
        emptyIcon: ShoppingCartCheck01Icon,
        col2Header: "Order #",
        col4Variant: "dueDate",
        col4Header: "Delivery by",
        markSent: true,
        fulfilment: {
          convertTo: [
            { type: "delivery_challan", label: "Delivery Challan" },
            { type: "invoice", label: "Invoice" },
          ],
          labels: { partial: "Partly delivered" },
        },
      }}
    />
  );
}
