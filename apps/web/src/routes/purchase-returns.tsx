import { createFileRoute, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { DocumentListPage } from "@/components/DocumentListPage";

import { DeliveryReturn01Icon } from "@hugeicons/core-free-icons";
export const Route = createFileRoute("/purchase-returns")({
  validateSearch: (search) => z.object({ id: z.string().uuid().optional() }).parse(search),
  component: PurchaseReturnsPage,
});

function PurchaseReturnsPage() {
  const { id } = useSearch({ from: "/purchase-returns" });
  return (
    <DocumentListPage
      initialSelectedId={id}
      config={{
        trpcRouter: "purchaseReturn",
        documentType: "purchase_return",
        defaultInvoiceType: "purchase",
        title: "Purchase Returns",
        description: "Manage goods sent back to suppliers",
        buttonLabel: "+ New Purchase Return",
        statusTabs: [
          { value: "", label: "All" },
          { value: "draft", label: "Draft" },
          { value: "sent", label: "Sent" },
          { value: "cancelled", label: "Cancelled" },
        ],
        emptyTitle: "No purchase returns found",
        emptyDescription: (_type, status) =>
          `No purchase returns${status ? ` with status "${status}"` : ""}. Create one against a purchase invoice to send goods back to the supplier.`,
        emptyIcon: DeliveryReturn01Icon,
        col2Header: "Return #",
        col4Variant: "refInvoice",
        col4Header: "Ref. Invoice",
        markSent: true,
        cancellable: true,
      }}
    />
  );
}
