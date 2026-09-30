import type { EndpointGroup } from "./types";
const API_BASE_URL = (import.meta.env.API_URL || (typeof window !== "undefined" ? window.location.origin : "https://fintranzact-production.up.railway.app")).replace(/\/$/, "");

export const ordersEndpoints: EndpointGroup = {
  id: "orders",
  title: "Order Fulfilment",
  description: "What is still pending on sales orders, purchase orders, goods receipt notes and delivery challans, and short-closing them. The documents themselves are created and listed through their own routers (`salesOrder.*`, `purchaseOrder.*`, `goodsReceiptNote.*`, `deliveryChallan.*`) and fulfilled with `document.convert`. A line's pending quantity is what was ordered minus what documents made from it (linked by `referenceDocumentId`) have taken, matched by variant, item or — for free-text lines — name, and converted between units. A sales order is fulfilled by delivery challans and invoices, a purchase order by GRNs and invoices, and a GRN or delivery challan by invoices. A document's fulfilment status is `cancelled` (cancelled or deleted), `closed` (short-closed), otherwise `open`, `partial` or `fulfilled` from its lines.",
  endpoints: [
    {
      id: "orders-pending",
      method: "query",
      path: "orders.pending",
      title: "Pending Lines Report",
      description: "Every line still pending across open documents of one type — the pending sales order, purchase order, GRN and challan reports. Cancelled, deleted and short-closed documents are left out, as are lines with nothing pending. Documents are in date order.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "documentType", type: "enum", required: true, description: "Which documents to report on", enumValues: ["sales_order", "purchase_order", "goods_receipt_note", "delivery_challan"] },
        { name: "partyId", type: "string (UUID)", required: false, description: "Only this party's documents" },
        { name: "itemId", type: "string (UUID)", required: false, description: "Only lines for this item" },
        { name: "overdueOnly", type: "boolean", required: false, description: "Only documents whose due date has passed", default: "false" },
      ],
      output: {
        description: "One row per pending line. Quantities are numbers in the line's own unit; `rate` is the unit price after the line discount and `pendingValue = rate × pending` (before tax), both strings. `totals.documents` counts distinct documents with pending lines.",
        example: {
          data: [
            {
              documentId: "so-uuid",
              documentNumber: "SO-00018",
              documentDate: "2026-09-12T00:00:00.000Z",
              dueDate: "2026-09-20T00:00:00.000Z",
              overdue: true,
              partyId: "party-uuid",
              partyName: "Sharma Traders",
              lineId: "line-uuid",
              itemId: "item-uuid",
              itemName: "PVC Pipe 1 inch",
              unit: "pcs",
              ordered: 200,
              fulfilled: 120,
              pending: 80,
              rate: "95.00",
              pendingValue: "7600.00",
            },
          ],
          totals: { documents: 1, value: "7600.00" },
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/orders.pending?input=%7B%22json%22%3A%7B%22documentType%22%3A%22sales_order%22%2C%22overdueOnly%22%3Atrue%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, totals } = await trpc.orders.pending.query({
  documentType: "sales_order",
  overdueOnly: true,
});
console.log(\`\${totals.documents} orders, ₹\${totals.value} pending\`);`,
      },
      gotchas: [
        "Requires `Invoice:read` permission.",
        "`unit` is the line's selected unit, or the item's base unit when the line used it.",
      ],
      relatedEndpoints: ["orders-fulfilment", "document-convert"],
    },
    {
      id: "orders-fulfilment",
      method: "query",
      path: "orders.fulfilment",
      title: "Document Fulfilment",
      description: "One order, challan or GRN with every line's ordered, fulfilled and pending quantities, the types it can be converted into, and the (non-deleted) documents already made from it. Use the `lineId`s as `lines[].sourceLineId` for a partial `document.convert`.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Sales order, purchase order, GRN or delivery challan ID" },
      ],
      output: {
        description: "`status` is the fulfilment status. Each line carries `lineId`, `itemId`, `variantId`, `itemName`, `description`, `selectedUnit`, `conversionFactor`, `unitPrice`, `taxPercent`, `discountPercent`, `ordered`, `fulfilled` and `pending`.",
        example: {
          id: "so-uuid",
          documentType: "sales_order",
          status: "partial",
          closedAt: null,
          convertsTo: ["delivery_challan", "invoice"],
          lines: [
            {
              lineId: "line-uuid",
              documentId: "so-uuid",
              itemId: "item-uuid",
              variantId: null,
              itemName: "PVC Pipe 1 inch",
              description: null,
              selectedUnit: null,
              conversionFactor: "1",
              unitPrice: "95.00",
              taxPercent: "18.00",
              discountPercent: "0.00",
              ordered: 200,
              fulfilled: 120,
              pending: 80,
            },
          ],
          linkedDocuments: [
            { id: "dc-uuid", documentType: "delivery_challan", type: "sale", invoiceNumber: "DC-00007", invoiceDate: "2026-09-15T00:00:00.000Z", status: "sent", totalAmount: "13452.00" },
          ],
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/orders.fulfilment?input=%7B%22json%22%3A%7B%22id%22%3A%22ORDER_ID%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const f = await trpc.orders.fulfilment.query({ id: orderId });
const stillToShip = f.lines.filter((l) => l.pending > 0);`,
      },
      gotchas: [
        "Requires `Invoice:read` permission.",
        "NOT_FOUND `Order not found` when the id is unknown or the document is not a pending-tracked type (e.g. a quotation).",
      ],
      relatedEndpoints: ["document-convert", "orders-close", "orders-pending"],
    },
    {
      id: "orders-close",
      method: "mutation",
      path: "orders.close",
      title: "Short-Close Document",
      description: "Mark an order, challan or GRN as closed: nothing more is expected against it, whatever is still pending. It drops out of the pending reports and can no longer be converted until reopened. Closing an already-closed document is a no-op. Audit entry `<documentType>.close`.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Document ID" },
      ],
      output: { description: "Success flag.", example: { success: true } },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/orders.close" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"id":"ORDER_ID"}}'`,
        javascript: `await trpc.orders.close.mutate({ id: orderId });`,
      },
      gotchas: [
        "Requires `Invoice:update` permission.",
        "NOT_FOUND `Order not found` for other document types; BAD_REQUEST `A cancelled document can't be closed`.",
        "Closing does not change the document's `status`; it sets `closedAt`.",
      ],
      relatedEndpoints: ["orders-reopen", "orders-fulfilment"],
    },
    {
      id: "orders-reopen",
      method: "mutation",
      path: "orders.reopen",
      title: "Reopen Document",
      description: "Undo a short-close: what was pending is expected again and the document can be converted. Reopening a document that isn't closed is a no-op. Audit entry `<documentType>.reopen`.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Document ID" },
      ],
      output: { description: "Success flag.", example: { success: true } },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/orders.reopen" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"id":"ORDER_ID"}}'`,
        javascript: `await trpc.orders.reopen.mutate({ id: orderId });`,
      },
      gotchas: [
        "Requires `Invoice:update` permission.",
        "NOT_FOUND `Order not found` for documents that aren't orders, challans or GRNs.",
      ],
      relatedEndpoints: ["orders-close"],
    },
  ],
};
