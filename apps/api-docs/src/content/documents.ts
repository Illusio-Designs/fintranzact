import type { EndpointGroup } from "./types";
const API_BASE_URL = (import.meta.env.API_URL || (typeof window !== "undefined" ? window.location.origin : "https://fintranzact-production.up.railway.app")).replace(/\/$/, "");

export const documentsEndpoints: EndpointGroup = {
  id: "documents",
  title: "Documents",
  description: "Quotations, proforma invoices, credit and debit notes, delivery challans, sales and purchase returns, sales and purchase orders, and goods receipt notes. They are stored in the same table as invoices (with a different `documentType`) and share one set of five procedures — `list`, `getById`, `create`, `updateStatus` and `delete` — mounted under a separate router per type: `quotation`, `proforma`, `creditNote`, `debitNote`, `deliveryChallan`, `salesReturn`, `purchaseReturn`, `salesOrder`, `purchaseOrder` and `goodsReceiptNote`. The examples use `quotation.*`; swap the router name for any other type. Allowed statuses are `draft`, `sent`, `cancelled` for every type, plus `paid` for credit and debit notes. Stock effect on create: delivery challans and purchase returns take goods out, sales returns and GRNs bring goods in, every other type moves no stock. `salesOrder` always creates `type: \"sale\"` and `purchaseOrder` / `goodsReceiptNote` always `type: \"purchase\"`; the other types take `type` from the input. Each type is numbered from its own prefix and counter on the business (e.g. `quotationPrefix` + `nextQuotationNumber` gives `QT-00042`). Cancelling or deleting a stock-moving document gives the stock back; reinstating a cancelled one applies it again. Sales orders, purchase orders, GRNs and delivery challans also track what is still pending against them — see Order Fulfilment (`orders.*`) and `document.convert`. None of the five shared procedures calls `requireCan`: any member of the business can use them, whatever their role.",
  endpoints: [
    {
      id: "document-list",
      method: "query",
      path: "quotation.list",
      title: "List Documents",
      description: "Paginated list of one document type for the active business (the router you call picks the type), newest first. Soft-deleted documents are excluded. For pending-tracked types (sales order, purchase order, GRN, delivery challan) each row also carries its `fulfilmentStatus`, and you can filter on it.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "type", type: "enum", required: false, description: "Filter by direction", enumValues: ["sale", "purchase"] },
        { name: "status", type: "enum | enum[]", required: false, description: "One status or an array of statuses. Only the statuses allowed for the router's type are accepted (see the table above)." },
        { name: "partyId", type: "string (UUID)", required: false, description: "Only documents for this party" },
        { name: "fromDate", type: "string (ISO 8601 datetime)", required: false, description: "Start of the document-date range (inclusive, business time zone)" },
        { name: "toDate", type: "string (ISO 8601 datetime)", required: false, description: "End of the document-date range (inclusive)" },
        { name: "search", type: "string", required: false, description: "Case-insensitive match on document number or party name" },
        { name: "itemId", type: "string (UUID)", required: false, description: "Only documents with a line for this item" },
        { name: "fulfilment", type: "enum", required: false, description: "Pending-tracked types only: filter by fulfilment status. Ignored for other types.", enumValues: ["open", "partial", "fulfilled", "closed"] },
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Rows per page (1–100)", default: "20" },
      ],
      output: {
        description: "Paginated rows. `fulfilmentStatus` is `open | partial | fulfilled | closed | cancelled` for pending-tracked types and `null` for the rest. `closedAt` is set when an order was short-closed with `orders.close`.",
        example: {
          data: [
            {
              id: "doc-uuid",
              invoiceNumber: "SO-00018",
              type: "sale",
              status: "sent",
              documentType: "sales_order",
              invoiceDate: "2026-09-12T00:00:00.000Z",
              dueDate: "2026-09-30T00:00:00.000Z",
              totalAmount: "84000.00",
              amountPaid: "0.00",
              referenceDocumentId: null,
              closedAt: null,
              partyName: "Sharma Traders",
              partyId: "party-uuid",
              fulfilmentStatus: "partial",
            },
          ],
          total: 23,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/quotation.list?input=%7B%22json%22%3A%7B%22status%22%3A%22sent%22%2C%22page%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `// Open quotations
const { data, total } = await trpc.quotation.list.query({ status: "sent", page: 1 });

// Sales orders that are only partly delivered
const partial = await trpc.salesOrder.list.query({ fulfilment: "partial" });`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"status": "sent", "page": 1}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/quotation.list?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)
page = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "With `fulfilment` set, the server loads every matching document, works out each one's fulfilment from its lines and pages over the result — slower than an unfiltered list on large books.",
        "Passing a status that the type doesn't allow (for example `paid` on `quotation.list`) fails zod validation with BAD_REQUEST.",
        "Money fields are strings; don't parse them with `parseFloat` for arithmetic.",
      ],
      relatedEndpoints: ["document-get-by-id", "orders-pending", "invoice-list"],
    },
    {
      id: "document-get-by-id",
      method: "query",
      path: "quotation.getById",
      title: "Get Document",
      description: "One document of the router's type with its line items (in `sortOrder`) and full party row. Returns `null` when the id is unknown, belongs to another business or is of a different type. Soft-deleted documents are still returned (check `deletedAt`).",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Document ID" },
      ],
      output: {
        description: "Every column of the document row (same shape as an invoice: totals, `referenceDocumentId`, `warehouseId`, `stockMode`, `closedAt`, `deletedAt`, ...) plus `lineItems[]` and `party` (or `null`).",
        example: {
          id: "doc-uuid",
          invoiceNumber: "QT-00042",
          type: "sale",
          documentType: "quotation",
          status: "sent",
          invoiceDate: "2026-09-20T00:00:00.000Z",
          dueDate: "2026-10-05T00:00:00.000Z",
          subtotal: "40000.00",
          taxAmount: "7200.00",
          additionalCharges: "0.00",
          roundOff: "0.00",
          totalAmount: "47200.00",
          referenceDocumentId: null,
          warehouseId: null,
          stockMode: "none",
          closedAt: null,
          deletedAt: null,
          notes: "Valid for 15 days.",
          lineItems: [
            {
              id: "line-uuid",
              itemId: "item-uuid",
              itemName: "Steel Almirah 4ft",
              description: null,
              quantity: "4.000",
              unitPrice: "10000.00",
              taxPercent: "18.00",
              taxAmount: "7200.00",
              discountPercent: "0.00",
              totalAmount: "47200.00",
              sortOrder: 0,
              selectedUnit: null,
              conversionFactor: "1",
              variantId: null,
            },
          ],
          party: { id: "party-uuid", name: "Sharma Traders", gstin: "27AAECS1234F1Z5" },
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/quotation.getById?input=%7B%22json%22%3A%7B%22id%22%3A%22DOC_ID%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const doc = await trpc.quotation.getById.query({ id: docId });
if (!doc) throw new Error("Not found");`,
      },
      gotchas: [
        "The router is part of the lookup: calling `creditNote.getById` with a quotation's id returns `null`.",
        "To see what is pending on an order, challan or GRN, use `orders.fulfilment`.",
      ],
      relatedEndpoints: ["document-list", "orders-fulfilment", "share-create"],
    },
    {
      id: "document-create",
      method: "mutation",
      path: "quotation.create",
      title: "Create Document",
      description: "Create a document of the router's type. Takes the same input as `invoice.create` (`createInvoiceSchema`); the `documentType` field is ignored and always set from the router. In one transaction the server checks that the party, every `itemId` and every `variantId` belong to the business; takes the next number from the type's prefix and counter (row lock on the business, so numbers never collide); computes line and document totals server-side in fixed-point (`charges[]` replace `additionalCharges` when given); for credit notes, sales returns and purchase returns with a `referenceDocumentId`, refuses a total above what is left to adjust on the referenced invoice and marks that invoice `adjusted` once fully covered; and for stock-moving types (delivery challan, sales/purchase return, GRN) records the stock movement in `warehouseId` (default warehouse when omitted) unless `skipStockAdjustment` is true. An audit entry `<documentType>.create` is written.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "partyId", type: "string (UUID)", required: true, description: "Customer or supplier" },
        { name: "type", type: "enum", required: true, description: "Direction. Overridden to `sale` on salesOrder and to `purchase` on purchaseOrder / goodsReceiptNote.", enumValues: ["sale", "purchase"] },
        { name: "invoiceDate", type: "string (ISO 8601 datetime)", required: false, description: "Document date", default: "now" },
        { name: "dueDate", type: "string (ISO 8601 datetime)", required: false, description: "Due / valid-until / expected delivery date" },
        { name: "lineItems", type: "array", required: true, description: "At least one line" },
        { name: "lineItems[].itemName", type: "string", required: true, description: "Line name as printed (1–200 chars)" },
        { name: "lineItems[].itemId", type: "string (UUID)", required: false, description: "Linked catalogue item (needed for stock effects)" },
        { name: "lineItems[].variantId", type: "string (UUID) | null", required: false, description: "Item variant" },
        { name: "lineItems[].description", type: "string | null", required: false, description: "Line notes (max 500)" },
        { name: "lineItems[].quantity", type: "string (decimal)", required: true, description: "Up to 3 decimals, > 0" },
        { name: "lineItems[].unitPrice", type: "string (decimal)", required: true, description: "Up to 2 decimals" },
        { name: "lineItems[].taxPercent", type: "string (decimal)", required: false, description: "0–56", default: "0" },
        { name: "lineItems[].discountPercent", type: "string (decimal)", required: false, description: "0–100", default: "0" },
        { name: "lineItems[].selectedUnit", type: "string | null", required: false, description: "Alternate unit the line is in" },
        { name: "lineItems[].conversionFactor", type: "string | null", required: false, description: "Base units per selected unit (forced to 1 for variant lines)" },
        { name: "notes", type: "string", required: false, description: "Max 2000 chars" },
        { name: "termsAndConditions", type: "string", required: false, description: "Max 2000 chars" },
        { name: "additionalCharges", type: "string (decimal)", required: false, description: "Flat extra charge (used when `charges` is not given)", default: "0" },
        { name: "charges", type: "array", required: false, description: "Itemised charges `{ label, amount, shipmentId? }`; their sum becomes `additionalCharges`" },
        { name: "roundOff", type: "string (decimal, may be negative)", required: false, description: "Round-off amount", default: "0" },
        { name: "referenceDocumentId", type: "string (UUID)", required: false, description: "Source document (for credit notes / returns: the invoice being adjusted)" },
        { name: "warehouseId", type: "string (UUID) | null", required: false, description: "Warehouse the goods leave or enter. Only used by stock-moving types; default warehouse when omitted." },
        { name: "skipStockAdjustment", type: "boolean", required: false, description: "Create without moving stock" },
        { name: "invoiceDiscount / invoiceDiscountType / isReverseCharge / deliveryMethod / source", type: "various", required: false, description: "Accepted by the shared schema but not stored by document routers" },
      ],
      output: {
        description: "The inserted document row (without line items).",
        example: {
          id: "doc-uuid",
          invoiceNumber: "DC-00007",
          documentType: "delivery_challan",
          type: "sale",
          status: "draft",
          totalAmount: "23600.00",
          stockMode: "tracked",
          warehouseId: "wh-uuid",
          referenceDocumentId: null,
          createdByName: "Priya Nair",
        },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/quotation.create" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"partyId":"PARTY_ID","type":"sale","lineItems":[{"itemId":"ITEM_ID","itemName":"Steel Almirah 4ft","quantity":"4","unitPrice":"10000","taxPercent":"18"}]}}'`,
        javascript: `const quote = await trpc.quotation.create.mutate({
  partyId,
  type: "sale",
  dueDate: new Date(Date.now() + 15 * 86400000).toISOString(),
  lineItems: [
    { itemId, itemName: "Steel Almirah 4ft", quantity: "4", unitPrice: "10000", taxPercent: "18" },
  ],
  notes: "Valid for 15 days.",
});

// A credit note against an invoice
await trpc.creditNote.create.mutate({
  partyId,
  type: "sale",
  referenceDocumentId: invoiceId,
  lineItems: [{ itemName: "Rate difference", quantity: "1", unitPrice: "500" }],
});`,
      },
      gotchas: [
        "BAD_REQUEST `Party not found in this business` / `One or more items do not belong to this business` / `One or more variants do not belong to this business` for foreign ids.",
        "BAD_REQUEST `Amount exceeds remaining adjustable amount ...` when a credit note or return would take the referenced invoice below zero (0.01 tolerance). `Referenced invoice not found` if the reference is unknown.",
        "Stock-moving types: BAD_REQUEST `Not enough stock — ...` when the business's negative-stock policy is `block`; NOT_FOUND / BAD_REQUEST for an unknown or inactive `warehouseId`.",
        "Number counters are per type. Debit notes, sales returns and purchase returns each use their own prefix/counter columns on the business.",
        "Order and GRN documents are left out of money totals in dashboards and reports.",
        "No `requireCan` check — any business member can create any document type.",
      ],
      relatedEndpoints: ["document-convert", "invoice-create", "document-update-status"],
    },
    {
      id: "document-update-status",
      method: "mutation",
      path: "quotation.updateStatus",
      title: "Update Document Status",
      description: "Set the status of a document of the router's type. Moving into `cancelled` gives back its stock effect (for stock-moving types); moving out of `cancelled` applies it again, checking stock availability. Audit entry `<documentType>.updateStatus`.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Document ID" },
        { name: "status", type: "enum", required: true, description: "New status — one of the type's allowed statuses (see the table in the group description)" },
      ],
      output: {
        description: "The updated document row.",
        example: { id: "doc-uuid", invoiceNumber: "QT-00042", documentType: "quotation", status: "cancelled", updatedAt: "2026-09-25T10:14:00.000Z" },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/quotation.updateStatus" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"id":"DOC_ID","status":"sent"}}'`,
        javascript: `await trpc.quotation.updateStatus.mutate({ id: docId, status: "sent" });
await trpc.deliveryChallan.updateStatus.mutate({ id: challanId, status: "cancelled" }); // stock comes back`,
      },
      gotchas: [
        "NOT_FOUND `Document not found` when the id isn't a document of this type in the business.",
        "Cancelling a delivery challan or GRN that an invoice was billed from fails with BAD_REQUEST `Invoice <number> was billed from this document. Cancel or delete that invoice first.` — the invoice didn't move stock, so taking the challan's movement back would lose it.",
        "Reinstating a cancelled stock-moving document can fail with `Not enough stock — ...` under the `block` negative-stock policy.",
      ],
      relatedEndpoints: ["document-delete", "orders-close"],
    },
    {
      id: "document-delete",
      method: "mutation",
      path: "quotation.delete",
      title: "Delete Document",
      description: "Soft-delete a document of the router's type: sets `deletedAt`, sets the status to `cancelled` and removes its stock effect. Deleting an already-deleted document is a no-op that still returns success. Audit entry `<documentType>.delete` (only when something was deleted).",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Document ID" },
      ],
      output: {
        description: "Always `{ success: true }` when the document exists.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/quotation.delete" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"id":"DOC_ID"}}'`,
        javascript: `await trpc.quotation.delete.mutate({ id: docId });`,
      },
      gotchas: [
        "NOT_FOUND `Document not found` for an unknown id or a document of another type.",
        "A delivery challan or GRN that an invoice was billed from can't be deleted until that invoice is cancelled or deleted (BAD_REQUEST).",
        "Although the procedure is declared as an admin procedure, no `requireCan` check runs — any member of the business can delete.",
      ],
      relatedEndpoints: ["document-update-status"],
    },
    {
      id: "document-convert",
      method: "mutation",
      path: "document.convert",
      title: "Convert Document",
      description: "Create a new document from an existing one — quotation → invoice, proforma → invoice, sales order → delivery challan or invoice, purchase order → GRN or purchase invoice, delivery challan → invoice, GRN → purchase invoice, and so on. The new document copies the party, direction, notes, terms and lines, points at the source through `referenceDocumentId`, and is created through the target type's own `create` procedure, so numbering, validation and stock rules are the same as creating it by hand. Sales orders may only become delivery challans or invoices, purchase orders only GRNs or invoices, and GRNs only invoices; any other source (including a delivery challan) may become any type. When a sales order, purchase order, GRN or delivery challan is converted into what fulfils it, only what is still pending on each line is carried over — or the quantities picked in `lines`, which may not exceed what is pending; lines left out of `lines` are not converted, and when only part of a document is taken its charges and round-off stay behind. Every other conversion copies all lines in full. Converting a delivery challan or GRN into an invoice skips the invoice's stock movement, because the challan or GRN already moved the goods. Documents made from an order are dated today; other conversions keep the source's date and due date.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "sourceDocumentId", type: "string (UUID)", required: true, description: "Document to convert (any type, including an invoice)" },
        { name: "targetDocumentType", type: "enum", required: true, description: "Type to create", enumValues: ["invoice", "quotation", "credit_note", "debit_note", "delivery_challan", "proforma", "sales_return", "purchase_return", "purchase_order", "sales_order", "goods_receipt_note"] },
        { name: "lines", type: "array", required: false, description: "Partial conversion of a pending-tracked source: the quantity to take from each source line. Omit to take everything pending." },
        { name: "lines[].sourceLineId", type: "string (UUID)", required: true, description: "Line item id on the source document" },
        { name: "lines[].quantity", type: "string (decimal)", required: true, description: "Quantity in the line's own unit, up to 3 decimals; 0 skips the line" },
        { name: "warehouseId", type: "string (UUID) | null", required: false, description: "Warehouse for the new document when it moves stock; default warehouse when omitted" },
      ],
      output: {
        description: "The new document's id, type and number.",
        example: { id: "new-doc-uuid", documentType: "delivery_challan", invoiceNumber: "DC-00008" },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/document.convert" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"sourceDocumentId":"QUOTE_ID","targetDocumentType":"invoice"}}'`,
        javascript: `// Quotation → invoice
const inv = await trpc.document.convert.mutate({ sourceDocumentId: quoteId, targetDocumentType: "invoice" });

// Deliver part of a sales order: 6 of line A, nothing of line B
const f = await trpc.orders.fulfilment.query({ id: orderId });
const challan = await trpc.document.convert.mutate({
  sourceDocumentId: orderId,
  targetDocumentType: "delivery_challan",
  lines: [{ sourceLineId: f.lines[0].lineId, quantity: "6" }],
  warehouseId,
});`,
      },
      gotchas: [
        "NOT_FOUND `Source document not found` for an unknown id or one from another business.",
        "BAD_REQUEST `A sales order can't be converted into a quotation` (and similar) — orders and GRNs only convert into what fulfils them.",
        "BAD_REQUEST `Quantities can only be picked when converting an order, challan or GRN` when `lines` is sent for any other conversion.",
        "BAD_REQUEST for pending-tracked sources: `A cancelled document can't be converted`, `This document is closed. Reopen it to convert what is pending.`, `A picked line is not on this document`, `Only <n> of <item> is pending`, `Nothing is pending on this document`.",
        "Errors from the target type's `create` (stock shortage, adjustment limits on credit notes) pass straight through.",
        "Converting to `invoice` runs `invoice.create`, which does its own permission check (`Invoice:create`); converting to any other type has no permission check beyond business membership.",
        "Audit entry `document.convert` with source and target types.",
      ],
      relatedEndpoints: ["orders-fulfilment", "orders-pending", "document-create", "invoice-create"],
    },
  ],
};
