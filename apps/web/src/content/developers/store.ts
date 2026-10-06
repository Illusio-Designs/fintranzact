import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

export const storeEndpoints: EndpointGroup = {
  id: "store",
  title: "Online Store",
  description: "Configure and manage your public online storefront at store.fintranzact.com/your-slug. Toggle items for store visibility, set store-specific pricing, manage orders with phone verification and WhatsApp notifications.",
  endpoints: [
    {
      id: "store-check-slug",
      method: "query",
      path: "store.checkSlug",
      title: "Check Slug Availability",
      description: "Check whether a store URL slug is available. The slug forms the public store URL: `store.fintranzact.com/{slug}`. Excludes the current business from the uniqueness check, so re-checking your own slug returns available.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "slug", type: "string", required: true, description: "URL slug to check (3-50 chars, lowercase alphanumeric with hyphens)" },
      ],
      output: {
        description: "Whether the slug is available for use.",
        example: { available: true },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/store.checkSlug?input=%7B%22json%22%3A%7B%22slug%22%3A%22gupta-sweets%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { available } = await trpc.store.checkSlug.query({
  slug: "gupta-sweets",
});
if (available) {
  console.log("Slug is available!");
}`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"slug": "gupta-sweets"}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/store.checkSlug?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
result = resp.json()["result"]["data"]["json"]
print("Available:", result["available"])`,
      },
      gotchas: [
        "Slug must be lowercase alphanumeric with hyphens only, starting and ending with an alphanumeric character.",
        "Your own current slug always returns `available: true` — the check excludes the calling business.",
      ],
    },
    {
      id: "store-get-settings",
      method: "query",
      path: "store.getSettings",
      title: "Get Store Settings",
      description: "Retrieve all online store configuration settings for the current business. Includes store status, slug, branding, order settings, WhatsApp notification configuration and how shoppers pay: the two checkout switches (`storeOnlinePaymentsEnabled`, `storeCodEnabled`) and a `payments` object describing the business's own Razorpay connection (Settings, Online payments). `payments` never contains keys or secrets: only whether Razorpay is connected, whether its webhook secret is saved, the mode, and `onlineActive` (online payment is switched on AND ready, so shoppers see Pay online).",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Full store configuration object.",
        example: {
          storeEnabled: true,
          storeSlug: "gupta-sweets-jaipur",
          storeTagline: "Authentic Rajasthani sweets since 1985",
          storeAccentColor: "#E53E3E",
          storeMinOrderAmount: "500.00",
          storeDeliveryNote: "Free delivery above Rs 1000 within Jaipur",
          storeWhatsappNumber: "919876543210",
          storeAllowNegativeStock: false,
          storeOrderPrefix: "GS",
          storeOnlinePaymentsEnabled: true,
          storeCodEnabled: true,
          payments: { connected: true, hasWebhookSecret: true, mode: "live", onlineActive: true },
          nextStoreOrderNumber: 42,
          currency: "INR",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/store.getSettings" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const settings = await trpc.store.getSettings.query();
console.log("Store enabled:", settings.storeEnabled);
console.log("URL: store.fintranzact.com/" + settings.storeSlug);`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/store.getSettings",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
settings = resp.json()["result"]["data"]["json"]`,
      },
    },
    {
      id: "store-update-settings",
      method: "mutation",
      path: "store.updateSettings",
      title: "Update Store Settings",
      description: "Update online store configuration. All fields are optional — only provided fields are changed. The store slug must be globally unique across all businesses. Requires admin-level permission (`manage` on Store resource).",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "storeEnabled", type: "boolean", required: false, description: "Enable or disable the online store" },
        { name: "storeSlug", type: "string", required: false, description: "URL slug (3-50 chars, lowercase alphanumeric with hyphens). Set to null to clear." },
        { name: "storeTagline", type: "string", required: false, description: "Store tagline displayed on the storefront (max 200 chars)" },
        { name: "storeAccentColor", type: "string", required: false, description: "Hex color code for store branding (e.g. '#E53E3E')" },
        { name: "storeMinOrderAmount", type: "string", required: false, description: "Minimum order amount (e.g. '500.00'). Set to null to remove minimum." },
        { name: "storeDeliveryNote", type: "string", required: false, description: "Delivery note shown to customers (max 500 chars)" },
        { name: "storeWhatsappNumber", type: "string", required: false, description: "WhatsApp number for order notifications (max 15 chars, include country code)" },
        { name: "storeAllowNegativeStock", type: "boolean", required: false, description: "Allow orders for items with zero or negative stock" },
        { name: "storeOrderPrefix", type: "string", required: false, description: "Prefix for order numbers (1-10 chars)" },
        { name: "storeReturnWindowDays", type: "number", required: false, description: "Days a customer has to ask for a return (1-365, default 7). Filled into the store's Refund & Cancellation page." },
        { name: "storeOnlinePaymentsEnabled", type: "boolean", required: false, description: "Offer Pay online (UPI, cards, net banking) at checkout. Needs the business's own Razorpay connection with its webhook secret (Settings, Online payments)." },
        { name: "storeCodEnabled", type: "boolean", required: false, description: "Offer Cash on Delivery at checkout (default on). An enabled store must keep at least one way to pay." },
      ],
      output: {
        description: "Updated store settings (only store-specific fields returned).",
        example: {
          storeEnabled: true,
          storeSlug: "gupta-sweets-jaipur",
          storeTagline: "Authentic Rajasthani sweets since 1985",
          storeAccentColor: "#E53E3E",
          storeMinOrderAmount: "500.00",
          storeDeliveryNote: "Free delivery above Rs 1000 within Jaipur",
          storeWhatsappNumber: "919876543210",
          storeAllowNegativeStock: false,
          storeOrderPrefix: "GS",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/store.updateSettings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"storeEnabled":true,"storeSlug":"gupta-sweets-jaipur","storeTagline":"Authentic Rajasthani sweets since 1985","storeAccentColor":"#E53E3E"}}'`,
        javascript: `const updated = await trpc.store.updateSettings.mutate({
  storeEnabled: true,
  storeSlug: "gupta-sweets-jaipur",
  storeTagline: "Authentic Rajasthani sweets since 1985",
  storeAccentColor: "#E53E3E",
  storeMinOrderAmount: "500.00",
});`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/store.updateSettings",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "storeEnabled": True,
        "storeSlug": "gupta-sweets-jaipur",
        "storeTagline": "Authentic Rajasthani sweets since 1985",
    }},
)`,
      },
      gotchas: [
        "Returns CONFLICT if the slug is already taken by another business.",
        "The slug must match the pattern `/^[a-z0-9][a-z0-9-]*[a-z0-9]$/` — no uppercase, no leading/trailing hyphens.",
        "Monetary values like `storeMinOrderAmount` must be strings matching `/^\\d+(\\.\\d{1,2})?$/`.",
        "Setting `storeWhatsappNumber` enables WhatsApp order notifications to the business owner.",
        "`storeOnlinePaymentsEnabled: true` returns PRECONDITION_FAILED until Razorpay is connected and its webhook secret is saved (without the secret a payment could never be recorded). Switching both payment methods off on an enabled store returns BAD_REQUEST.",
      ],
    },
    {
      id: "store-list-items",
      method: "query",
      path: "store.listStoreItems",
      title: "List Store Items",
      description: "Paginated list of all items in the business with their store visibility and store-specific settings. Supports search by name, filtering by category and store-enabled status. Used in the admin dashboard to manage which items appear in the online store.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "search", type: "string", required: false, description: "Search by item name (case-insensitive)" },
        { name: "category", type: "string", required: false, description: "Filter by item category" },
        { name: "storeEnabled", type: "boolean", required: false, description: "Filter by store visibility (true = shown, false = hidden)" },
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page (1-100)", default: "20" },
      ],
      output: {
        description: "Paginated item list with store-specific fields.",
        example: {
          data: [
            {
              id: "item-uuid",
              name: "Kaju Katli (500g)",
              description: "Premium cashew fudge",
              unit: "box",
              salePrice: "850.00",
              category: "Sweets",
              taxPercent: "5",
              taxInclusive: true,
              stockQuantity: "45",
              itemType: "product",
              itemMode: "stock",
              storeEnabled: true,
              storePrice: "900.00",
              storeSortOrder: 1,
              storeCategory: "Premium Sweets",
              storeDescription: "Handmade cashew fudge — our bestseller!",
            },
          ],
          total: 34,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/store.listStoreItems?input=%7B%22json%22%3A%7B%22page%22%3A1%2C%22limit%22%3A20%2C%22storeEnabled%22%3Atrue%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, total } = await trpc.store.listStoreItems.query({
  storeEnabled: true,
  page: 1,
  limit: 20,
});
console.log(\`\${data.length} of \${total} items shown in store\`);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"page": 1, "limit": 20, "storeEnabled": True}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/store.listStoreItems?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
result = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "`storePrice` is an optional override — if null, the regular `salePrice` is used on the storefront.",
        "Monetary values are returned as strings (e.g. `\"850.00\"`) — never parse with `parseFloat`.",
        "Items are sorted by `storeSortOrder` first, then by name.",
      ],
    },
    {
      id: "store-bulk-toggle",
      method: "mutation",
      path: "store.bulkToggleItems",
      title: "Bulk Toggle Store Items",
      description: "Enable or disable store visibility for multiple items at once. Useful for quickly publishing or hiding a batch of items. Scoped to the current business — only items belonging to the business are affected.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "itemIds", type: "string[] (UUIDs)", required: true, description: "Array of item IDs to toggle (1-500 items)" },
        { name: "storeEnabled", type: "boolean", required: true, description: "Whether to enable or disable store visibility" },
      ],
      output: {
        description: "Count of items updated.",
        example: { updated: 12 },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/store.bulkToggleItems \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"itemIds":["item-uuid-1","item-uuid-2","item-uuid-3"],"storeEnabled":true}}'`,
        javascript: `const result = await trpc.store.bulkToggleItems.mutate({
  itemIds: ["item-uuid-1", "item-uuid-2", "item-uuid-3"],
  storeEnabled: true,
});
console.log(\`Enabled \${result.updated} items in store\`);`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/store.bulkToggleItems",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "itemIds": ["item-uuid-1", "item-uuid-2", "item-uuid-3"],
        "storeEnabled": True,
    }},
)`,
      },
      gotchas: [
        "Maximum 500 items per call. For larger catalogs, batch the requests.",
        "Items not belonging to the current business are silently skipped.",
        "The `updated` count reflects the number of item IDs passed, not the actual rows changed.",
      ],
    },
    {
      id: "store-update-item-settings",
      method: "mutation",
      path: "store.updateItemStoreSettings",
      title: "Update Item Store Settings",
      description: "Configure store-specific settings for an individual item. Set a different price for the storefront, control sort order, assign a store category, or add a store-specific description. All fields are optional — only provided fields are updated. Set a field to null to clear it.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "itemId", type: "string (UUID)", required: true, description: "The item to configure" },
        { name: "storePrice", type: "string", required: false, description: "Store-specific price override (e.g. '900.00'). Set to null to use the regular sale price." },
        { name: "storeSortOrder", type: "number", required: false, description: "Sort position in the store (0 = first). Set to null to reset to 0." },
        { name: "storeCategory", type: "string", required: false, description: "Store-specific category name (max 100 chars). Can differ from the item's internal category." },
        { name: "storeDescription", type: "string", required: false, description: "Store-specific description (max 1000 chars). Shown on the storefront instead of the item's internal description." },
      ],
      output: {
        description: "Updated store-specific fields for the item.",
        example: {
          id: "item-uuid",
          storeEnabled: true,
          storePrice: "900.00",
          storeSortOrder: 1,
          storeCategory: "Premium Sweets",
          storeDescription: "Handmade cashew fudge — our bestseller!",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/store.updateItemStoreSettings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"itemId":"item-uuid","storePrice":"900.00","storeCategory":"Premium Sweets"}}'`,
        javascript: `const updated = await trpc.store.updateItemStoreSettings.mutate({
  itemId: "item-uuid",
  storePrice: "900.00",
  storeCategory: "Premium Sweets",
  storeDescription: "Handmade cashew fudge — our bestseller!",
});`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/store.updateItemStoreSettings",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "itemId": "item-uuid",
        "storePrice": "900.00",
        "storeCategory": "Premium Sweets",
    }},
)`,
      },
      gotchas: [
        "Returns NOT_FOUND if the item doesn't belong to the current business.",
        "Monetary values must be strings matching `/^\\d+(\\.\\d{1,2})?$/` — e.g. '900.00', not 900.",
        "Setting `storePrice` to null means the store will display the item's regular `salePrice`.",
      ],
    },
    {
      id: "store-update-variant-settings",
      method: "mutation",
      path: "store.updateVariantStoreSettings",
      title: "Update Variant Store Settings",
      description: "Configure store-specific settings for an item variant. Enable or disable individual variants for store visibility and set variant-specific store pricing. Verifies the variant belongs to an item in the current business.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "variantId", type: "string (UUID)", required: true, description: "The variant to configure" },
        { name: "storeEnabled", type: "boolean", required: false, description: "Whether this variant is visible in the store" },
        { name: "storePrice", type: "string", required: false, description: "Store-specific price for this variant. Set to null to use the variant's default price." },
      ],
      output: {
        description: "Full updated variant record.",
        example: {
          id: "variant-uuid",
          itemId: "item-uuid",
          name: "500g Box",
          storeEnabled: true,
          storePrice: "950.00",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/store.updateVariantStoreSettings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"variantId":"variant-uuid","storeEnabled":true,"storePrice":"950.00"}}'`,
        javascript: `const updated = await trpc.store.updateVariantStoreSettings.mutate({
  variantId: "variant-uuid",
  storeEnabled: true,
  storePrice: "950.00",
});`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/store.updateVariantStoreSettings",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "variantId": "variant-uuid",
        "storeEnabled": True,
        "storePrice": "950.00",
    }},
)`,
      },
      gotchas: [
        "Returns NOT_FOUND if the variant doesn't belong to an item in the current business.",
        "Variant store visibility is independent of item-level `storeEnabled` — both must be true for the variant to appear.",
      ],
    },
    {
      id: "store-list-orders",
      method: "query",
      path: "store.listOrders",
      title: "List Store Orders",
      description: "Paginated list of orders placed through the online store. Supports filtering by status, date range, and searching by customer name, phone number, or order number. Orders are sorted newest-first. Each row carries `paymentMethod` and `paymentStatus`.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "status", type: "enum", required: false, description: "Filter by order status", enumValues: ["pending", "confirmed", "preparing", "ready", "delivered", "cancelled"] },
        { name: "fromDate", type: "string (ISO 8601)", required: false, description: "Start of date range (inclusive)" },
        { name: "toDate", type: "string (ISO 8601)", required: false, description: "End of date range (inclusive)" },
        { name: "search", type: "string", required: false, description: "Search by customer name, phone, or order number" },
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page (1-100)", default: "20" },
      ],
      output: {
        description: "Paginated order list with customer details.",
        example: {
          data: [
            {
              id: "order-uuid",
              orderNumber: "GS-042",
              status: "pending",
              customerName: "Meera Joshi",
              customerPhone: "+919876543210",
              customerEmail: "meera@gmail.com",
              deliveryAddress: "42, MG Road",
              deliveryCity: "Jaipur",
              deliveryPincode: "302001",
              totalAmount: "2350.00",
              itemCount: 3,
              invoiceId: null,
              createdAt: "2026-04-08T14:30:00.000Z",
              confirmedAt: null,
            },
          ],
          total: 28,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/store.listOrders?input=%7B%22json%22%3A%7B%22page%22%3A1%2C%22limit%22%3A20%2C%22status%22%3A%22pending%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, total } = await trpc.store.listOrders.query({
  status: "pending",
  page: 1,
  limit: 20,
});
console.log(\`\${total} pending orders\`);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"page": 1, "limit": 20, "status": "pending"}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/store.listOrders?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
result = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Monetary values like `totalAmount` are returned as strings.",
        "`invoiceId` is null until the order is confirmed and an invoice is auto-generated.",
        "Date filters use ISO 8601 datetime strings (e.g. `2026-04-01T00:00:00.000Z`).",
      ],
    },
    {
      id: "store-get-order",
      method: "query",
      path: "store.getOrder",
      title: "Get Order Details",
      description: "Retrieve full details of a store order including delivery info, linked invoice, and line items. The invoice and line items are only populated if the order has been confirmed and an invoice was generated. Also carries the payment: `paymentMethod` (`online` or `cod`), `paymentStatus` (`unpaid`, `paid`, `partially_refunded`, `refunded`), `paidAt`, `refundedAmount`, `razorpayPayments` (the Razorpay payment id, amount, gateway fee and method), `refunds` and `refundable` (what can still be refunded through Razorpay).",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "The order ID" },
      ],
      output: {
        description: "Full order details with linked invoice and line items.",
        example: {
          id: "order-uuid",
          orderNumber: "GS-042",
          status: "confirmed",
          customerName: "Meera Joshi",
          customerPhone: "+919876543210",
          customerEmail: "meera@gmail.com",
          deliveryAddress: "42, MG Road",
          deliveryCity: "Jaipur",
          deliveryPincode: "302001",
          totalAmount: "2350.00",
          itemCount: 3,
          invoiceId: "inv-uuid",
          confirmedAt: "2026-04-08T15:00:00.000Z",
          createdAt: "2026-04-08T14:30:00.000Z",
          invoice: {
            id: "inv-uuid",
            invoiceNumber: "GS-INV-042",
            status: "sent",
            totalAmount: "2350.00",
          },
          lineItems: [
            {
              id: "line-uuid",
              description: "Kaju Katli (500g)",
              quantity: "2",
              unitPrice: "900.00",
              taxPercent: "5",
              totalAmount: "1890.00",
            },
          ],
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/store.getOrder?input=%7B%22json%22%3A%7B%22id%22%3A%22order-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const order = await trpc.store.getOrder.query({ id: "order-uuid" });
console.log("Order:", order.orderNumber, "Status:", order.status);
if (order.invoice) {
  console.log("Invoice:", order.invoice.invoiceNumber);
}`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "order-uuid"}}))
resp = httpx.get(
    f"${API_BASE_URL}/api/trpc/store.getOrder?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
order = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Returns NOT_FOUND if the order doesn't belong to the current business.",
        "`invoice` and `lineItems` are null/empty until the order has been confirmed.",
        "Invoice lookup is scoped to the current business to prevent cross-business invoice leakage.",
      ],
    },
    {
      id: "store-confirm-order",
      method: "mutation",
      path: "store.confirmOrder",
      title: "Confirm Order",
      description: "Confirm a pending store order. Transitions the order status from `pending` to `confirmed` and updates the linked invoice from `draft` to `sent`. Only pending orders can be confirmed. Runs in a transaction to ensure atomicity.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "orderId", type: "string (UUID)", required: true, description: "The order to confirm" },
      ],
      output: {
        description: "Success confirmation with order ID.",
        example: { success: true, orderId: "order-uuid" },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/store.confirmOrder \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"orderId":"order-uuid"}}'`,
        javascript: `const result = await trpc.store.confirmOrder.mutate({
  orderId: "order-uuid",
});
// Order is now "confirmed", linked invoice is now "sent"`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/store.confirmOrder",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {"orderId": "order-uuid"}},
)`,
      },
      gotchas: [
        "Returns BAD_REQUEST if the order is not in `pending` status.",
        "Returns NOT_FOUND if the order doesn't belong to the current business.",
        "Automatically transitions the linked draft invoice to `sent` status.",
        "Runs in a database transaction — both order and invoice are updated atomically.",
      ],
      relatedEndpoints: ["store-cancel-order", "store-update-order-status"],
    },
    {
      id: "store-cancel-order",
      method: "mutation",
      path: "store.cancelOrder",
      title: "Cancel Order",
      description: "Cancel a store order. Can cancel orders in any status except `delivered` and `cancelled`. Optionally provide a cancellation reason. Cancels the linked invoice if one exists (stock goes back) and stops the order's live Razorpay payment links. An order the shopper already PAID ONLINE must say what happens to the money: `refund: \"full\"` refunds what is left through the business's own Razorpay (owner/admin only; a credit note is booked against the invoice, which stays, and the stock goes back) and `refund: \"none\"` cancels and keeps the payment (the invoice is cancelled as before; refund the shopper yourself).",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "orderId", type: "string (UUID)", required: true, description: "The order to cancel" },
        { name: "reason", type: "string", required: false, description: "Cancellation reason (max 500 chars)" },
        { name: "refund", type: "string", required: false, description: "Required for an order paid online with money still to refund: `full` refunds it through Razorpay, `none` keeps the payment", enumValues: ["full", "none"] },
      ],
      output: {
        description: "Success confirmation with order ID.",
        example: { success: true, orderId: "order-uuid" },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/store.cancelOrder \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"orderId":"order-uuid","reason":"Customer requested cancellation"}}'`,
        javascript: `const result = await trpc.store.cancelOrder.mutate({
  orderId: "order-uuid",
  reason: "Customer requested cancellation",
});`,
        python: `import httpx

resp = httpx.post(
    "${API_BASE_URL}/api/trpc/store.cancelOrder",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "orderId": "order-uuid",
        "reason": "Customer requested cancellation",
    }},
)`,
      },
      gotchas: [
        "Returns BAD_REQUEST if the order is already `delivered` or `cancelled`.",
        "Cancels the linked invoice too (sets status to `cancelled`), except after a refund: the credit note reverses the sale, so the invoice stays (status `adjusted`).",
        "An order paid online with money left to refund returns PRECONDITION_FAILED until `refund` is given. `refund: \"full\"` needs `manage` on Store (owner or admin), is idempotent per order (a retry never refunds twice) and, if Razorpay refuses, cancels nothing. A partly refunded order must be cancelled with `refund: \"full\"` for the rest.",
        "The cancellation reason is stored on the order record for audit purposes.",
      ],
      relatedEndpoints: ["store-confirm-order", "store-update-order-status", "store-refund-order"],
    },
    {
      id: "store-update-order-status",
      method: "mutation",
      path: "store.updateOrderStatus",
      title: "Update Order Status",
      description: "Update the fulfillment status of a confirmed order. Use this to progress an order through the fulfillment pipeline: confirmed -> preparing -> ready -> delivered. Cannot update cancelled orders.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "orderId", type: "string (UUID)", required: true, description: "The order to update" },
        { name: "status", type: "enum", required: true, description: "New status", enumValues: ["preparing", "ready", "delivered"] },
      ],
      output: {
        description: "Success confirmation with the new status.",
        example: { success: true, status: "preparing" },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/store.updateOrderStatus \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"orderId":"order-uuid","status":"preparing"}}'`,
        javascript: `await trpc.store.updateOrderStatus.mutate({
  orderId: "order-uuid",
  status: "preparing",
});`,
        python: `import httpx

httpx.post(
    "${API_BASE_URL}/api/trpc/store.updateOrderStatus",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {"orderId": "order-uuid", "status": "preparing"}},
)`,
      },
      gotchas: [
        "Returns BAD_REQUEST if the order is `cancelled` — cancelled orders cannot be updated.",
        "Returns NOT_FOUND if the order doesn't belong to the current business.",
        "Valid transitions: `preparing`, `ready`, `delivered`. Use `store.confirmOrder` for `pending -> confirmed` and `store.cancelOrder` for cancellation.",
        "There is no strict status ordering enforced — you can skip from `confirmed` directly to `delivered` if needed.",
      ],
      relatedEndpoints: ["store-confirm-order", "store-cancel-order"],
    },
    {
      id: "store-refund-order",
      method: "mutation",
      path: "store.refundOrder",
      title: "Refund an Online-Paid Order",
      description: "Refund all or part of an order the shopper paid online, through the business's OWN Razorpay account (never the platform's). Owner and admin only. The refund row is written first with the idempotency key, Razorpay is asked to refund the payment (the row id is sent as Razorpay's `X-Refund-Idempotency`), then a credit note is booked against the order's invoice (one line per GST rate, so tax is reversed at the rate it was charged, together exactly the refunded amount), the refunded amount comes off what is paid on the invoice and the payment's allocation, the gateway account gets the money-out entry, the order's `paymentStatus` becomes `partially_refunded` or `refunded` and the shopper is emailed. Read-only organisations are refused by the normal mutation gate.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "orderId", type: "string (UUID)", required: true, description: "The store order" },
        { name: "amount", type: "string", required: false, description: "Rupees, like \"250.50\" (at least 1.00). Omitted: everything still refundable on the order's Razorpay payment" },
        { name: "reason", type: "string", required: false, description: "Why (max 300 chars); recorded on the refund, the credit note and the audit trail" },
        { name: "idempotencyKey", type: "string", required: true, description: "8 to 64 characters of letters, digits, `_` or `-`, unique per refund attempt. The same key returns the first result instead of refunding again" },
      ],
      output: {
        description: "The refund as booked.",
        example: {
          refundId: "refund-uuid",
          razorpayRefundId: "rfnd_Abc123",
          amount: "50.00",
          creditNoteId: "credit-note-uuid",
          creditNoteNumber: "CN-00007",
          paymentStatus: "partially_refunded",
          replayed: false,
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/store.refundOrder \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"orderId":"order-uuid","amount":"50.00","reason":"Item arrived damaged","idempotencyKey":"refund-ord-00012-1"}}'`,
        javascript: `const refund = await trpc.store.refundOrder.mutate({
  orderId: "order-uuid",
  amount: "50.00",
  reason: "Item arrived damaged",
  idempotencyKey: crypto.randomUUID(),
});`,
      },
      gotchas: [
        "PRECONDITION_FAILED when Razorpay is not connected or no online payment was received for the order (a Cash on Delivery or unpaid order has nothing to refund through Razorpay).",
        "BAD_REQUEST when the amount is more than what is left to refund (counting refunds already made or in progress) or below 1.00. BAD_GATEWAY when Razorpay refuses; nothing is booked and the same key can be retried.",
        "CONFLICT when the key was used for a different amount or another order, or the same refund is still being processed.",
        "The credit note is marked paid out, and `store_orders.refundedAmount` always equals the processed refunds. Gateway charges Razorpay keeps are not reversed.",
      ],
      relatedEndpoints: ["store-cancel-order", "store-get-order"],
    },
    {
      id: "store-public-order-status",
      method: "query",
      path: "GET /store/:slug/order/:orderId",
      title: "Public: Order Status",
      description: "Raw HTTP endpoint (not tRPC), no authentication: the storefront's order page, where Razorpay sends the shopper back after paying and where order emails link. The order id is an unguessable UUID only the shopper was given. Returns the order's status, totals (subtotal, GST, total), lines, payment method and state and whether it can still be paid online. It never contains the shopper's phone, email or address, nor any key, token or Razorpay id. Unknown slug, store switched off, an organisation without the online store (or read-only/suspended), an unknown order and an order of another business all answer the same 404. Rate limited per client IP.",
      auth: "public",
      input: [
        { name: "slug", type: "string (path)", required: true, description: "The store's slug" },
        { name: "orderId", type: "string (path, UUID)", required: true, description: "The order id returned when it was placed" },
      ],
      output: {
        description: "The order, or 404 `{ error }`. `Cache-Control: no-store`.",
        example: {
          orderId: "order-uuid", orderNumber: "ORD-00012", status: "pending", paymentMethod: "online", paymentStatus: "unpaid",
          currency: "INR", subtotal: "100.00", taxAmount: "18.00", totalAmount: "118.00", refundedAmount: "0.00", balance: "118.00",
          canPayOnline: true, lines: [{ name: "Cotton shirt", quantity: "1.000", total: "118.00" }], createdAt: "2026-10-06T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/store/my-shop/order/ORDER_UUID"`,
        javascript: `const order = await (await fetch(\`${API_BASE_URL}/store/my-shop/order/\${orderId}\`, { credentials: "omit" })).json();`,
      },
      gotchas: [
        "Razorpay's return parameters on the order page are only a hint to look again: the order is marked paid only when the business's signed webhook arrives, so the page polls for a short while after the shopper returns.",
      ],
      relatedEndpoints: ["store-public-order-pay", "online-payments-webhook"],
    },
    {
      id: "store-public-order-pay",
      method: "mutation",
      path: "POST /store/:slug/order/:orderId/pay",
      title: "Public: Pay Again",
      description: "Raw HTTP endpoint (not tRPC), no authentication and no request body: makes (or reuses) the Razorpay payment link for an unpaid online order on the business's own Razorpay account and returns its URL. The amount is the invoice balance from the database; the link is for the whole amount (no part payments) and returns the shopper to `<STORE_URL>/<slug>/order/<id>` (configured, never taken from a request header). Asked again it returns the same live link; once the old link expired or was cancelled it makes a new one. Passes the store Origin allow-list, is rate limited per IP and to 6 attempts a minute per order, and answers the same neutral 404 as the other public store routes. Checkout itself, `POST /store/:slug/order`, takes `paymentMethod: \"online\" | \"cod\"` and returns `paymentUrl` for an online order; the order is saved even if Razorpay could not make the link.",
      auth: "public",
      input: [
        { name: "slug", type: "string (path)", required: true, description: "The store's slug" },
        { name: "orderId", type: "string (path, UUID)", required: true, description: "The order id" },
      ],
      output: {
        description: "`{ url }`. Errors: 404 (store or order not found), 409 (already paid, cancelled, Cash on Delivery or online payment switched off), 502 (Razorpay could not make the link), 429 (rate limited), 403 (origin not allowed).",
        example: { url: "https://rzp.io/i/abc123" },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/store/my-shop/order/ORDER_UUID/pay"`,
        javascript: `const res = await fetch(\`${API_BASE_URL}/store/my-shop/order/\${orderId}/pay\`, { method: "POST", credentials: "omit" });
if (res.ok) window.location.assign((await res.json()).url);`,
      },
      gotchas: [
        "A failed or abandoned payment leaves the order unpaid; the same order page offers Pay again, and a failed attempt emails the shopper the link (at most once every six hours).",
      ],
      relatedEndpoints: ["store-public-order-status", "online-payments-webhook"],
    },
  ],
};
