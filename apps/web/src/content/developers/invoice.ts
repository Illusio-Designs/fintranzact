import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

export const invoiceEndpoints: EndpointGroup = {
  id: "invoices",
  title: "Invoices",
  description: "Create and manage sale and purchase invoices. Invoices are scoped to a business via the `x-business-id` header. Invoice numbers are atomically generated using a PostgreSQL row-level lock — no duplicate numbers even under concurrent requests.",
  endpoints: [
    {
      id: "invoice-list",
      method: "query",
      path: "invoice.list",
      title: "List Invoices",
      description: "Paginated list of invoices for the active business. Supports filtering by type, status, party, date range, and full-text search on invoice number and party name.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "documentType", type: "enum", required: false, description: "Document type to list", default: "invoice", enumValues: ["invoice", "quotation", "credit_note", "debit_note", "delivery_challan", "proforma", "sales_return", "purchase_return", "purchase_order", "sales_order", "goods_receipt_note"] },
        { name: "type", type: "enum", required: false, description: "Filter by invoice direction", enumValues: ["sale", "purchase"] },
        { name: "status", type: "enum | enum[]", required: false, description: "Filter by current status. Pass a single value or an array to match multiple statuses (e.g. `[\"sent\", \"partial\", \"overdue\"]` for all unpaid). The filter matches the stored status; `adjusted` is not accepted as a filter value (it is only computed on output for invoices fully covered by credit notes or sales returns).", enumValues: ["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled"] },
        { name: "partyId", type: "string (UUID)", required: false, description: "Filter invoices for a specific party" },
        { name: "fromDate", type: "string (ISO 8601)", required: false, description: "Start of date range (inclusive)" },
        { name: "toDate", type: "string (ISO 8601)", required: false, description: "End of date range (inclusive)" },
        { name: "itemId", type: "string (UUID)", required: false, description: "Filter invoices containing a specific item" },
        { name: "search", type: "string", required: false, description: "Search by invoice number or party name (case-insensitive)" },
        { name: "sortBy", type: "enum", required: false, description: "Sort column", enumValues: ["date", "amount", "number"] },
        { name: "sortDir", type: "enum", required: false, description: "Sort direction", enumValues: ["asc", "desc"] },
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page (1–100)", default: "20" },
      ],
      output: {
        description: "Paginated invoice list with party name denormalized. `status` is computed dynamically — an invoice fully covered by credit notes or sales returns will show `adjusted` instead of the stored status.",
        example: {
          data: [
            {
              id: "inv-uuid",
              invoiceNumber: "BB-14821",
              type: "sale",
              status: "sent",
              documentType: "invoice",
              invoiceDate: "2026-03-26T00:00:00.000Z",
              dueDate: "2026-04-10T00:00:00.000Z",
              totalAmount: "26250.00",
              amountPaid: "0.00",
              balanceDue: "26250.00",
              totalAdjusted: "0.00",
              partyName: "Gupta Enterprises",
              partyId: "party-uuid",
              createdByName: "Rahul Sharma",
            },
          ],
          total: 156,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/invoice.list?input=%7B%22json%22%3A%7B%22page%22%3A1%2C%22limit%22%3A20%2C%22type%22%3A%22sale%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, total } = await trpc.invoice.list.query({
  type: "sale",
  status: "sent",
  page: 1,
  limit: 20,
});

console.log(\`Showing \${data.length} of \${total} invoices\`);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"page": 1, "limit": 20, "type": "sale"}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/invoice.list?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
result = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Monetary values (`totalAmount`, `amountPaid`) are returned as strings to preserve decimal precision — never parse them with `parseFloat`.",
        "Requires the `x-business-id` header. Without it, the request returns BAD_REQUEST (400).",
        "Soft-deleted invoices (with `deletedAt` set) are excluded from results.",
      ],
    },
    {
      id: "invoice-get-by-id",
      method: "query",
      path: "invoice.getById",
      title: "Get Invoice",
      description: "Fetch a single invoice by ID, including all line items (each with the linked item's base unit as `itemUnit`), the associated party, linked credit notes / returns, and the warehouse its stock moved through. Returns `null` if the invoice does not exist or belongs to a different business.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Invoice ID" },
      ],
      output: {
        description: "Full invoice object with line items and party. `status` is computed dynamically — an invoice fully covered by linked credit notes or sales returns will show `adjusted`. `totalAdjusted` reflects the cumulative amount offset by those documents. `relatedDocuments` lists all non-cancelled documents that reference this invoice. `warehouseId` is the saved warehouse, or — for older invoices saved without one — the warehouse found on the invoice's stock movements (null for invoices that never moved stock). All other columns of the invoice row (e.g. `deliveryMethod`, `isReverseCharge`, `source`, `stockMode`, `charges`, e-invoice fields such as `irn` and `eInvoiceStatus`) are included as stored.",
        example: {
          id: "inv-uuid",
          invoiceNumber: "BB-14821",
          type: "sale",
          status: "sent",
          documentType: "invoice",
          invoiceDate: "2026-03-26T00:00:00.000Z",
          dueDate: "2026-04-10T00:00:00.000Z",
          subtotal: "25000.00",
          taxAmount: "1250.00",
          discountAmount: "0.00",
          additionalCharges: "0.00",
          roundOff: "0.00",
          totalAmount: "26250.00",
          amountPaid: "0.00",
          warehouseId: "warehouse-uuid-main",
          deliveryMethod: "transport",
          isReverseCharge: false,
          source: null,
          totalAdjusted: "0.00",
          relatedDocuments: [],
          notes: "Delivery to warehouse on 28th. NEFT payment preferred.",
          termsAndConditions: null,
          lineItems: [
            {
              id: "li-uuid",
              itemName: "Basmati Rice 25kg",
              description: null,
              quantity: "20.000",
              unitPrice: "1250.00",
              taxPercent: "5.00",
              taxAmount: "1250.00",
              discountPercent: "0.00",
              totalAmount: "26250.00",
              sortOrder: 0,
              itemId: "item-uuid",
              variantId: null,
              selectedUnit: "bag",
              conversionFactor: "1",
              itemUnit: "bag",
            },
          ],
          party: { id: "party-uuid", name: "Gupta Enterprises", gstin: "07AABCG5432M1Z3", phone: "9876543210" },
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/invoice.getById?input=%7B%22json%22%3A%7B%22id%22%3A%22inv-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const invoice = await trpc.invoice.getById.query({ id: "inv-uuid" });

if (!invoice) {
  console.log("Invoice not found");
  return;
}

const balance = Number(invoice.totalAmount) - Number(invoice.amountPaid);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "inv-uuid"}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/invoice.getById?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Requires `Invoice:read` permission.",
        "There is no `balanceDue` field — compute it as `totalAmount - amountPaid - totalAdjusted`.",
      ],
      relatedEndpoints: ["invoice-update", "invoice-list"],
    },
    {
      id: "invoice-create",
      method: "mutation",
      path: "invoice.create",
      title: "Create Invoice",
      description: "Create a new sale or purchase invoice. The document is always stored with `documentType: \"invoice\"` — quotations, credit notes, challans, orders and the other document types have their own routers. The invoice number (`<invoicePrefix>-<5-digit counter>`) is generated atomically using a PostgreSQL SELECT...FOR UPDATE lock on the business row. Stock movements are posted to the chosen (or default) warehouse in the same transaction.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "partyId", type: "string (UUID)", required: true, description: "Customer or supplier ID" },
        { name: "type", type: "enum", required: true, description: "Invoice direction", enumValues: ["sale", "purchase"] },
        { name: "documentType", type: "enum", required: false, description: "Accepted for compatibility but not stored — the created row is always an `invoice`. It is only consulted when deciding whether to auto-generate an e-invoice (IRN).", default: "invoice", enumValues: ["invoice", "quotation", "credit_note", "debit_note", "delivery_challan", "proforma", "sales_return", "purchase_return", "purchase_order", "sales_order", "goods_receipt_note"] },
        { name: "invoiceDate", type: "string (ISO 8601)", required: false, description: "Invoice date. Defaults to current date." },
        { name: "dueDate", type: "string (ISO 8601)", required: false, description: "Payment due date" },
        { name: "lineItems", type: "array", required: true, description: "At least one line item required. See line item schema below." },
        { name: "lineItems[].itemName", type: "string", required: true, description: "Name printed on the line (1–200 chars), snapshotted so later item renames don't rewrite history" },
        { name: "lineItems[].description", type: "string | null", required: false, description: "Optional line notes (max 500 chars)" },
        { name: "lineItems[].quantity", type: "string (decimal)", required: true, description: "Quantity as decimal string, e.g. `\"10.000\"`" },
        { name: "lineItems[].unitPrice", type: "string (decimal)", required: true, description: "Unit price as decimal string, e.g. `\"1500.00\"`" },
        { name: "lineItems[].taxPercent", type: "string (decimal)", required: false, description: "Tax rate percentage (0–56), e.g. `\"18.00\"`", default: "0" },
        { name: "lineItems[].discountPercent", type: "string (decimal)", required: false, description: "Line-level discount percentage (0–100), e.g. `\"5.00\"`", default: "0" },
        { name: "lineItems[].itemId", type: "string (UUID)", required: false, description: "Linked item catalog entry (updates stock)" },
        { name: "lineItems[].variantId", type: "string (UUID)", required: false, description: "Specific item variant (updates variant stock)" },
        { name: "lineItems[].selectedUnit", type: "string", required: false, description: "Display unit for alt_unit items" },
        { name: "lineItems[].conversionFactor", type: "string", required: false, description: "Unit conversion factor for alt_unit items", default: "1" },
        { name: "warehouseId", type: "string (UUID) | null", required: false, description: "Warehouse the goods go out of (sale) or come into (purchase). Defaults to the business's default warehouse for the operation. BAD_REQUEST if it is not in this business or inactive. Ignored when `skipStockAdjustment` is true." },
        { name: "charges", type: "array", required: false, description: "Additional charges (e.g. shipping). Each item: `{label: string, amount: decimal string}`." },
        { name: "additionalCharges", type: "string (decimal)", required: false, description: "Flat extra charges, used only when `charges` is empty", default: "0" },
        { name: "invoiceDiscount", type: "string (decimal)", required: false, description: "Invoice-level discount amount or percentage", default: "0" },
        { name: "invoiceDiscountType", type: "enum", required: false, description: "How to apply invoice-level discount", default: "amount", enumValues: ["amount", "percent"] },
        { name: "roundOff", type: "string (decimal)", required: false, description: "Round-off adjustment (can be negative), e.g. `\"0.50\"`", default: "0" },
        { name: "notes", type: "string", required: false, description: "Internal or customer-facing notes (max 2000 chars)" },
        { name: "termsAndConditions", type: "string", required: false, description: "T&C text printed on the invoice (max 2000 chars)" },
        { name: "deliveryMethod", type: "string", required: false, description: "How the goods are delivered: a built-in value (`self_pickup`, `hand_delivery`, `courier`, `bus`, `transport`, `post`) or the `id` of one of the business's custom methods (`business.customShippingMethods`, Settings → Shipping). A custom method's `label` is also matched, case-insensitively, and its `id` is stored. Anything else is BAD_REQUEST `Unknown delivery method`. Defaults to `\"self_pickup\"` if omitted. Self-pickup invoices do not auto-create a shipment record. Use `invoice.lastDeliveryMethod` to pre-populate this from the party's previous invoice.", default: "self_pickup" },
        { name: "referenceDocumentId", type: "string (UUID)", required: false, description: "ID of the source document (e.g. quotation being converted to invoice)" },
        { name: "isReverseCharge", type: "boolean", required: false, description: "Supply attracts GST under reverse charge", default: "false" },
        { name: "skipStockAdjustment", type: "boolean", required: false, description: "Don't move stock (stored with `stockMode: \"none\"`). Used when billing a delivery challan that already moved the goods." },
        { name: "source", type: "enum", required: false, description: "Origin channel shown in the invoice list; omit for invoices typed in the form", enumValues: ["pos", "online_store", "webhook"] },
      ],
      output: {
        description: "Created invoice with generated invoice number and calculated totals.",
        example: {
          id: "inv-uuid",
          invoiceNumber: "INV-00043",
          businessId: "biz-uuid",
          partyId: "party-uuid",
          type: "sale",
          documentType: "invoice",
          status: "draft",
          invoiceDate: "2024-03-16T00:00:00.000Z",
          dueDate: null,
          subtotal: "13347.46",
          taxAmount: "2402.54",
          discountAmount: "0.00",
          additionalCharges: "0.00",
          roundOff: "0.00",
          totalAmount: "15750.00",
          amountPaid: "0.00",
          warehouseId: null,
          stockMode: "tracked",
          notes: null,
          createdByName: "Rahul Sharma",
          createdAt: "2024-03-16T10:30:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/invoice.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "partyId": "gupta-enterprises-party-uuid",
      "type": "sale",
      "invoiceDate": "2026-03-26T00:00:00.000Z",
      "dueDate": "2026-04-10T00:00:00.000Z",
      "lineItems": [
        {
          "itemName": "Basmati Rice 25kg",
          "quantity": "20.000",
          "unitPrice": "1250.00",
          "taxPercent": "5.00",
          "discountPercent": "0.00",
          "itemId": "basmati-rice-item-uuid"
        }
      ],
      "notes": "Delivery to warehouse on 28th. NEFT payment preferred."
    }
  }'`,
        javascript: `const invoice = await trpc.invoice.create.mutate({
  partyId: "gupta-enterprises-party-uuid",
  type: "sale",
  invoiceDate: "2026-03-26T00:00:00.000Z",
  dueDate: "2026-04-10T00:00:00.000Z",
  lineItems: [
    {
      itemName: "Basmati Rice 25kg",
      quantity: "20.000",    // 20 bags
      unitPrice: "1250.00",  // ₹1,250 per bag
      taxPercent: "5.00",    // GST 5% — HSN 1006
      discountPercent: "0.00",
      itemId: "basmati-rice-item-uuid",
    },
  ],
  notes: "Delivery to warehouse on 28th. NEFT payment preferred.",
});

console.log("Created:", invoice.invoiceNumber); // "BB-14822"
console.log("Total:  ", invoice.totalAmount);   // "26250.00" (₹25,000 + ₹1,250 GST)`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/invoice.create",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "partyId": "gupta-enterprises-party-uuid",
        "type": "sale",
        "invoiceDate": "2026-03-26T00:00:00.000Z",
        "dueDate": "2026-04-10T00:00:00.000Z",
        "lineItems": [
            {
                "itemName": "Basmati Rice 25kg",
                "quantity": "20.000",
                "unitPrice": "1250.00",
                "taxPercent": "5.00",   # GST 5% — HSN 1006
                "discountPercent": "0.00",
            },
        ],
        "notes": "Delivery to warehouse on 28th. NEFT payment preferred.",
    }},
)
invoice = resp.json()["result"]["data"]["json"]
print("Created:", invoice["invoiceNumber"])  # "BB-14822"
print("Total:  ", invoice["totalAmount"])    # "26250.00"`,
      },
      gotchas: [
        "All monetary values (`quantity`, `unitPrice`, `taxPercent`, etc.) must be passed as strings, not numbers. The API enforces `NUMERIC(15,2)` precision.",
        "Invoice number is auto-generated — you cannot set it manually. Use `business.updateSequenceNumber` to adjust the counter.",
        "Stock is updated atomically in the same transaction as invoice creation. If stock update fails, the invoice is not created.",
        "`status` is always `draft` on creation. Use `invoice.updateStatus` to advance the lifecycle. The `adjusted` status is computed automatically when linked credit notes or sales returns fully cover the invoice amount — do not set it manually.",
        "Tax percent is validated to be ≤ 56% (the maximum GST rate including cess).",
        "Requires `Invoice:create` permission.",
        "`warehouseId` is saved on the invoice; `null`/omitted means \"the business default\" and `invoice.getById` then reports the warehouse the movements actually used.",
        "Composition-scheme businesses get BAD_REQUEST for inter-state sales (party state code differs from the business's).",
      ],
      relatedEndpoints: ["invoice-update", "invoice-update-status", "party-list", "item-list"],
    },
    {
      id: "invoice-update-status",
      method: "mutation",
      path: "invoice.updateStatus",
      title: "Update Invoice Status",
      description: "Change the lifecycle status of an invoice. Status transitions are not enforced by the API — any status can be set, but the UI follows the logical flow: draft → unfulfilled → sent → paid.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Invoice ID" },
        { name: "status", type: "enum", required: true, description: "New status. Note: `adjusted` is a computed status set automatically when credit notes or sales returns fully cover an invoice — do not set it manually.", enumValues: ["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled", "adjusted"] },
      ],
      output: {
        description: "Updated invoice object.",
        example: {
          id: "inv-uuid",
          invoiceNumber: "INV-00042",
          status: "sent",
          updatedAt: "2024-03-16T11:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/invoice.updateStatus \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"inv-uuid","status":"sent"}}'`,
        javascript: `await trpc.invoice.updateStatus.mutate({
  id: "inv-uuid",
  status: "sent",
});`,
        python: `httpx.post(
    "${API_BASE_URL}/api/trpc/invoice.updateStatus",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "inv-uuid", "status": "sent"}},
)`,
      },
      gotchas: [
        "Setting status to `paid` manually does NOT record a payment transaction. Use `payment.create` to record actual payments, which automatically updates `amountPaid` and advances status.",
        "Moving to `cancelled` returns the invoice's stock; moving out of `cancelled` takes it out again (subject to the negative-stock policy). Cancelling a purchase invoice also reverses its available/blocked ITC ledger entries.",
        "Requires `Invoice:update` permission. An audit log entry records the from/to status.",
      ],
    },
    {
      id: "invoice-delete",
      method: "mutation",
      path: "invoice.delete",
      title: "Delete Invoice",
      description: "Soft-delete an invoice. The record is not physically removed — `deletedAt` is set and `status` is changed to `cancelled`. Requires `admin` role. Users with `seller_manager` role can only delete unpaid invoices created within the last 2 hours.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Invoice ID to delete" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/invoice.delete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"inv-uuid"}}'`,
        javascript: `await trpc.invoice.delete.mutate({ id: "inv-uuid" });`,
        python: `httpx.post(
    "${API_BASE_URL}/api/trpc/invoice.delete",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "inv-uuid"}},
)`,
      },
      gotchas: [
        "This is a soft delete — the invoice remains in the database with `deletedAt` set. It will not appear in `invoice.list` results.",
        "Paid invoices cannot be deleted by `seller_manager` role. An `admin` or `owner` can delete any invoice.",
        "Deleting an invoice reverses its stock movements (a deleted invoice holds no stock) and, for purchase invoices, reverses available/blocked ITC ledger entries.",
        "Deleting an unknown or already-deleted invoice returns `{ success: true }` rather than NOT_FOUND.",
        "An audit log entry is created for every deletion.",
      ],
    },
    {
      id: "invoice-last-delivery-method",
      method: "query",
      path: "invoice.lastDeliveryMethod",
      title: "Get Last Delivery Method",
      description: "Returns the `deliveryMethod` from the most recent sale invoice for a given party. Used by the invoice form to auto-select the delivery method when creating a repeat invoice, reducing re-entry friction. Returns `\"self_pickup\"` if the party has no prior sale invoices.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "partyId", type: "string (UUID)", required: true, description: "The party whose last sale invoice delivery method should be returned." },
      ],
      output: {
        description: "The bare delivery method string (not wrapped in an object) from the party's most recent sale invoice by invoice date, or `\"self_pickup\"` when there is none.",
        example: "courier",
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/invoice.lastDeliveryMethod?input=%7B%22json%22%3A%7B%22partyId%22%3A%22party-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const deliveryMethod = await trpc.invoice.lastDeliveryMethod.query({
  partyId: "party-uuid",
});
// Use as the default value in the invoice form
// "self_pickup" if no prior invoices exist for this party`,
        python: `import httpx, urllib.parse, json

params = urllib.parse.urlencode({
    "input": json.dumps({"json": {"partyId": "party-uuid"}})
})
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/invoice.lastDeliveryMethod?{params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
result = resp.json()["result"]["data"]["json"]
delivery_method = result  # "self_pickup" if no prior invoices`,
      },
      gotchas: [
        "Only sale invoices are considered — purchase invoices are excluded.",
        "Returns `self_pickup` (not null, not an error) when no prior invoices exist. Cancelled and deleted invoices are not skipped.",
        "No `requireCan` permission check is applied — any member of the business can call it.",
        "The returned value is a built-in method from the `deliveryMethods` list exported from `@fintranzact/shared` (`self_pickup`, `hand_delivery`, `courier`, `bus`, `transport`, `post`) or the id of one of the business's custom methods from `business.customShippingMethods`.",
      ],
      relatedEndpoints: ["invoice-create"],
    },
    {
      id: "invoice-update",
      method: "mutation",
      path: "invoice.update",
      title: "Update Invoice",
      description: "Edit an existing sale or purchase invoice. Only the fields you send are changed. Sending `lineItems` replaces all lines, re-posts only the stock difference to the invoice's warehouse and recalculates subtotal, tax, discount and total; header-only edits (party, dates, notes, charges, round-off) leave the lines and totals alone. Pass `warehouseId` together with `lineItems` to move the invoice's stock to another warehouse (`null` = the business's default warehouse for sales/purchases). Runs in one transaction with the invoice row locked.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Invoice to update" },
        { name: "partyId", type: "string (UUID)", required: false, description: "Change the customer/supplier (must belong to this business)" },
        { name: "invoiceDate", type: "string (ISO 8601)", required: false, description: "New invoice date" },
        { name: "dueDate", type: "string (ISO 8601) | null", required: false, description: "New due date; `null` clears it" },
        { name: "notes", type: "string | null", required: false, description: "Notes (max 2000 chars); `null` clears" },
        { name: "termsAndConditions", type: "string | null", required: false, description: "T&C text (max 2000 chars); `null` clears" },
        { name: "charges", type: "array", required: false, description: "Replaces user-entered charges (`{label, amount}`). Shipment-linked charges (with `shipmentId`) already on the invoice are kept and cannot be edited here; `additionalCharges` is recomputed." },
        { name: "invoiceDiscount", type: "string (decimal)", required: false, description: "Invoice-level discount (amount or percent). Only applied when `lineItems` is also sent." },
        { name: "invoiceDiscountType", type: "enum", required: false, description: "How to read `invoiceDiscount`. Falls back to `amount` when omitted during a line-item recalculation.", enumValues: ["amount", "percent"] },
        { name: "roundOff", type: "string (decimal)", required: false, description: "Round-off adjustment (can be negative)" },
        { name: "lineItems", type: "array", required: false, description: "Full replacement set of lines (min 1). Same shape as `invoice.create` line items (`itemName` required, `quantity`, `unitPrice`, optional `itemId`, `variantId`, `taxPercent`, `discountPercent`, `selectedUnit`, `conversionFactor`, `description`)." },
        { name: "warehouseId", type: "string (UUID) | null", required: false, description: "Warehouse the goods go out of (sale) or come into (purchase). Changing it requires `lineItems` in the same call; `null` resets to the default warehouse." },
      ],
      output: {
        description: "The updated invoice row (without line items or party — fetch with `invoice.getById` for the full view).",
        example: {
          id: "inv-uuid",
          invoiceNumber: "INV-00043",
          businessId: "biz-uuid",
          partyId: "party-uuid",
          type: "sale",
          documentType: "invoice",
          status: "sent",
          invoiceDate: "2026-09-12T00:00:00.000Z",
          dueDate: "2026-09-27T00:00:00.000Z",
          subtotal: "30000.00",
          taxAmount: "1500.00",
          discountAmount: "0.00",
          additionalCharges: "0.00",
          roundOff: "0.00",
          totalAmount: "31500.00",
          amountPaid: "10000.00",
          warehouseId: "warehouse-uuid-bhiwandi",
          notes: "Dispatch from Bhiwandi godown.",
          updatedAt: "2026-09-13T08:20:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/invoice.update \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "id": "inv-uuid",
      "warehouseId": "warehouse-uuid-bhiwandi",
      "lineItems": [
        { "itemId": "basmati-rice-item-uuid", "itemName": "Basmati Rice 25kg", "quantity": "24.000", "unitPrice": "1250.00", "taxPercent": "5.00" }
      ],
      "notes": "Dispatch from Bhiwandi godown."
    }
  }'`,
        javascript: `// Header-only edit
await trpc.invoice.update.mutate({ id: "inv-uuid", dueDate: "2026-09-27T00:00:00.000Z" });

// Replace lines and move stock to another warehouse
const updated = await trpc.invoice.update.mutate({
  id: "inv-uuid",
  warehouseId: "warehouse-uuid-bhiwandi",
  lineItems: [
    {
      itemId: "basmati-rice-item-uuid",
      itemName: "Basmati Rice 25kg",
      quantity: "24.000",
      unitPrice: "1250.00",
      taxPercent: "5.00",
    },
  ],
});
console.log(updated.totalAmount); // "31500.00"`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/invoice.update",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {
        "id": "inv-uuid",
        "lineItems": [{
            "itemId": "basmati-rice-item-uuid",
            "itemName": "Basmati Rice 25kg",
            "quantity": "24.000",
            "unitPrice": "1250.00",
            "taxPercent": "5.00",
        }],
    }},
)`,
      },
      gotchas: [
        "Requires `Invoice:update` permission.",
        "NOT_FOUND \"Invoice not found\" if the invoice is not in the active business; BAD_REQUEST \"Cannot edit a paid invoice. Remove payments first.\" for paid invoices.",
        "BAD_REQUEST \"Send the invoice lines to change its warehouse\" when `warehouseId` differs from the stored one but `lineItems` is missing.",
        "BAD_REQUEST when `partyId`, an `itemId` or a `variantId` does not belong to this business. Soft-deleted items are allowed so historical invoices stay editable.",
        "Stock is enforced: the business's negative-stock policy applies to the re-posted difference, and a blocked shortfall rolls back the whole edit.",
        "`status` and `amountPaid` are not recalculated — if the new total drops below what has been paid, adjust payments/status yourself.",
        "Unlike `invoice.create`, the edit does not re-check the composition-scheme inter-state rule and does not rebuild the purchase ITC ledger entry.",
        "`invoiceDiscount` / `invoiceDiscountType` are ignored unless `lineItems` is sent. When lines are sent without a discount, the stored discount amount is re-applied as a flat amount.",
        "An audit log entry (`invoice.update`) is written.",
      ],
      relatedEndpoints: ["invoice-get-by-id", "invoice-create", "invoice-update-status"],
    },
  ],
};
