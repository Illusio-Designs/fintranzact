import { createFileRoute, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { DocumentListPage } from "@/components/DocumentListPage";

import { NoteRemoveIcon } from "@hugeicons/core-free-icons";
export const Route = createFileRoute("/credit-notes")({
  validateSearch: (search) => z.object({ id: z.string().uuid().optional() }).parse(search),
  component: CreditNotesPage,
});

function CreditNotesPage() {
  const { id } = useSearch({ from: "/credit-notes" });
  return (
    <DocumentListPage
      initialSelectedId={id}
      config={{
        trpcRouter: "creditNote",
        documentType: "credit_note",
        hasTypeFilter: true,
        title: "Credit Notes",
        description: "Manage sales and purchase credit notes",
        buttonLabel: "+ New Credit Note",
        statusTabs: [
          { value: "", label: "All" },
          { value: "draft", label: "Draft" },
          { value: "sent", label: "Sent" },
          { value: "paid", label: "Paid" },
          { value: "cancelled", label: "Cancelled" },
        ],
        emptyTitle: "No credit notes found",
        emptyDescription: (type, status) =>
          `No ${type === "sale" ? "sales" : "purchase"} credit notes${status ? ` with status "${status}"` : ""}.`,
        emptyIcon: NoteRemoveIcon,
        col2Header: "Credit Note #",
        col4Variant: "refInvoice",
        col4Header: "Ref. Invoice",
        markSent: true,
        markPaid: true,
      }}
    />
  );
}
