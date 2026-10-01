import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { DocumentListPage } from "@/components/DocumentListPage";
import type { DocumentType } from "@/components/DocumentCreator";
import { getDocumentTypeLabel } from "@/lib/utils";

import { FileEditIcon } from "@hugeicons/core-free-icons";
export const Route = createFileRoute("/quotations")({
  validateSearch: (search) => z.object({ id: z.string().uuid().optional() }).parse(search),
  component: QuotationsPage,
});

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "cancelled", label: "Cancelled" },
];

function QuotationsPage() {
  const navigate = useNavigate();
  const { id: idFromSearch } = useSearch({ from: "/quotations" });
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const convertMutation = trpc.document.convert.useMutation({
    onSuccess: (res) => {
      toast.success(`${getDocumentTypeLabel(res.documentType)} ${res.invoiceNumber} created`);
      utils.invoice.list.invalidate();
      utils.salesOrder.list.invalidate();
      utils.party.invalidate();
      setConvertingId(null);
      // Open what was made, where it lives.
      if (res.documentType === "sales_order") navigate({ to: "/sales-orders", search: { id: res.id } });
      else navigate({ to: "/invoices", search: { id: res.id } });
    },
    onError: (err) => {
      toast.error("Failed to convert", err.message);
      setConvertingId(null);
    },
  });

  function handleConvert(id: string, target: DocumentType) {
    setConvertingId(id);
    convertMutation.mutate({ sourceDocumentId: id, targetDocumentType: target });
  }

  return (
    <DocumentListPage
      initialSelectedId={idFromSearch}
      config={{
        trpcRouter: "quotation",
        documentType: "quotation",
        defaultInvoiceType: "sale",
        title: "Quotations",
        description: "Manage sales quotations",
        buttonLabel: "+ New Quotation",
        statusTabs: STATUS_TABS,
        emptyTitle: "No quotations found",
        emptyDescription: (_type, status) =>
          `No quotations${status ? ` with status "${status}"` : ""}.`,
        emptyIcon: FileEditIcon,
        col2Header: "Quotation #",
        col4Variant: "dueDate",
        col4Header: "Due Date",
        markSent: true,
        // A quotation the customer accepts becomes an order to deliver
        // against, or is billed straight away.
        convert: {
          convertingId,
          onConvert: handleConvert,
          targets: [
            { type: "sales_order", label: "Sales Order" },
            { type: "invoice", label: "Invoice" },
          ],
        },
      }}
    />
  );
}
