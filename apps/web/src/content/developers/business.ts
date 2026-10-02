import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

export const businessEndpoints: EndpointGroup = {
  id: "businesses",
  title: "Businesses",
  description: "Manage business profiles within an organization (tenant). Each business is a separate entity with its own invoice numbering, GST details, and data isolation. Requires `owner` or `admin` role on the organization to create or modify businesses.",
  endpoints: [
    {
      id: "business-list",
      method: "query",
      path: "business.list",
      title: "List Businesses",
      description: "Return the businesses in the current organization that the caller is a member of (via `business_members`). Businesses the caller has not been added to are not returned. Requires a valid tenant session (the `x-tenant-id` header, set automatically by the SDK). The raw logo bytes are never included — fetch them from `GET /api/businesses/:id/logo`.",
      auth: "protected",
      input: [],
      output: {
        description: "Array of business objects.",
        example: [
          {
            id: "biz-uuid",
            name: "My Shop",
            legalName: "My Shop Pvt Ltd",
            gstin: "27AADCB2230M1ZP",
            pan: "AADCB2230M",
            phone: "9876543210",
            address: "123 MG Road",
            city: "Mumbai",
            state: "Maharashtra",
            invoicePrefix: "INV",
            nextInvoiceNumber: 43,
            currency: "INR",
            posEnabled: false,
            logoMimeType: "image/png",
            logoUpdatedAt: "2026-04-02T06:15:00.000Z",
          },
        ],
      },
      codeExamples: {
        curl: `curl ${API_BASE_URL}/api/trpc/business.list \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const businesses = await trpc.business.list.query();
// Set active business for subsequent calls
trpc.setBusinessId(businesses[0].id);`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/business.list",
    headers={"Authorization": f"Bearer {session_token}"},
)
businesses = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Only businesses the caller is a member of are returned. Tenant owners/admins add people to a business with `business.addMember`.",
        "Legacy businesses created before per-business membership existed are back-filled automatically on the first call.",
        "Carrier credentials are decrypted in the response. `logoData` is stripped; use the REST image endpoint to display the logo.",
      ],
      relatedEndpoints: ["business-members", "business-get-by-id"],
    },
    {
      id: "business-create",
      method: "mutation",
      path: "business.create",
      title: "Create Business",
      description: "Create a new business within the organization. Automatically creates a default Cash account for the business. Requires `owner` or `admin` role.",
      auth: "protected",
      input: [
        { name: "name", type: "string", required: true, description: "Business trading name (1–200 chars)" },
        { name: "legalName", type: "string", required: false, description: "Legal entity name if different (max 200 chars)" },
        { name: "businessType", type: "enum", required: false, description: "Constitution of the business", default: "proprietorship", enumValues: ["proprietorship", "partnership", "llp", "private_limited", "public_limited", "one_person_company", "huf", "trust", "society", "other"] },
        { name: "pan", type: "string", required: true, description: "PAN number (`AADCB2230M` format)" },
        { name: "phone", type: "string", required: true, description: "Contact phone (1–15 chars)" },
        { name: "email", type: "string", required: false, description: "Business email (valid email or empty string)" },
        { name: "address", type: "string", required: true, description: "Business address (1–500 chars)" },
        { name: "addressLine1", type: "string", required: false, description: "Structured address line 1" },
        { name: "addressLine2", type: "string", required: false, description: "Structured address line 2" },
        { name: "landmark", type: "string", required: false, description: "Landmark" },
        { name: "countryOfOperations", type: "string", required: false, description: "Country of operations" },
        { name: "financialYearStartDate", type: "string (YYYY-MM-DD)", required: false, description: "First day of the financial year. Its month is also stored as `financialYearStart` (1–12) for GST/dashboard FY maths." },
        { name: "gstRegistrationType", type: "enum", required: false, description: "GST registration status", default: "unregistered", enumValues: ["regular", "composition", "unregistered"] },
        { name: "gstin", type: "string", required: false, description: "GSTIN if registered (validated 15-char format, or empty string)" },
        { name: "city", type: "string", required: false, description: "City (max 100 chars)" },
        { name: "state", type: "string", required: false, description: "State name (max 100 chars)" },
        { name: "stateCode", type: "string", required: false, description: "2-digit GST state code (max 2 chars)" },
        { name: "pincode", type: "string", required: false, description: "PIN code (max 10 chars)" },
        { name: "tan", type: "string", required: false, description: "TAN (max 10 chars)" },
        { name: "deductorType", type: "string", required: false, description: "TDS deductor type (max 50 chars)" },
        { name: "responsiblePersonName", type: "string", required: false, description: "TDS responsible person name (max 200 chars)" },
        { name: "responsiblePersonPan", type: "string", required: false, description: "Responsible person's PAN (PAN format or empty string)" },
        { name: "responsiblePersonDesignation", type: "string", required: false, description: "Responsible person's designation (max 100 chars)" },
        { name: "cin", type: "string", required: false, description: "Company Identification Number (max 21 chars)" },
        { name: "llpin", type: "string", required: false, description: "LLP Identification Number (max 7 chars)" },
        { name: "udyamNumber", type: "string", required: false, description: "Udyam (MSME) registration number (max 30 chars)" },
        { name: "iecCode", type: "string", required: false, description: "Import Export Code (max 10 chars)" },
        { name: "lutArn", type: "string", required: false, description: "LUT ARN for zero-rated exports (max 100 chars)" },
        { name: "eInvoiceEnabled", type: "boolean", required: false, description: "Enable e-invoicing (IRP)", default: "false" },
        { name: "eWayBillEnabled", type: "boolean", required: false, description: "Enable e-way bills", default: "false" },
        { name: "eInvoiceUsername", type: "string", required: false, description: "IRP taxpayer API username (max 100). Stored encrypted in `e_invoice_configs` (not on the business row), only when both username and password are given and a GSTIN is set." },
        { name: "eInvoicePassword", type: "string", required: false, description: "IRP taxpayer API password (max 200). Encrypted at rest." },
        { name: "eWayBillUsername", type: "string", required: false, description: "E-Way Bill portal API username (max 100). Stored encrypted in `eway_bill_configs`." },
        { name: "eWayBillPassword", type: "string", required: false, description: "E-Way Bill portal API password (max 200). Encrypted at rest." },
        { name: "assesseeOfOtherTerritory", type: "boolean", required: false, description: "Registered in 'Other Territory' (GST state code 97). When true the server forces `stateCode` to `97` and `state` to `Other Territory`.", default: "false" },
        { name: "gstReturnPeriodicity", type: "enum", required: false, description: "GSTR-1/3B filing frequency", default: "monthly", enumValues: ["monthly", "quarterly"] },
        { name: "eWayBillThreshold", type: "number | null", required: false, description: "Invoice value above which an e-way bill is expected (non-negative; strings are coerced)" },
        { name: "invoicePrefix", type: "string", required: false, description: "Prefix for invoice numbers (1–10 chars)", default: "INV" },
        { name: "paymentPrefix", type: "string", required: false, description: "Prefix for payment numbers (1–10 chars)", default: "PAY" },
        { name: "quotationPrefix", type: "string", required: false, description: "Prefix for quotation numbers", default: "QTN" },
        { name: "creditNotePrefix", type: "string", required: false, description: "Prefix for credit note numbers", default: "CN" },
        { name: "deliveryChallanPrefix", type: "string", required: false, description: "Prefix for delivery challans", default: "DC" },
        { name: "proformaPrefix", type: "string", required: false, description: "Prefix for proforma invoices", default: "PI" },
        { name: "debitNotePrefix", type: "string", required: false, description: "Prefix for debit notes", default: "DN" },
        { name: "salesReturnPrefix", type: "string", required: false, description: "Prefix for sales returns", default: "SR" },
        { name: "purchaseReturnPrefix", type: "string", required: false, description: "Prefix for purchase returns", default: "PR" },
        { name: "purchaseOrderPrefix", type: "string", required: false, description: "Prefix for purchase orders", default: "PO" },
        { name: "salesOrderPrefix", type: "string", required: false, description: "Prefix for sales orders", default: "SO" },
        { name: "goodsReceiptNotePrefix", type: "string", required: false, description: "Prefix for goods receipt notes", default: "GRN" },
        { name: "currency", type: "string", required: false, description: "3-letter ISO 4217 currency code", default: "INR" },
        { name: "annualTurnover", type: "number | null", required: false, description: "Annual turnover in rupees — drives HSN digit enforcement and the e-invoicing threshold" },
        { name: "defaultRoundOff", type: "boolean", required: false, description: "Round invoice totals to the nearest rupee by default", default: "true" },
        { name: "defaultTermsAndConditions", type: "string | null", required: false, description: "Default terms printed on documents (max 2000 chars)" },
      ],
      output: {
        description: "Created business object.",
        example: {
          id: "biz-uuid",
          name: "My Shop",
          pan: "AADCB2230M",
          invoicePrefix: "INV",
          nextInvoiceNumber: 1,
          currency: "INR",
          createdAt: "2024-03-16T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/business.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{
    "json": {
      "name": "My Shop",
      "pan": "AADCB2230M",
      "phone": "9876543210",
      "address": "123 MG Road, Mumbai",
      "gstRegistrationType": "regular",
      "gstin": "27AADCB2230M1ZP",
      "state": "Maharashtra",
      "stateCode": "27",
      "invoicePrefix": "INV"
    }
  }'`,
        javascript: `const business = await trpc.business.create.mutate({
  name: "My Shop",
  pan: "AADCB2230M",
  phone: "9876543210",
  address: "123 MG Road, Mumbai",
  gstRegistrationType: "regular",
  gstin: "27AADCB2230M1ZP",
  state: "Maharashtra",
  stateCode: "27",
});`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/business.create",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {
        "name": "My Shop",
        "pan": "AADCB2230M",
        "phone": "9876543210",
        "address": "123 MG Road, Mumbai",
        "gstRegistrationType": "regular",
        "gstin": "27AADCB2230M1ZP",
    }},
)`,
      },
      gotchas: [
        "Only `owner` or `admin` organization roles can create businesses (FORBIDDEN \"Only admins can manage businesses\" otherwise).",
        "Subject to the plan's `maxBusinesses` limit — returns FORBIDDEN when the organization is at its limit (check first with `business.canCreate`).",
        "Runs in one transaction: the creator is added as a business `admin`, and a default \"Main\" warehouse, a Cash bank account, a \"Walk-in Customer\" party and the default chart of accounts are seeded. E-invoice / e-way bill credentials (if supplied) are stored encrypted in their own config tables.",
        "An audit log entry (`business.create`) is written.",
        "Invoice numbering starts at 1. Use `business.updateSequenceNumber` to set a custom starting number.",
      ],
    },
    {
      id: "business-can-create",
      method: "query",
      path: "business.canCreate",
      title: "Can Create Business",
      description: "Check whether the current organization (tenant) can create another business based on its plan limits. Returns `true` if the limit has not been reached, `false` otherwise. Use this to conditionally show/hide the 'Create Business' button.",
      auth: "protected",
      input: [],
      output: {
        description: "Boolean indicating whether a new business can be created.",
        example: true,
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/business.canCreate" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const canCreate = await trpc.business.canCreate.query();
if (!canCreate) {
  // Hide or disable the "Create Business" button
  console.log("Plan limit reached");
}`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/business.canCreate",
    headers={"Authorization": f"Bearer {session_token}"},
)
can_create = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Returns `true` for paid plans with unlimited businesses.",
        "The check is against the tenant's plan limits, not individual user permissions.",
      ],
      relatedEndpoints: ["business-create"],
    },
    {
      id: "business-get-by-id",
      method: "query",
      path: "business.getById",
      title: "Get Business",
      description: "Fetch a single business by ID within the current tenant. The caller must be a member of the business. Carrier credentials are decrypted automatically in the response; raw logo bytes are omitted (use `GET /api/businesses/:id/logo`).",
      auth: "protected",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Business ID" },
      ],
      output: {
        description: "Business object with decrypted carrier credentials (all columns except `logoData`), or null if not found.",
        example: {
          id: "biz-uuid",
          name: "My Shop",
          legalName: "My Shop Pvt Ltd",
          gstin: "27AADCB2230M1ZP",
          pan: "AADCB2230M",
          phone: "9876543210",
          address: "123 MG Road",
          city: "Mumbai",
          state: "Maharashtra",
          invoicePrefix: "INV",
          nextInvoiceNumber: 43,
          currency: "INR",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/business.getById?input=%7B%22json%22%3A%7B%22id%22%3A%22biz-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const business = await trpc.business.getById.query({ id: "biz-uuid" });
if (business) {
  console.log(business.name, business.gstin);
}`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "biz-uuid"}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/business.getById?input={params}",
    headers={"Authorization": f"Bearer {session_token}"},
)`,
      },
      gotchas: [
        "Returns FORBIDDEN \"You do not have access to this business\" when the caller is not a member of the business — even for tenant owners who have not been added to it.",
      ],
      relatedEndpoints: ["business-list"],
    },
    {
      id: "business-update",
      method: "mutation",
      path: "business.update",
      title: "Update Business",
      description: "Update an existing business profile. `data` accepts any field of `business.create` (all optional) plus `carrierCredentials`; only the provided fields are changed. Requires `owner` or `admin` role on the organization. Carrier credentials are encrypted before storage.",
      auth: "protected",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Business ID to update" },
        { name: "data.name", type: "string", required: false, description: "Updated trading name" },
        { name: "data.legalName", type: "string", required: false, description: "Updated legal entity name" },
        { name: "data.phone", type: "string", required: false, description: "Updated phone number" },
        { name: "data.address", type: "string", required: false, description: "Updated address" },
        { name: "data.gstin", type: "string", required: false, description: "Updated GSTIN" },
        { name: "data.state", type: "string", required: false, description: "Updated state" },
        { name: "data.stateCode", type: "string", required: false, description: "Updated 2-digit state code" },
        { name: "data.invoicePrefix", type: "string", required: false, description: "Updated invoice prefix" },
        { name: "data.carrierCredentials", type: "object", required: false, description: "Carrier API credentials (encrypted at rest)" },
        { name: "data.*", type: "various", required: false, description: "Any other `business.create` field (prefixes, statutory numbers, `financialYearStartDate`, `annualTurnover`, `defaultRoundOff`, `assesseeOfOtherTerritory`, e-invoice/e-way bill toggles and credentials, …). Defaults from the create schema are NOT re-applied on update." },
      ],
      output: {
        description: "Updated business object.",
        example: {
          id: "biz-uuid",
          name: "My Shop Updated",
          updatedAt: "2026-04-08T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/business.update \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"id":"biz-uuid","data":{"name":"My Shop Updated","phone":"9876543211"}}}'`,
        javascript: `const updated = await trpc.business.update.mutate({
  id: "biz-uuid",
  data: {
    name: "My Shop Updated",
    phone: "9876543211",
    state: "Maharashtra",
    stateCode: "27",
  },
});`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/business.update",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {
        "id": "biz-uuid",
        "data": {"name": "My Shop Updated", "phone": "9876543211"},
    }},
)`,
      },
      gotchas: [
        "Only `owner` or `admin` organization roles can update businesses.",
        "Carrier credentials are encrypted before storage using field-level encryption.",
        "E-invoice / e-way bill usernames and passwords are split off and upserted (encrypted) into their config tables; they are never written to the business row.",
        "Setting `assesseeOfOtherTerritory: true` forces `stateCode` to `97` and `state` to `Other Territory`.",
        "The tenant-admin check does not verify the caller is a member of this particular business.",
        "An audit log entry is created for each update.",
      ],
      relatedEndpoints: ["business-get-by-id"],
    },
    {
      id: "business-update-sequence-number",
      method: "mutation",
      path: "business.updateSequenceNumber",
      title: "Update Sequence Number",
      description: "Set the next auto-generated document number for a specific document type in the active business (from `x-business-id`). The new number must be greater than or equal to the current value \u2014 you cannot go backwards.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "documentType", type: "enum", required: true, description: "Document type to update", enumValues: ["invoice", "payment", "quotation", "credit_note", "delivery_challan", "proforma", "purchase_order", "sales_order", "goods_receipt_note"] },
        { name: "newNumber", type: "number (integer ≥ 1)", required: true, description: "New starting number (must be >= current value)" },
      ],
      output: {
        description: "Success with previous and new number.",
        example: { success: true, previousNumber: 43, newNumber: 100 },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/business.updateSequenceNumber \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"documentType":"invoice","newNumber":100}}'`,
        javascript: `const result = await trpc.business.updateSequenceNumber.mutate({
  documentType: "invoice",
  newNumber: 100,
});
console.log("Previous:", result.previousNumber, "New:", result.newNumber);`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/business.updateSequenceNumber",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {
        "documentType": "invoice",
        "newNumber": 100,
    }},
)`,
      },
      gotchas: [
        "Returns BAD_REQUEST if the new number is less than the current number \u2014 you cannot go backwards.",
        "Requires `Business:manage` permission (business admin).",
        "Valid document types: `invoice`, `payment`, `quotation`, `credit_note`, `delivery_challan`, `proforma`, `purchase_order`, `sales_order`, `goods_receipt_note`. Debit notes and sales/purchase returns have no settable counter here.",
        "An audit log entry (`business.updateSequenceNumber`) is written.",
      ],
      relatedEndpoints: ["business-create"],
    },
    {
      id: "business-audit-trail",
      method: "query",
      path: "business.auditTrail",
      title: "Audit Trail",
      description: "Paginated audit log for the active business. Returns all recorded actions (create, update, delete) with the user who performed them, timestamps, and metadata. User names are resolved from the control database.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page (1\u2013100)", default: "50" },
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Filter entries from this date" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "Filter entries up to this date" },
      ],
      output: {
        description: "Paginated audit log entries with resolved user names.",
        example: {
          data: [
            {
              id: "audit-uuid",
              businessId: "biz-uuid",
              userId: "user-uuid",
              action: "invoice.create",
              entityType: "invoice",
              entityId: "inv-uuid",
              metadata: { invoiceNumber: "INV-00042" },
              createdAt: "2026-04-08T09:00:00.000Z",
              ipAddress: "103.21.244.15",
              userName: "Rahul Sharma",
            },
          ],
          total: 245,
          page: 1,
          limit: 50,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/business.auditTrail?input=%7B%22json%22%3A%7B%22page%22%3A1%2C%22limit%22%3A50%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const trail = await trpc.business.auditTrail.query({
  page: 1,
  limit: 50,
  fromDate: "2026-04-01T00:00:00.000Z",
});
trail.data.forEach(entry => {
  console.log(entry.userName, entry.action, entry.entityType);
});`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"page": 1, "limit": 50}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/business.auditTrail?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Requires `Report:read` permission (viewer role or above).",
        "User names are resolved from the control database \u2014 if a user has been deleted, the name shows as 'Unknown user'.",
        "The audit trail only records actions performed through the API \u2014 direct database changes are not tracked.",
      ],
    },
    {
      id: "business-export-data",
      method: "mutation",
      path: "business.exportData",
      title: "Export Data",
      description: "Export all business data as CSV strings. Returns separate CSV files for parties, items, invoices, line items, payments, and expenses. Requires `admin` role and is subject to plan-level data export limits.",
      auth: "business",
      requiredRole: "admin",
      input: [],
      output: {
        description: "Object with CSV strings for each data type.",
        example: {
          parties: "name,type,phone,...\\nAcme Corp,customer,9876543210,...",
          items: "name,itemType,unit,...\\nWidget A,product,pcs,...",
          invoices: "invoiceNumber,type,documentType,...\\nINV-0001,sale,invoice,...",
          lineItems: "invoiceId,description,quantity,...",
          payments: "paymentNumber,paymentDate,amount,...",
          expenses: "category,description,amount,...",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/business.exportData \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{}'`,
        javascript: `const data = await trpc.business.exportData.mutate();

// Download each CSV
const blob = new Blob([data.invoices], { type: "text/csv" });
const url = URL.createObjectURL(blob);
// trigger download...`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/business.exportData",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={},
)
data = resp.json()["result"]["data"]["json"]
with open("invoices.csv", "w") as f:
    f.write(data["invoices"])`,
      },
      gotchas: [
        "Requires `admin` role and `Business:manage` permission.",
        "Subject to plan-level data export limits \u2014 may return FORBIDDEN on the free plan.",
        "Large businesses may produce significant response sizes. Consider streaming for production use.",
      ],
      relatedEndpoints: ["business-audit-trail"],
    },
    {
      id: "business-members",
      method: "query",
      path: "business.members",
      title: "List Business Members",
      description: "List the users who have been added to a specific business, with their business-level role (`admin` or `member`). Business membership decides which businesses a user can open; the organization role (seller, accountant, …) decides what a `member` can do inside it. Requires a tenant session (the `x-tenant-id` header / selected organization); no `x-business-id` header is needed because the business is passed in the input.",
      auth: "protected",
      input: [
        { name: "businessId", type: "string (UUID)", required: true, description: "Business whose members to list" },
      ],
      output: {
        description: "Array of business memberships joined with the user's name and email.",
        example: [
          {
            id: "bm-uuid-1",
            userId: "user-uuid-1",
            role: "admin",
            createdAt: "2026-04-01T09:30:00.000Z",
            name: "Rahul Sharma",
            email: "rahul@myshop.in",
          },
          {
            id: "bm-uuid-2",
            userId: "user-uuid-2",
            role: "member",
            createdAt: "2026-05-12T11:05:00.000Z",
            name: "Priya Gupta",
            email: "priya@myshop.in",
          },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/business.members?input=%7B%22json%22%3A%7B%22businessId%22%3A%22biz-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const members = await trpc.business.members.query({ businessId: "biz-uuid" });
members.forEach(m => console.log(m.name, m.email, m.role));`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"businessId": "biz-uuid"}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/business.members?input={params}",
    headers={"Authorization": f"Bearer {session_token}"},
)
members = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Only organization `owner` or `admin` members can call this — anyone else gets FORBIDDEN \"Only admins can manage businesses\".",
        "No CASL `requireCan` check is applied; the tenant-role check is the only authorization.",
        "An unknown `businessId` simply returns an empty array rather than NOT_FOUND.",
      ],
      relatedEndpoints: ["business-add-member", "business-update-member-role", "business-remove-member", "tenant-members"],
    },
    {
      id: "business-add-member",
      method: "mutation",
      path: "business.addMember",
      title: "Add Business Member",
      description: "Give an existing organization member access to a business. The user must already belong to the organization (invite them first with `tenant.inviteMember`). Requires a tenant session; the business is passed in the input rather than via `x-business-id`.",
      auth: "protected",
      input: [
        { name: "businessId", type: "string (UUID)", required: true, description: "Business to add the user to" },
        { name: "userId", type: "string (UUID)", required: true, description: "User to add (must be a member of the current organization)" },
        { name: "role", type: "enum", required: false, description: "Business-level role. `admin` acts as a full admin inside the business; `member` acts with their organization role (seller, accountant, …).", default: "member", enumValues: ["admin", "member"] },
      ],
      output: {
        description: "The created business membership row.",
        example: {
          id: "bm-uuid-2",
          businessId: "biz-uuid",
          userId: "user-uuid-2",
          role: "member",
          createdAt: "2026-05-12T11:05:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/business.addMember \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"businessId":"biz-uuid","userId":"user-uuid-2","role":"member"}}'`,
        javascript: `const membership = await trpc.business.addMember.mutate({
  businessId: "biz-uuid",
  userId: "user-uuid-2",
  role: "member",
});`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/business.addMember",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"businessId": "biz-uuid", "userId": "user-uuid-2", "role": "member"}},
)`,
      },
      gotchas: [
        "Only organization `owner` or `admin` members can call this (FORBIDDEN \"Only admins can manage businesses\").",
        "NOT_FOUND \"Business not found\" if the business does not exist in this organization.",
        "BAD_REQUEST \"User is not a member of this tenant\" if the user has not joined the organization.",
        "CONFLICT \"User is already a member of this business\" on duplicates — use `business.updateMemberRole` to change their role.",
        "No audit log entry is written for membership changes.",
      ],
      relatedEndpoints: ["business-members", "business-update-member-role", "tenant-invite-member"],
    },
    {
      id: "business-update-member-role",
      method: "mutation",
      path: "business.updateMemberRole",
      title: "Update Business Member Role",
      description: "Change a user's business-level role between `admin` and `member`. Requires a tenant session; the business is passed in the input.",
      auth: "protected",
      input: [
        { name: "businessId", type: "string (UUID)", required: true, description: "Business ID" },
        { name: "userId", type: "string (UUID)", required: true, description: "User whose role to change" },
        { name: "role", type: "enum", required: true, description: "New business-level role", enumValues: ["admin", "member"] },
      ],
      output: {
        description: "The updated business membership row.",
        example: {
          id: "bm-uuid-2",
          businessId: "biz-uuid",
          userId: "user-uuid-2",
          role: "admin",
          createdAt: "2026-05-12T11:05:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/business.updateMemberRole \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"businessId":"biz-uuid","userId":"user-uuid-2","role":"admin"}}'`,
        javascript: `await trpc.business.updateMemberRole.mutate({
  businessId: "biz-uuid",
  userId: "user-uuid-2",
  role: "admin",
});`,
        python: `import httpx

httpx.post(
    "${API_BASE_URL}/api/trpc/business.updateMemberRole",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"businessId": "biz-uuid", "userId": "user-uuid-2", "role": "admin"}},
)`,
      },
      gotchas: [
        "Only organization `owner` or `admin` members can call this (FORBIDDEN otherwise).",
        "NOT_FOUND \"Business membership not found\" if the user is not a member of the business.",
        "There is no last-admin guard here: demoting the only business admin to `member` is allowed (unlike `business.removeMember`).",
      ],
      relatedEndpoints: ["business-members", "business-remove-member"],
    },
    {
      id: "business-remove-member",
      method: "mutation",
      path: "business.removeMember",
      title: "Remove Business Member",
      description: "Revoke a user's access to a business. The user stays in the organization and keeps access to any other businesses they are a member of. Requires a tenant session; the business is passed in the input.",
      auth: "protected",
      input: [
        { name: "businessId", type: "string (UUID)", required: true, description: "Business ID" },
        { name: "userId", type: "string (UUID)", required: true, description: "User to remove from the business" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/business.removeMember \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"businessId":"biz-uuid","userId":"user-uuid-2"}}'`,
        javascript: `await trpc.business.removeMember.mutate({
  businessId: "biz-uuid",
  userId: "user-uuid-2",
});`,
        python: `import httpx

httpx.post(
    "${API_BASE_URL}/api/trpc/business.removeMember",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"businessId": "biz-uuid", "userId": "user-uuid-2"}},
)`,
      },
      gotchas: [
        "Only organization `owner` or `admin` members can call this (FORBIDDEN otherwise).",
        "NOT_FOUND \"Business membership not found\" if the user is not a member of the business.",
        "BAD_REQUEST \"Cannot remove the last business admin\" when removing the only `admin` of the business.",
        "Existing sessions are not invalidated; the removed user loses access on their next request because every business-scoped call re-checks membership.",
      ],
      relatedEndpoints: ["business-members", "business-add-member", "tenant-remove-member"],
    },
    {
      id: "business-upload-logo",
      method: "mutation",
      path: "business.uploadLogo",
      title: "Upload Business Logo",
      description: "Upload or replace a business logo. The image is sent as a base64 PNG/JPEG data URL and stored as bytes on the business row (`logo_data`), so it travels with database backups and exports. It is printed on invoices/PDFs and shown on the storefront. To display it, request `GET /api/businesses/:id/logo` with the session cookie or Bearer token — it returns the raw image with the stored `Content-Type`, an `ETag` based on `logoUpdatedAt` (304 on `If-None-Match`), `Cache-Control: private, max-age=300`, and a 1x1 transparent PNG (HTTP 200) when no logo is set. Requires a tenant session; the business is passed in the input.",
      auth: "protected",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Business ID" },
        { name: "data.dataUrl", type: "string", required: true, description: "`data:image/png;base64,...` or `data:image/jpeg;base64,...` (max 1,500,000 chars; ≤ 1 MB after decoding). SVG/WebP/GIF are rejected — rasterize to PNG client-side first." },
        { name: "data.width", type: "number (integer)", required: true, description: "Image width in pixels (1–4000), stored for layout" },
        { name: "data.height", type: "number (integer)", required: true, description: "Image height in pixels (1–4000), stored for layout" },
      ],
      output: {
        description: "The new logo timestamp — use it to cache-bust the image URL.",
        example: { logoUpdatedAt: "2026-06-18T07:42:10.000Z" },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/business.uploadLogo \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"id":"biz-uuid","data":{"dataUrl":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...","width":512,"height":512}}}'

# Fetch the stored image
curl ${API_BASE_URL}/api/businesses/biz-uuid/logo \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" -o logo.png`,
        javascript: `const file = input.files[0]; // PNG or JPEG
const dataUrl = await new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.readAsDataURL(file);
});
const img = new Image();
img.src = dataUrl;
await img.decode();

const { logoUpdatedAt } = await trpc.business.uploadLogo.mutate({
  id: "biz-uuid",
  data: { dataUrl, width: img.naturalWidth, height: img.naturalHeight },
});
logoEl.src = \`/api/businesses/biz-uuid/logo?v=\${new Date(logoUpdatedAt).getTime()}\`;`,
        python: `import base64, httpx

with open("logo.png", "rb") as f:
    data_url = "data:image/png;base64," + base64.b64encode(f.read()).decode()

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/business.uploadLogo",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"id": "biz-uuid", "data": {"dataUrl": data_url, "width": 512, "height": 512}}},
)`,
      },
      gotchas: [
        "Only organization `owner` or `admin` members can upload (FORBIDDEN \"Only admins can manage businesses\"). Business membership is not checked.",
        "The server never trusts the declared MIME: after decoding it checks the PNG (`89 50 4E 47 0D 0A 1A 0A`) / JPEG (`FF D8 FF`) magic bytes. Errors: BAD_REQUEST \"Invalid image data URL\", BAD_REQUEST \"File is not a valid PNG or JPEG\", BAD_REQUEST \"Declared MIME does not match file contents\", PAYLOAD_TOO_LARGE \"Logo must be ≤ 1MB after decoding\".",
        "`width`/`height` are taken from the client as-is; they are not verified against the image.",
        "NOT_FOUND \"Business not found\" for an unknown business ID.",
        "The image endpoint `GET /api/businesses/:id/logo` requires a session tied to an active organization and access to the business (401/403 otherwise) and sends `X-Content-Type-Options: nosniff` plus a restrictive CSP.",
        "An audit log entry (`business.uploadLogo`) records the byte size, MIME and dimensions.",
      ],
      relatedEndpoints: ["business-delete-logo", "business-upload-signature"],
    },
    {
      id: "business-delete-logo",
      method: "mutation",
      path: "business.deleteLogo",
      title: "Delete Business Logo",
      description: "Remove the business logo (clears the stored bytes, MIME type, dimensions and `logoUpdatedAt`). Afterwards `GET /api/businesses/:id/logo` serves a 1x1 transparent PNG. Requires a tenant session; the business is passed in the input.",
      auth: "protected",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Business ID" },
      ],
      output: {
        description: "Success flag.",
        example: { ok: true },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/business.deleteLogo \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"id":"biz-uuid"}}'`,
        javascript: `await trpc.business.deleteLogo.mutate({ id: "biz-uuid" });`,
        python: `import httpx

httpx.post(
    "${API_BASE_URL}/api/trpc/business.deleteLogo",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"id": "biz-uuid"}},
)`,
      },
      gotchas: [
        "Only organization `owner` or `admin` members can call this (FORBIDDEN otherwise).",
        "NOT_FOUND \"Business not found\" for an unknown business ID. Calling it when no logo is set still succeeds.",
        "An audit log entry (`business.deleteLogo`) is written.",
      ],
      relatedEndpoints: ["business-upload-logo"],
    },
    {
      id: "business-upload-signature",
      method: "mutation",
      path: "business.uploadSignature",
      title: "Upload Authorised Signatory Image",
      description: "Upload or replace the authorised-signatory signature image printed on documents. Uses exactly the same payload and validation as `business.uploadLogo` (base64 PNG/JPEG data URL, ≤ 1 MB decoded, magic-byte check) and is stored as bytes on the business row. Serve it with `GET /api/businesses/:id/signature` (same auth, caching and transparent-PNG fallback as the logo endpoint). Requires a tenant session; the business is passed in the input.",
      auth: "protected",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Business ID" },
        { name: "data.dataUrl", type: "string", required: true, description: "`data:image/png;base64,...` or `data:image/jpeg;base64,...` (max 1,500,000 chars; ≤ 1 MB decoded)" },
        { name: "data.width", type: "number (integer)", required: true, description: "Image width in pixels (1–4000)" },
        { name: "data.height", type: "number (integer)", required: true, description: "Image height in pixels (1–4000)" },
      ],
      output: {
        description: "The new signature timestamp — use it to cache-bust the image URL.",
        example: { signatureUpdatedAt: "2026-06-18T07:45:32.000Z" },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/business.uploadSignature \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"id":"biz-uuid","data":{"dataUrl":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...","width":600,"height":200}}}'

# Fetch the stored image
curl ${API_BASE_URL}/api/businesses/biz-uuid/signature \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" -o signature.png`,
        javascript: `const { signatureUpdatedAt } = await trpc.business.uploadSignature.mutate({
  id: "biz-uuid",
  data: { dataUrl, width: 600, height: 200 }, // dataUrl from FileReader.readAsDataURL
});`,
        python: `import base64, httpx

with open("signature.png", "rb") as f:
    data_url = "data:image/png;base64," + base64.b64encode(f.read()).decode()

httpx.post(
    "${API_BASE_URL}/api/trpc/business.uploadSignature",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"id": "biz-uuid", "data": {"dataUrl": data_url, "width": 600, "height": 200}}},
)`,
      },
      gotchas: [
        "Only organization `owner` or `admin` members can upload (FORBIDDEN otherwise).",
        "Validation errors are shared with the logo upload, so the size error message says \"Logo must be ≤ 1MB after decoding\" even for signatures.",
        "Use a PNG with a transparent background for the cleanest result on printed invoices.",
        "An audit log entry (`business.uploadSignature`) is written.",
      ],
      relatedEndpoints: ["business-delete-signature", "business-upload-logo"],
    },
    {
      id: "business-delete-signature",
      method: "mutation",
      path: "business.deleteSignature",
      title: "Delete Signatory Image",
      description: "Remove the authorised-signatory image (clears bytes, MIME type, dimensions and `signatureUpdatedAt`). Requires a tenant session; the business is passed in the input.",
      auth: "protected",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Business ID" },
      ],
      output: {
        description: "Success flag.",
        example: { ok: true },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/business.deleteSignature \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"id":"biz-uuid"}}'`,
        javascript: `await trpc.business.deleteSignature.mutate({ id: "biz-uuid" });`,
        python: `import httpx

httpx.post(
    "${API_BASE_URL}/api/trpc/business.deleteSignature",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"id": "biz-uuid"}},
)`,
      },
      gotchas: [
        "Only organization `owner` or `admin` members can call this (FORBIDDEN otherwise).",
        "NOT_FOUND \"Business not found\" for an unknown business ID.",
        "An audit log entry (`business.deleteSignature`) is written.",
      ],
      relatedEndpoints: ["business-upload-signature"],
    },
    {
      id: "business-set-pos-enabled",
      method: "mutation",
      path: "business.setPosEnabled",
      title: "Enable / Disable POS Mode",
      description: "Toggle Point-of-Sale mode for a business. When enabled, the cashier-optimised POS screen becomes available and a \"Switch to POS\" button appears on the invoice create page. Off by default. Requires a tenant session; the business is passed in the input.",
      auth: "protected",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Business ID" },
        { name: "enabled", type: "boolean", required: true, description: "`true` to enable POS mode, `false` to disable it" },
      ],
      output: {
        description: "The business ID and its new POS flag.",
        example: { id: "biz-uuid", posEnabled: true },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/business.setPosEnabled \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"id":"biz-uuid","enabled":true}}'`,
        javascript: `const { posEnabled } = await trpc.business.setPosEnabled.mutate({
  id: "biz-uuid",
  enabled: true,
});`,
        python: `import httpx

httpx.post(
    "${API_BASE_URL}/api/trpc/business.setPosEnabled",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"id": "biz-uuid", "enabled": True}},
)`,
      },
      gotchas: [
        "Only organization `owner` or `admin` members can call this (FORBIDDEN otherwise).",
        "NOT_FOUND \"Business not found\" for an unknown business ID.",
        "Enabling POS does not seed the walk-in customer; call `business.ensureWalkInParty` when opening POS.",
        "An audit log entry (`business.setPosEnabled`) records the new value.",
      ],
      relatedEndpoints: ["business-ensure-walk-in-party"],
    },
    {
      id: "business-ensure-walk-in-party",
      method: "mutation",
      path: "business.ensureWalkInParty",
      title: "Ensure Walk-in Customer",
      description: "Return the ID of the business's \"Walk-in Customer\" party, creating it if it does not exist yet. POS uses this as the default `partyId` for anonymous retail sales. New businesses get this party at creation; this call lazily covers older businesses. Idempotent. Requires a tenant session; the business is passed in the input.",
      auth: "protected",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Business ID" },
      ],
      output: {
        description: "The walk-in party ID and whether it was created by this call.",
        example: { id: "party-walkin-uuid", created: false },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/business.ensureWalkInParty \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"id":"biz-uuid"}}'`,
        javascript: `const { id: walkInPartyId } = await trpc.business.ensureWalkInParty.mutate({
  id: "biz-uuid",
});
// Use walkInPartyId as the default partyId for POS sales`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/business.ensureWalkInParty",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"id": "biz-uuid"}},
)
walk_in_id = resp.json()["result"]["data"]["json"]["id"]`,
      },
      gotchas: [
        "Refused (FORBIDDEN) for the accountant read-only and filing roles (`auditor`, `ca_filing`): it creates a record.",
        "Any authenticated member of the organization can call this — there is no admin, CASL or business-membership check, and the business ID is not verified to exist.",
        "The match is on an exact `name = \"Walk-in Customer\"` and `type = \"customer\"`. Renaming that party makes the next call create a new one.",
        "There is no lock, so two simultaneous first calls can create two walk-in parties; merge them with `party.merge`.",
        "No audit log entry is written.",
      ],
      relatedEndpoints: ["business-set-pos-enabled", "party-merge"],
    },
  ],
};
