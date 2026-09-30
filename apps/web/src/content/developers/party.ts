import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

export const partyEndpoints: EndpointGroup = {
  id: "parties",
  title: "Parties",
  description: "Manage customers and suppliers (collectively called 'parties'). Each party belongs to a business and can have an opening balance, credit limit, GSTIN, and bank details. The party ledger balance is calculated dynamically from invoice and payment records.",
  endpoints: [
    {
      id: "party-list",
      method: "query",
      path: "party.list",
      title: "List Parties",
      description: "Paginated list of parties for the active business. Supports filtering by type (customer/supplier), balance status (outstanding/overdue), search by name, and category.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "type", type: "enum", required: false, description: "Restrict to customers or suppliers", enumValues: ["customer", "supplier"] },
        { name: "filter", type: "enum", required: false, description: "Filter parties by type or balance status", enumValues: ["all", "customer", "supplier", "outstanding", "overdue"] },
        { name: "search", type: "string", required: false, description: "Search by party name (case-insensitive)" },
        { name: "category", type: "string", required: false, description: "Filter by category label" },
        { name: "sortBy", type: "enum", required: false, description: "Sort column", enumValues: ["name", "balance"] },
        { name: "sortDir", type: "enum", required: false, description: "Sort direction", enumValues: ["asc", "desc"] },
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page (1–100)", default: "20" },
      ],
      output: {
        description: "Paginated party list.",
        example: {
          data: [
            {
              id: "party-uuid",
              name: "Gupta Enterprises",
              type: "customer",
              phone: "9876543210",
              email: "accounts@guptaenterprises.in",
              gstin: "07AABCG5432M1Z3",
              balance: "34200.00",
              city: "Delhi",
              state: "Delhi",
              category: "wholesale",
              creditPeriodDays: 30,
              creditLimit: "200000.00",
            },
          ],
          total: 48,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/party.list?input=%7B%22json%22%3A%7B%22filter%22%3A%22customer%22%2C%22page%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, total } = await trpc.party.list.query({
  filter: "customer",
  search: "acme",
  page: 1,
  limit: 20,
});`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"filter": "customer", "page": 1}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/party.list?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "The `outstanding` filter uses a sub-query: parties where `openingBalance + sum(unpaid invoice amounts) > 0`.",
        "The `overdue` filter uses a sub-query: parties with at least one invoice in `overdue` status.",
        "The legacy `type` parameter still works but `filter` is preferred for new integrations.",
      ],
    },
    {
      id: "party-get-by-id",
      method: "query",
      path: "party.getById",
      title: "Get Party",
      description: "Fetch a party by ID (every stored column, including compliance fields and `priceLevelId`) with their calculated ledger balance. The balance is `openingBalance` plus the unpaid amount (`totalAmount - amountPaid`) of every non-cancelled, non-deleted document, where credit notes, sales returns and purchase returns count negative; orders (purchase/sales orders, GRNs) are excluded.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Party ID" },
      ],
      output: {
        description: "Party object with calculated balance.",
        example: {
          id: "party-uuid",
          name: "Acme Corp",
          type: "customer",
          phone: "9876543210",
          gstin: "27AADCB2230M1ZP",
          openingBalance: "5000.00",
          billingAddress: "101 Business Park, Andheri East",
          city: "Mumbai",
          state: "Maharashtra",
          stateCode: "27",
          pincode: "400069",
          creditPeriodDays: 30,
          creditLimit: "100000.00",
          priceLevelId: "price-level-uuid-wholesale",
          isMsme: false,
          gstinStatus: "active",
          balance: "20750.00",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/party.getById?input=%7B%22json%22%3A%7B%22id%22%3A%22party-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const party = await trpc.party.getById.query({ id: "party-uuid" });

if (party) {
  console.log(\`Balance: ₹\${party.balance}\`);
}`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "party-uuid"}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/party.getById?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Requires `Party:read` permission. Returns `null` when the party is not in the active business.",
        "`priceLevelId` is null when sales to the party use the business's default price level.",
      ],
    },
    {
      id: "party-create",
      method: "mutation",
      path: "party.create",
      title: "Create Party",
      description: "Create a new customer or supplier. GSTIN is validated with the official 15-character format regex; when `pan` or `stateCode` is left blank they are filled from the GSTIN. Opening balance represents the amount already owed before using Fintranzact. Optionally assign a price level so sales to this party pick up its prices.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "type", type: "enum", required: true, description: "Party type", enumValues: ["customer", "supplier"] },
        { name: "name", type: "string", required: true, description: "Display name (1–200 chars)" },
        { name: "phone", type: "string", required: false, description: "Phone number (max 15 chars)" },
        { name: "email", type: "string", required: false, description: "Email address" },
        { name: "gstin", type: "string", required: false, description: "GST Identification Number (15-char format: `27AADCB2230M1ZP`)" },
        { name: "pan", type: "string", required: false, description: "PAN number (10-char format: `AADCB2230M`)" },
        { name: "billingAddress", type: "string", required: false, description: "Billing address (max 500 chars)" },
        { name: "shippingAddress", type: "string", required: false, description: "Shipping address (max 500 chars)" },
        { name: "city", type: "string", required: false, description: "City (max 100 chars)" },
        { name: "state", type: "string", required: false, description: "State name (max 100 chars)" },
        { name: "stateCode", type: "string", required: false, description: "2-digit GST state code (e.g. `27` for Maharashtra)" },
        { name: "pincode", type: "string", required: false, description: "PIN code (max 10 chars)" },
        { name: "openingBalance", type: "string (decimal)", required: false, description: "Opening balance owed (can be negative for credit)", default: "0" },
        { name: "category", type: "string", required: false, description: "Custom category label (max 100 chars)" },
        { name: "creditPeriodDays", type: "number", required: false, description: "Standard credit period in days (0–365)" },
        { name: "creditLimit", type: "string (decimal)", required: false, description: "Maximum credit limit" },
        { name: "contactPersonName", type: "string", required: false, description: "Contact person name (max 200 chars)" },
        { name: "bankAccountNumber", type: "string", required: false, description: "Bank account number for payments (max 34 chars)" },
        { name: "bankIfsc", type: "string", required: false, description: "Bank IFSC code (max 11 chars)" },
        { name: "bankName", type: "string", required: false, description: "Bank name (max 200 chars)" },
        { name: "additionalShippingAddresses", type: "array", required: false, description: "Up to 20 extra delivery locations: `{label?, address, city?, state?, stateCode?, pincode?}`" },
        { name: "contactPersonDob", type: "string (ISO datetime)", required: false, description: "Contact person's date of birth" },
        { name: "legalName", type: "string", required: false, description: "Legal name as registered for GST (max 200 chars)" },
        { name: "tradeName", type: "string", required: false, description: "Trade name (max 200 chars)" },
        { name: "gstRegistrationType", type: "enum", required: false, description: "Party's GST registration type", enumValues: ["regular", "composition", "unregistered", "sez", "overseas", "uin"] },
        { name: "constitution", type: "enum", required: false, description: "Constitution of the party", enumValues: ["proprietorship", "partnership", "llp", "private_company", "public_company", "huf", "trust", "society", "government", "other"] },
        { name: "gstinStatus", type: "enum", required: false, description: "GSTIN status from the portal (e.g. from `party.lookupGstin`)", enumValues: ["active", "cancelled", "suspended", "inactive"] },
        { name: "gstinVerifiedAt", type: "string (ISO datetime)", required: false, description: "When the GSTIN was last verified (`verifiedAt` from `party.lookupGstin`)" },
        { name: "isMsme", type: "boolean", required: false, description: "Supplier is a registered MSME (drives `reports.msmePayables`)" },
        { name: "udyamNumber", type: "string", required: false, description: "Udyam registration number, e.g. `UDYAM-MH-26-0012345` (or empty string)" },
        { name: "msmeCategory", type: "enum", required: false, description: "MSME category", enumValues: ["micro", "small", "medium"] },
        { name: "tdsSection", type: "string (enum)", required: false, description: "Default TDS section code for payments to this party (one of the codes in `tdsSections` from `@fintranzact/shared`)" },
        { name: "priceLevelId", type: "string (UUID) | null", required: false, description: "Price level used for sales to this party; null/omitted = the business default. Must belong to this business." },
      ],
      output: {
        description: "Created party object.",
        example: {
          id: "party-uuid",
          businessId: "biz-uuid",
          name: "Acme Corp",
          type: "customer",
          phone: "9876543210",
          gstin: "27AADCB2230M1ZP",
          openingBalance: "0.00",
          pan: "AADCB2230M",
          stateCode: "27",
          priceLevelId: null,
          createdAt: "2024-03-16T10:30:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/party.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "type": "customer",
      "name": "Acme Corp",
      "phone": "9876543210",
      "gstin": "27AADCB2230M1ZP",
      "state": "Maharashtra",
      "stateCode": "27",
      "creditPeriodDays": 30
    }
  }'`,
        javascript: `const party = await trpc.party.create.mutate({
  type: "customer",
  name: "Acme Corp",
  phone: "9876543210",
  gstin: "27AADCB2230M1ZP",
  state: "Maharashtra",
  stateCode: "27",
  creditPeriodDays: 30,
  openingBalance: "5000.00",
});`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/party.create",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {
        "type": "customer",
        "name": "Acme Corp",
        "phone": "9876543210",
        "gstin": "27AADCB2230M1ZP",
        "creditPeriodDays": 30,
    }},
)`,
      },
      gotchas: [
        "GSTIN is validated against the regex `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$`. Pass an empty string `\"\"` to clear it.",
        "`openingBalance` represents money already owed before starting to use Fintranzact. Use a negative value if the party has a credit balance.",
        "An audit log entry is created for party creation.",
        "BAD_REQUEST \"Price level not found\" when `priceLevelId` is not a price level of this business.",
        "A PAN or state code that contradicts the GSTIN is accepted (the UI only warns).",
        "Requires `Party:create` permission.",
      ],
      relatedEndpoints: ["party-lookup-gstin", "party-update"],
    },
    {
      id: "party-update",
      method: "mutation",
      path: "party.update",
      title: "Update Party",
      description: "Partially update an existing party. `data` accepts every `party.create` field except `type` (all optional). Only provided fields are changed. Requires `member` role or above.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Party ID to update" },
        { name: "data.name", type: "string", required: false, description: "Updated name" },
        { name: "data.phone", type: "string", required: false, description: "Updated phone" },
        { name: "data.email", type: "string", required: false, description: "Updated email" },
        { name: "data.gstin", type: "string", required: false, description: "Updated GSTIN" },
        { name: "data.billingAddress", type: "string", required: false, description: "Updated billing address" },
        { name: "data.city", type: "string", required: false, description: "Updated city" },
        { name: "data.state", type: "string", required: false, description: "Updated state" },
        { name: "data.creditPeriodDays", type: "number", required: false, description: "Updated credit period in days" },
        { name: "data.creditLimit", type: "string (decimal)", required: false, description: "Updated credit limit" },
        { name: "data.priceLevelId", type: "string (UUID) | null", required: false, description: "Assign a price level; `null` reverts to the business default" },
        { name: "data.*", type: "various", required: false, description: "Any other create field (addresses, bank details, GST/MSME/TDS compliance fields, `openingBalance`, …). `type` cannot be changed." },
      ],
      output: {
        description: "Updated party object.",
        example: {
          id: "party-uuid",
          name: "Acme Corp Pvt Ltd",
          phone: "9876543211",
          updatedAt: "2026-04-08T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/party.update \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"party-uuid","data":{"name":"Acme Corp Pvt Ltd","creditLimit":"500000.00"}}}'`,
        javascript: `const updated = await trpc.party.update.mutate({
  id: "party-uuid",
  data: {
    name: "Acme Corp Pvt Ltd",
    creditLimit: "500000.00",
    creditPeriodDays: 45,
  },
});`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/party.update",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "party-uuid", "data": {"name": "Acme Corp Pvt Ltd"}}},
)`,
      },
      gotchas: [
        "Requires `Party:update` permission. BAD_REQUEST \"Price level not found\" for a price level of another business.",
        "A new `gstin` fills `pan` and `stateCode` only where the party has none yet, and clears `gstinStatus` / `gstinVerifiedAt` when the GSTIN actually changed (unless you send a new `gstinStatus`).",
        "An unknown party ID currently fails with an internal error rather than NOT_FOUND.",
        "An audit log entry (`party.update`) is written.",
      ],
      relatedEndpoints: ["party-get-by-id", "party-lookup-gstin"],
    },
    {
      id: "party-delete",
      method: "mutation",
      path: "party.delete",
      title: "Delete Party",
      description: "Permanently delete a party record. Requires `admin` role. Returns NOT_FOUND if the party does not exist in the active business.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Party ID to delete" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/party.delete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"party-uuid"}}'`,
        javascript: `await trpc.party.delete.mutate({ id: "party-uuid" });`,
        python: `import httpx

httpx.post(
    "${API_BASE_URL}/api/trpc/party.delete",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "party-uuid"}},
)`,
      },
      gotchas: [
        "Returns NOT_FOUND if the party does not exist in the active business.",
        "Deletion is permanent. Linked invoices and payments are NOT cascade-deleted.",
        "Requires `admin` role. Members cannot delete parties.",
      ],
    },
    {
      id: "party-top-items",
      method: "query",
      path: "party.topItems",
      title: "Top Items",
      description: "Returns the top 5 items sold to a specific party, ranked by total quantity. Includes total quantity, total amount, and number of distinct invoices per item.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "partyId", type: "string (UUID)", required: true, description: "Party ID" },
      ],
      output: {
        description: "Array of top 5 items with aggregated sales data.",
        example: [
          { itemId: "item-uuid", itemName: "Premium Widget A", totalQuantity: "120.000", totalAmount: "159900.00", invoiceCount: 8 },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/party.topItems?input=%7B%22json%22%3A%7B%22partyId%22%3A%22party-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const topItems = await trpc.party.topItems.query({ partyId: "party-uuid" });
topItems.forEach(item => {
  console.log(item.itemName, "qty:", item.totalQuantity, "amount:", item.totalAmount);
});`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"partyId": "party-uuid"}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/party.topItems?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Only sale invoices (not purchases) are counted.",
        "Cancelled invoices are excluded.",
        "Limited to top 5 items by quantity.",
      ],
      relatedEndpoints: ["party-get-by-id"],
    },
    {
      id: "party-get-stats",
      method: "query",
      path: "party.getStats",
      title: "Get Party Stats",
      description: "Returns aggregate statistics for a party: total invoice count and total payment count.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Party ID" },
      ],
      output: {
        description: "Invoice and payment counts.",
        example: { invoiceCount: 24, paymentCount: 18 },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/party.getStats?input=%7B%22json%22%3A%7B%22id%22%3A%22party-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const stats = await trpc.party.getStats.query({ id: "party-uuid" });
console.log("Invoices:", stats.invoiceCount, "Payments:", stats.paymentCount);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "party-uuid"}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/party.getStats?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      relatedEndpoints: ["party-get-by-id"],
    },
    {
      id: "party-merge",
      method: "mutation",
      path: "party.merge",
      title: "Merge Parties",
      description: "Merge a source party into a target party. All invoices and payments from the source are reassigned to the target. Opening balances are summed. Missing fields on the target are filled from the source. The source party is deleted after merging.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "sourceId", type: "string (UUID)", required: true, description: "Party to merge from (will be deleted)" },
        { name: "targetId", type: "string (UUID)", required: true, description: "Party to merge into (will be kept)" },
      ],
      output: {
        description: "Success with the surviving party ID.",
        example: { success: true, mergedInto: "target-party-uuid" },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/party.merge \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"sourceId":"source-party-uuid","targetId":"target-party-uuid"}}'`,
        javascript: `const result = await trpc.party.merge.mutate({
  sourceId: "source-party-uuid",
  targetId: "target-party-uuid",
});
console.log("Merged into:", result.mergedInto);`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/party.merge",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"sourceId": "source-party-uuid", "targetId": "target-party-uuid"}},
)`,
      },
      gotchas: [
        "Returns BAD_REQUEST if sourceId equals targetId.",
        "Returns NOT_FOUND if either party does not exist in the active business.",
        "Invoices on the source party get a merge note appended to their notes field.",
        "The merge is atomic \u2014 if any step fails, no changes are applied.",
        "Opening balances are summed: `target.openingBalance + source.openingBalance`.",
      ],
    },
    {
      id: "party-ledger-report",
      method: "query",
      path: "party.ledgerReport",
      title: "Ledger Report",
      description: "Full ledger for a party with date range. Returns interleaved invoices, payments, credit notes, and sales returns sorted chronologically, with running balance, plus summary totals and closing balance. Credit notes and sales returns appear as credit entries that reduce the party's outstanding balance.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "partyId", type: "string (UUID)", required: true, description: "Party ID" },
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of date range" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of date range" },
        { name: "limit", type: "number", required: false, description: "Max entries (1\u20135000)", default: "1000" },
      ],
      output: {
        description: "Party details, chronological ledger entries with running balance, and summary.",
        example: {
          party: { name: "Acme Corp", type: "customer", openingBalance: "5000.00" },
          entries: [
            { date: "2026-03-01T00:00:00.000Z", type: "invoice", number: "INV-0042", description: "Sale Invoice", debit: "12500.00", credit: "0", status: "unpaid", documentId: "inv-uuid", runningBalance: "17500.00" },
          ],
          summary: { totalDebit: "12500.00", totalCredit: "0", closingBalance: "17500.00" },
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/party.ledgerReport?input=%7B%22json%22%3A%7B%22partyId%22%3A%22party-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const ledger = await trpc.party.ledgerReport.query({
  partyId: "party-uuid",
  fromDate: "2026-04-01T00:00:00.000Z",
  toDate: "2027-03-31T23:59:59.999Z",
});
console.log("Closing balance:", ledger?.summary.closingBalance);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"partyId": "party-uuid"}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/party.ledgerReport?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Returns `null` if the party is not found in the active business.",
        "Requires `Report:read` permission.",
        "For customers: invoice = debit (money owed), payment = credit, credit note / sales return = credit (reduces balance). For suppliers: reversed.",
        "Credit notes (`credit_note`) and sales returns (`sales_return`) linked to an invoice appear as separate credit entries in the ledger. The linked invoice's `totalAdjusted` reflects the cumulative offset.",
      ],
      relatedEndpoints: ["party-ledger-report-csv", "reports-party-statement"],
    },
    {
      id: "party-ledger-report-csv",
      method: "query",
      path: "party.ledgerReportCSV",
      title: "Ledger Report (CSV)",
      description: "Same data as `party.ledgerReport` but serialized as a downloadable CSV string. Includes an opening balance row and running balance per entry.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "partyId", type: "string (UUID)", required: true, description: "Party ID" },
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of date range" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of date range" },
        { name: "limit", type: "number", required: false, description: "Max entries (1\u20135000)", default: "1000" },
      ],
      output: {
        description: "CSV string and suggested filename.",
        example: {
          csv: "Date,Description,Document #,Debit,Credit,Balance\\n...",
          filename: "ledger_Acme_Corp_2026-04-01.csv",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/party.ledgerReportCSV?input=%7B%22json%22%3A%7B%22partyId%22%3A%22party-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const result = await trpc.party.ledgerReportCSV.query({ partyId: "party-uuid" });
if (result) {
  const blob = new Blob([result.csv], { type: "text/csv" });
  // trigger download with result.filename
}`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"partyId": "party-uuid"}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/party.ledgerReportCSV?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)
data = resp.json()["result"]["data"]["json"]
with open(data["filename"], "w") as f:
    f.write(data["csv"])`,
      },
      relatedEndpoints: ["party-ledger-report"],
    },
    {
      id: "party-tally-export",
      method: "query",
      path: "party.tallyExport",
      title: "Tally Export",
      description: "Generates a Tally-compatible CSV of all vouchers (sales invoices, purchase invoices, payments, expenses) for the business within a date range. Each row maps to a Tally voucher with debit/credit ledger assignments.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of date range" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of date range" },
        { name: "limit", type: "number", required: false, description: "Max vouchers (1\u20135000)", default: "1000" },
      ],
      output: {
        description: "CSV string, filename, row count, and preview of first 10 vouchers.",
        example: {
          csv: "Date,Vch Type,Vch No.,Debit Ledger,Credit Ledger,Amount\\n...",
          filename: "tally-export_2026-04-01.csv",
          rowCount: 142,
          preview: [
            { date: "01-04-2026", vchType: "Sales", vchNo: "INV-0042", debitLedger: "Sharma Electronics", creditLedger: "Sales Account", amount: "12500.00" },
          ],
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/party.tallyExport?input=%7B%22json%22%3A%7B%22fromDate%22%3A%222026-04-01T00%3A00%3A00.000Z%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const tally = await trpc.party.tallyExport.query({
  fromDate: "2026-04-01T00:00:00.000Z",
  toDate: "2027-03-31T23:59:59.999Z",
});
console.log("Vouchers:", tally.rowCount);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"fromDate": "2026-04-01T00:00:00.000Z"}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/party.tallyExport?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Requires `Report:read` permission.",
        "Dates in the CSV are formatted as DD-MM-YYYY for Tally compatibility.",
        "Payment modes map to ledger names: `cash` \u2192 'Cash', others \u2192 'Bank'.",
      ],
    },
    {
      id: "party-ledger",
      method: "query",
      path: "party.ledger",
      title: "Paginated Ledger",
      description: "Chronological UNION ALL of invoices, payments, credit notes, and sales returns for a party, with pagination and running balance computed via SQL window functions. Credit notes and sales returns reduce the running balance as credit entries. More efficient than `ledgerReport` for large ledgers.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "partyId", type: "string (UUID)", required: true, description: "Party ID" },
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Start of date range" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "End of date range" },
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page (1\u2013100)", default: "50" },
      ],
      output: {
        description: "Opening balance, paginated ledger entries with running balance, and total count.",
        example: {
          openingBalance: "5000.00",
          data: [
            { date: "2026-03-01T00:00:00.000Z", type: "invoice", documentNumber: "INV-0042", documentId: "inv-uuid", debit: "12500.00", credit: "0", status: "unpaid", runningBalance: "17500.00" },
          ],
          total: 48,
          page: 1,
          limit: 50,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/party.ledger?input=%7B%22json%22%3A%7B%22partyId%22%3A%22party-uuid%22%2C%22page%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const ledger = await trpc.party.ledger.query({
  partyId: "party-uuid",
  page: 1,
  limit: 50,
});
console.log("Opening balance:", ledger.openingBalance);
console.log("Total entries:", ledger.total);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"partyId": "party-uuid", "page": 1}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/party.ledger?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Returns NOT_FOUND if the party does not exist in the active business.",
        "Running balance is computed using SQL window functions \u2014 more efficient than in-memory calculation for large ledgers.",
        "Entries are sorted by date ascending, then by document number.",
      ],
      relatedEndpoints: ["party-ledger-report"],
    },
    {
      id: "party-lookup-gstin",
      method: "mutation",
      path: "party.lookupGstin",
      title: "Look Up GSTIN",
      description: "Fetch a taxpayer's registered details (legal and trade name, address, state, registration type and status) for a GSTIN from the GST system, using the business's e-invoice (IRP) credentials, so the party form can be pre-filled. When e-invoicing is not configured or is disabled, it returns `available: false` with only the values that can be derived from the GSTIN itself (PAN, state code, constitution). Nothing is saved — pass the returned fields (and `verifiedAt` as `gstinVerifiedAt`) to `party.create` / `party.update`.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "gstin", type: "string", required: true, description: "15-character GSTIN. Trimmed and upper-cased before validation against the GSTIN format." },
      ],
      output: {
        description: "Either `{ available: true, details, verifiedAt }` or `{ available: false, reason, derived }`. In `details`, `gstRegistrationType` is one of `regular`, `composition`, `sez`, `uin`, `overseas` (or null), `gstinStatus` one of `active`, `cancelled`, `suspended`, `inactive` (or null), `blocked` is true when the GSTIN is blocked for e-invoicing, and `registeredOn` / `cancelledOn` are passed through from the portal. `constitution` is derived from the PAN's 4th character.",
        example: {
          available: true,
          details: {
            gstin: "27AAPFU0939F1ZV",
            legalName: "UNIQUE TRADERS",
            tradeName: "Unique Traders",
            billingAddress: "Shop 12, Laxmi Market, Station Road, Dadar",
            city: "Dadar",
            stateCode: "27",
            pincode: "400014",
            pan: "AAPFU0939F",
            constitution: "partnership",
            gstRegistrationType: "regular",
            gstinStatus: "active",
            blocked: false,
            registeredOn: "2017-07-01",
            cancelledOn: null,
          },
          verifiedAt: "2026-09-30T06:12:45.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/party.lookupGstin \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"gstin":"27AAPFU0939F1ZV"}}'`,
        javascript: `const res = await trpc.party.lookupGstin.mutate({ gstin: "27aapfu0939f1zv" });
if (res.available) {
  form.set({ ...res.details, name: res.details.tradeName ?? res.details.legalName, gstinVerifiedAt: res.verifiedAt });
} else {
  console.info(res.reason);
  form.set({ pan: res.derived.pan, stateCode: res.derived.stateCode });
}`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/party.lookupGstin",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"gstin": "27AAPFU0939F1ZV"}},
)
result = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Requires `Party:create` permission. It is a mutation (POST) even though it only reads, because it calls the external IRP API.",
        "Needs an enabled e-invoice configuration with IRP credentials (`business.update` with `eInvoiceEnabled` and the e-invoice username/password). Without it you get `available: false` and a human-readable `reason`, not an error.",
        "IRP failures surface as BAD_REQUEST \"GSTIN lookup failed: …\" (e.g. invalid or unregistered GSTIN) or INTERNAL_SERVER_ERROR for retryable portal/network errors.",
        "Invalid GSTIN format fails input validation before any portal call.",
      ],
      relatedEndpoints: ["party-create", "party-update"],
    },
  ],
};
