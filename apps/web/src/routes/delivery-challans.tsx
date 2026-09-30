import { createFileRoute, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { DocumentListPage } from "@/components/DocumentListPage";

import { DeliveryTruck01Icon } from "@hugeicons/core-free-icons";
export const Route = createFileRoute("/delivery-challans")({
  validateSearch: (search) => z.object({ id: z.string().uuid().optional() }).parse(search),
  component: DeliveryChallansPage,
});

function DeliveryChallansPage() {
  const { id } = useSearch({ from: "/delivery-challans" });
  return (
    <DocumentListPage
      initialSelectedId={id}
      config={{
        trpcRouter: "deliveryChallan",
        documentType: "delivery_challan",
        hasTypeFilter: true,
        title: "Delivery Challans",
        description: "Manage delivery challans and dispatch notes",
        buttonLabel: "+ New Challan",
        statusTabs: [
          { value: "", label: "All" },
          { value: "draft", label: "Draft" },
          { value: "sent", label: "Sent" },
          { value: "cancelled", label: "Cancelled" },
        ],
        emptyTitle: "No delivery challans found",
        emptyDescription: (type, status) =>
          `No ${type === "sale" ? "sales" : "purchase"} delivery challans${status ? ` with status "${status}"` : ""}.`,
        emptyIcon: DeliveryTruck01Icon,
        col2Header: "Challan #",
        col4Variant: "dueDate",
        col4Header: "Due Date",
        markSent: true,
        fulfilment: {
          convertTo: [{ type: "invoice", label: "Invoice" }],
          labels: { open: "Not billed", partial: "Partly billed", fulfilled: "Billed" },
        },
      }}
    />
  );
}
