import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { DocumentListPage } from "@/components/DocumentListPage";

import { FileValidationIcon } from "@hugeicons/core-free-icons";
export const Route = createFileRoute("/proforma-invoices")({
  validateSearch: (search) => z.object({ id: z.string().uuid().optional() }).parse(search),
  component: ProformaInvoicesPage,
});

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "cancelled", label: "Cancelled" },
];

function ProformaInvoicesPage() {
  const navigate = useNavigate();
  const { id: idFromSearch } = useSearch({ from: "/proforma-invoices" });
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const convertMutation = trpc.document.convert.useMutation({
    onSuccess: () => {
      toast.success("Converted to invoice");
      utils.invoice.list.invalidate();
      setConvertingId(null);
      navigate({ to: "/invoices" });
    },
    onError: (err) => {
      toast.error("Failed to convert", err.message);
      setConvertingId(null);
    },
  });

  function handleConvert(id: string) {
    setConvertingId(id);
    convertMutation.mutate({ sourceDocumentId: id, targetDocumentType: "invoice" });
  }

  return (
    <DocumentListPage
      initialSelectedId={idFromSearch}
      config={{
        trpcRouter: "proforma",
        documentType: "proforma",
        defaultInvoiceType: "sale",
        title: "Proforma Invoices",
        description: "Manage proforma invoices",
        buttonLabel: "+ New Proforma",
        statusTabs: STATUS_TABS,
        emptyTitle: "No proforma invoices found",
        emptyDescription: (_type, status) =>
          `No proforma invoices${status ? ` with status "${status}"` : ""}.`,
        emptyIcon: FileValidationIcon,
        col2Header: "Proforma #",
        col4Variant: "dueDate",
        col4Header: "Due Date",
        markSent: true,
        convert: { convertingId, onConvert: handleConvert },
      }}
    />
  );
}
