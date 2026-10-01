import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

export const warehouseEndpoints: EndpointGroup = {
  id: "warehouses",
  title: "Warehouses & Premises",
  description: "Configure where stock physically lives. The model has three levels: a premise is a site (shop, godown compound, factory) with an address; each warehouse belongs to exactly one premise and is the unit stock balances are kept against; locations are an optional AREA → RACK → SHELF → BIN tree inside a warehouse. Codes are unique per business for premises and warehouses, and per warehouse for locations. Inventory settings pick the default warehouse for each operation (sales, purchase, sales return, purchase return, production, stock adjustment) — the sales warehouse doubles as \"the default warehouse\" that holds legacy stock not yet placed in any warehouse. A business that has none gets a \"Main premises\" / \"Main warehouse\" (code `MAIN`) created automatically the first time stock moves (see `stock.setup`). Warehouse access grants let non-admin team members transfer or adjust stock in specific warehouses; owners and admins manage every warehouse without grants. Stock quantities, transfers, adjustments and counts live in the Stock group. Every mutation writes an audit log entry (`warehouse.premiseCreate`, `warehouse.warehouseUpdate`, `warehouse.accessSet`, and so on).",
  endpoints: [
    // ── Premises ────────────────────────────────────────────────
    {
      id: "warehouse-premise-list",
      method: "query",
      path: "warehouse.premiseList",
      title: "List Premises",
      description: "All premises of the active business, sorted by name. Returns the raw rows; there is no pagination or filtering.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Array of premise rows.",
        example: [
          {
            id: "premise-uuid",
            businessId: "biz-uuid",
            name: "Bhiwandi Godown",
            code: "BHW",
            address: "Gala No. 14, Rahnal Village, Bhiwandi",
            state: "Maharashtra",
            city: "Thane",
            status: "active",
            createdAt: "2026-04-02T06:15:00.000Z",
            updatedAt: "2026-04-02T06:15:00.000Z",
          },
          {
            id: "premise-uuid-2",
            businessId: "biz-uuid",
            name: "Main premises",
            code: "MAIN",
            address: "12 MG Road",
            state: "Maharashtra",
            city: "Pune",
            status: "active",
            createdAt: "2026-01-10T09:00:00.000Z",
            updatedAt: "2026-01-10T09:00:00.000Z",
          },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/warehouse.premiseList" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const premises = await trpc.warehouse.premiseList.query();
premises.forEach(p => console.log(p.code, p.name, p.city));`,
      },
      gotchas: [
        "Requires `Item:read` permission (every role except those with no permissions).",
      ],
      relatedEndpoints: ["warehouse-premise-get", "warehouse-premise-create", "warehouse-warehouse-list"],
    },
    {
      id: "warehouse-premise-get",
      method: "query",
      path: "warehouse.premiseGet",
      title: "Get Premise",
      description: "Fetch one premise of the active business by ID.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Premise ID" },
      ],
      output: {
        description: "The premise row.",
        example: {
          id: "premise-uuid",
          businessId: "biz-uuid",
          name: "Bhiwandi Godown",
          code: "BHW",
          address: "Gala No. 14, Rahnal Village, Bhiwandi",
          state: "Maharashtra",
          city: "Thane",
          status: "active",
          createdAt: "2026-04-02T06:15:00.000Z",
          updatedAt: "2026-04-02T06:15:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/warehouse.premiseGet?input=%7B%22json%22%3A%7B%22id%22%3A%22premise-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const premise = await trpc.warehouse.premiseGet.query({ id: "premise-uuid" });`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "Throws `NOT_FOUND` (\"Premise not found\") if the ID does not exist in the active business.",
      ],
      relatedEndpoints: ["warehouse-premise-list", "warehouse-premise-update"],
    },
    {
      id: "warehouse-premise-create",
      method: "mutation",
      path: "warehouse.premiseCreate",
      title: "Create Premise",
      description: "Add a premise (site) that warehouses can be attached to.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "name", type: "string", required: true, description: "Display name (1–255 chars)" },
        { name: "code", type: "string", required: true, description: "Short code, unique within the business (1–100 chars)" },
        { name: "address", type: "string | null", required: false, description: "Street address (max 1000 chars)" },
        { name: "state", type: "string | null", required: false, description: "State (max 100 chars)" },
        { name: "city", type: "string | null", required: false, description: "City (max 100 chars)" },
        { name: "status", type: "string", required: false, description: "Free-text status (max 50 chars). Only `active` has meaning elsewhere in the app.", default: "active" },
      ],
      output: {
        description: "The created premise row.",
        example: {
          id: "premise-uuid",
          businessId: "biz-uuid",
          name: "Bhiwandi Godown",
          code: "BHW",
          address: "Gala No. 14, Rahnal Village, Bhiwandi",
          state: "Maharashtra",
          city: "Thane",
          status: "active",
          createdAt: "2026-04-02T06:15:00.000Z",
          updatedAt: "2026-04-02T06:15:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/warehouse.premiseCreate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "name": "Bhiwandi Godown",
      "code": "BHW",
      "address": "Gala No. 14, Rahnal Village, Bhiwandi",
      "state": "Maharashtra",
      "city": "Thane"
    }
  }'`,
        javascript: `const premise = await trpc.warehouse.premiseCreate.mutate({
  name: "Bhiwandi Godown",
  code: "BHW",
  address: "Gala No. 14, Rahnal Village, Bhiwandi",
  state: "Maharashtra",
  city: "Thane",
});`,
      },
      gotchas: [
        "Requires `Business:manage` permission — in practice only owners (superadmin) and admins.",
        "Throws `CONFLICT` (\"A premise with this code already exists\") when the code is taken in this business. Codes are compared exactly (case-sensitive).",
      ],
      relatedEndpoints: ["warehouse-premise-list", "warehouse-warehouse-create"],
    },
    {
      id: "warehouse-premise-update",
      method: "mutation",
      path: "warehouse.premiseUpdate",
      title: "Update Premise",
      description: "Partially update a premise. Only the fields you send are changed; send `null` for `address`, `state` or `city` to clear them.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Premise ID" },
        { name: "name", type: "string", required: false, description: "Display name (1–255 chars)" },
        { name: "code", type: "string", required: false, description: "New code, unique within the business (1–100 chars)" },
        { name: "address", type: "string | null", required: false, description: "Street address (max 1000 chars)" },
        { name: "state", type: "string | null", required: false, description: "State (max 100 chars)" },
        { name: "city", type: "string | null", required: false, description: "City (max 100 chars)" },
        { name: "status", type: "string", required: false, description: "Free-text status (max 50 chars)" },
      ],
      output: {
        description: "The updated premise row.",
        example: {
          id: "premise-uuid",
          businessId: "biz-uuid",
          name: "Bhiwandi Godown (North)",
          code: "BHW-N",
          address: "Gala No. 14, Rahnal Village, Bhiwandi",
          state: "Maharashtra",
          city: "Thane",
          status: "active",
          createdAt: "2026-04-02T06:15:00.000Z",
          updatedAt: "2026-05-11T11:42:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/warehouse.premiseUpdate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"premise-uuid","name":"Bhiwandi Godown (North)","code":"BHW-N"}}'`,
        javascript: `await trpc.warehouse.premiseUpdate.mutate({
  id: "premise-uuid",
  name: "Bhiwandi Godown (North)",
  code: "BHW-N",
});`,
      },
      gotchas: [
        "Requires `Business:manage` permission.",
        "Throws `NOT_FOUND` if the premise is not in the active business, and `CONFLICT` if the new code belongs to another premise.",
        "Changing a premise's `status` does not cascade to its warehouses — deactivate warehouses individually with `warehouse.warehouseUpdate`.",
      ],
      relatedEndpoints: ["warehouse-premise-get", "warehouse-premise-delete"],
    },
    {
      id: "warehouse-premise-delete",
      method: "mutation",
      path: "warehouse.premiseDelete",
      title: "Delete Premise",
      description: "Permanently delete a premise. There is no soft delete.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Premise ID" },
      ],
      output: {
        description: "Confirmation with the deleted ID.",
        example: { success: true, id: "premise-uuid" },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/warehouse.premiseDelete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"premise-uuid"}}'`,
        javascript: `await trpc.warehouse.premiseDelete.mutate({ id: "premise-uuid" });`,
      },
      gotchas: [
        "Requires `Business:manage` permission.",
        "Throws `NOT_FOUND` (\"Premise not found\") if the ID is not in the active business.",
        "Warehouses reference their premise with `ON DELETE RESTRICT`, and the endpoint does not check for them first — deleting a premise that still has warehouses fails with a database foreign-key error (surfaced as `INTERNAL_SERVER_ERROR`) rather than a friendly message. Move or delete its warehouses first.",
      ],
      relatedEndpoints: ["warehouse-warehouse-update", "warehouse-warehouse-delete"],
    },

    // ── Warehouses ──────────────────────────────────────────────
    {
      id: "warehouse-warehouse-list",
      method: "query",
      path: "warehouse.warehouseList",
      title: "List Warehouses",
      description: "Warehouse rows of the active business, sorted by name, optionally limited to one premise. For warehouses with their current stock totals and the default flag, use `stock.warehouses`.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "premiseId", type: "string (UUID)", required: false, description: "Only warehouses of this premise. The whole input object is optional." },
      ],
      output: {
        description: "Array of warehouse rows (includes inactive ones).",
        example: [
          {
            id: "wh-uuid",
            businessId: "biz-uuid",
            premiseId: "premise-uuid",
            name: "Bhiwandi Finished Goods",
            code: "BHW-FG",
            warehouseType: "finished_goods",
            address: "Gala No. 14, Rahnal Village, Bhiwandi",
            status: "active",
            createdAt: "2026-04-02T06:20:00.000Z",
            updatedAt: "2026-04-02T06:20:00.000Z",
          },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/warehouse.warehouseList?input=%7B%22json%22%3A%7B%22premiseId%22%3A%22premise-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `// All warehouses
const all = await trpc.warehouse.warehouseList.query();

// Only those at one premise
const atBhiwandi = await trpc.warehouse.warehouseList.query({ premiseId: "premise-uuid" });`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "Inactive warehouses are included — filter on `status === \"active\"` if you are building a picker for new stock movements (transfers and adjustments reject inactive warehouses).",
      ],
      relatedEndpoints: ["warehouse-warehouse-get", "stock-warehouses"],
    },
    {
      id: "warehouse-warehouse-get",
      method: "query",
      path: "warehouse.warehouseGet",
      title: "Get Warehouse",
      description: "Fetch one warehouse row by ID.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Warehouse ID" },
      ],
      output: {
        description: "The warehouse row.",
        example: {
          id: "wh-uuid",
          businessId: "biz-uuid",
          premiseId: "premise-uuid",
          name: "Bhiwandi Finished Goods",
          code: "BHW-FG",
          warehouseType: "finished_goods",
          address: "Gala No. 14, Rahnal Village, Bhiwandi",
          status: "active",
          createdAt: "2026-04-02T06:20:00.000Z",
          updatedAt: "2026-04-02T06:20:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/warehouse.warehouseGet?input=%7B%22json%22%3A%7B%22id%22%3A%22wh-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const wh = await trpc.warehouse.warehouseGet.query({ id: "wh-uuid" });`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "Throws `NOT_FOUND` (\"Warehouse not found\") if the ID is not in the active business.",
      ],
      relatedEndpoints: ["warehouse-warehouse-list", "warehouse-location-list"],
    },
    {
      id: "warehouse-warehouse-create",
      method: "mutation",
      path: "warehouse.warehouseCreate",
      title: "Create Warehouse",
      description: "Add a warehouse under an existing premise. New warehouses start empty; move stock in with `stock.transfer` or `stock.adjust`, or pick them on documents.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "premiseId", type: "string (UUID)", required: true, description: "Premise this warehouse sits in (must belong to the active business)" },
        { name: "name", type: "string", required: true, description: "Display name (1–255 chars)" },
        { name: "code", type: "string", required: true, description: "Short code, unique within the business (1–100 chars)" },
        { name: "warehouseType", type: "string", required: true, description: "Free-text type label (1–50 chars), e.g. `main`, `finished_goods`, `raw_material`, `transit`. The auto-created default warehouse uses `main`." },
        { name: "address", type: "string | null", required: false, description: "Address (max 1000 chars)" },
        { name: "status", type: "string", required: false, description: "Free-text status (max 50 chars). Anything other than `active` blocks stock movements into or out of it.", default: "active" },
      ],
      output: {
        description: "The created warehouse row.",
        example: {
          id: "wh-uuid",
          businessId: "biz-uuid",
          premiseId: "premise-uuid",
          name: "Bhiwandi Finished Goods",
          code: "BHW-FG",
          warehouseType: "finished_goods",
          address: "Gala No. 14, Rahnal Village, Bhiwandi",
          status: "active",
          createdAt: "2026-04-02T06:20:00.000Z",
          updatedAt: "2026-04-02T06:20:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/warehouse.warehouseCreate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "premiseId": "premise-uuid",
      "name": "Bhiwandi Finished Goods",
      "code": "BHW-FG",
      "warehouseType": "finished_goods",
      "address": "Gala No. 14, Rahnal Village, Bhiwandi"
    }
  }'`,
        javascript: `const wh = await trpc.warehouse.warehouseCreate.mutate({
  premiseId: "premise-uuid",
  name: "Bhiwandi Finished Goods",
  code: "BHW-FG",
  warehouseType: "finished_goods",
});`,
      },
      gotchas: [
        "Requires `Business:manage` permission.",
        "Throws `BAD_REQUEST` (\"Premise does not belong to this business\") for an unknown `premiseId`, and `CONFLICT` (\"A warehouse with this code already exists\") for a duplicate code.",
        "The new warehouse is not made a default for anything — set that with `warehouse.inventorySettingsUpdate`.",
      ],
      relatedEndpoints: ["warehouse-premise-create", "warehouse-inventory-settings-update", "warehouse-access-set"],
    },
    {
      id: "warehouse-warehouse-update",
      method: "mutation",
      path: "warehouse.warehouseUpdate",
      title: "Update Warehouse",
      description: "Partially update a warehouse — rename it, change its code, move it to another premise, or deactivate it.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Warehouse ID" },
        { name: "premiseId", type: "string (UUID)", required: false, description: "Move to another premise of this business" },
        { name: "name", type: "string", required: false, description: "Display name (1–255 chars)" },
        { name: "code", type: "string", required: false, description: "New code, unique within the business (1–100 chars)" },
        { name: "warehouseType", type: "string", required: false, description: "Free-text type label (1–50 chars)" },
        { name: "address", type: "string | null", required: false, description: "Address (max 1000 chars); `null` clears it" },
        { name: "status", type: "string", required: false, description: "Free-text status (max 50 chars). Any value other than `active` is treated as inactive." },
      ],
      output: {
        description: "The updated warehouse row.",
        example: {
          id: "wh-uuid",
          businessId: "biz-uuid",
          premiseId: "premise-uuid",
          name: "Bhiwandi Finished Goods",
          code: "BHW-FG",
          warehouseType: "finished_goods",
          address: "Gala No. 14, Rahnal Village, Bhiwandi",
          status: "inactive",
          createdAt: "2026-04-02T06:20:00.000Z",
          updatedAt: "2026-06-18T08:05:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/warehouse.warehouseUpdate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"wh-uuid","status":"inactive"}}'`,
        javascript: `// Retire a warehouse (must be empty and not a default)
await trpc.warehouse.warehouseUpdate.mutate({ id: "wh-uuid", status: "inactive" });`,
      },
      gotchas: [
        "Requires `Business:manage` permission.",
        "Setting `status` to anything other than `active` is refused with `BAD_REQUEST` when the warehouse is a default in inventory settings (\"This is a default warehouse. Choose another default before making it inactive.\") or still holds stock (\"This warehouse still holds stock. Transfer it out before making it inactive.\"). \"Holds stock\" means the sum of absolute balances is non-zero, so negative balances count too.",
        "Throws `NOT_FOUND` for an unknown warehouse, `BAD_REQUEST` if `premiseId` is not in this business, and `CONFLICT` for a duplicate code.",
      ],
      relatedEndpoints: ["warehouse-warehouse-get", "warehouse-inventory-settings-update", "stock-transfer"],
    },
    {
      id: "warehouse-warehouse-delete",
      method: "mutation",
      path: "warehouse.warehouseDelete",
      title: "Delete Warehouse",
      description: "Permanently delete a warehouse that has never held stock. Its locations and member access grants are deleted with it (cascade).",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Warehouse ID" },
      ],
      output: {
        description: "Confirmation with the deleted ID.",
        example: { success: true, id: "wh-uuid" },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/warehouse.warehouseDelete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"wh-uuid"}}'`,
        javascript: `try {
  await trpc.warehouse.warehouseDelete.mutate({ id: "wh-uuid" });
} catch (e) {
  // Has stock history? Deactivate instead.
  await trpc.warehouse.warehouseUpdate.mutate({ id: "wh-uuid", status: "inactive" });
}`,
      },
      gotchas: [
        "Requires `Business:manage` permission.",
        "Throws `BAD_REQUEST` if the warehouse is a default for any operation in inventory settings, or if any stock movement has ever been recorded against it (\"This warehouse has stock history, so it can't be deleted. Mark it inactive instead.\").",
        "Throws `NOT_FOUND` (\"Warehouse not found\") if the ID is not in the active business.",
      ],
      relatedEndpoints: ["warehouse-warehouse-update", "warehouse-inventory-settings-update"],
    },

    // ── Locations ───────────────────────────────────────────────
    {
      id: "warehouse-location-list",
      method: "query",
      path: "warehouse.locationList",
      title: "List Locations",
      description: "All locations (areas, racks, shelves, bins) of one warehouse as a flat list sorted by name. Build the tree client-side from `parentId`.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "warehouseId", type: "string (UUID)", required: true, description: "Warehouse ID" },
      ],
      output: {
        description: "Array of location rows.",
        example: [
          {
            id: "loc-uuid-1",
            warehouseId: "wh-uuid",
            parentId: null,
            locationType: "AREA",
            name: "Aisle A",
            code: "A",
            status: "active",
            createdAt: "2026-04-03T07:00:00.000Z",
            updatedAt: "2026-04-03T07:00:00.000Z",
          },
          {
            id: "loc-uuid-2",
            warehouseId: "wh-uuid",
            parentId: "loc-uuid-1",
            locationType: "RACK",
            name: "Rack A-01",
            code: "A-01",
            status: "active",
            createdAt: "2026-04-03T07:02:00.000Z",
            updatedAt: "2026-04-03T07:02:00.000Z",
          },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/warehouse.locationList?input=%7B%22json%22%3A%7B%22warehouseId%22%3A%22wh-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const locations = await trpc.warehouse.locationList.query({ warehouseId: "wh-uuid" });
const roots = locations.filter(l => l.parentId === null);`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "Throws `NOT_FOUND` (\"Warehouse not found\") if the warehouse is not in the active business.",
        "The Stock endpoints (transfer, adjust, verify, counts) only work with the warehouse-level balance (no location). Locations are structure for now; stock recorded against a location is not counted as available by `stock.transfer` / `stock.adjust`.",
      ],
      relatedEndpoints: ["warehouse-location-create", "warehouse-warehouse-get"],
    },
    {
      id: "warehouse-location-create",
      method: "mutation",
      path: "warehouse.locationCreate",
      title: "Create Location",
      description: "Add a location inside a warehouse, optionally nested under another location of the same warehouse.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "warehouseId", type: "string (UUID)", required: true, description: "Warehouse the location belongs to" },
        { name: "parentId", type: "string (UUID) | null", required: false, description: "Parent location (must be in the same warehouse)" },
        { name: "locationType", type: "enum", required: true, description: "Kind of location. The API does not enforce a nesting order between types.", enumValues: ["AREA", "RACK", "SHELF", "BIN"] },
        { name: "name", type: "string", required: true, description: "Display name (1–255 chars)" },
        { name: "code", type: "string", required: true, description: "Code, unique within the warehouse (1–100 chars)" },
        { name: "status", type: "string", required: false, description: "Free-text status (max 50 chars)", default: "active" },
      ],
      output: {
        description: "The created location row.",
        example: {
          id: "loc-uuid-3",
          warehouseId: "wh-uuid",
          parentId: "loc-uuid-2",
          locationType: "SHELF",
          name: "Shelf A-01-3",
          code: "A-01-3",
          status: "active",
          createdAt: "2026-04-03T07:05:00.000Z",
          updatedAt: "2026-04-03T07:05:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/warehouse.locationCreate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "warehouseId": "wh-uuid",
      "parentId": "loc-uuid-2",
      "locationType": "SHELF",
      "name": "Shelf A-01-3",
      "code": "A-01-3"
    }
  }'`,
        javascript: `const shelf = await trpc.warehouse.locationCreate.mutate({
  warehouseId: "wh-uuid",
  parentId: "loc-uuid-2",
  locationType: "SHELF",
  name: "Shelf A-01-3",
  code: "A-01-3",
});`,
      },
      gotchas: [
        "Requires `Business:manage` permission.",
        "Throws `BAD_REQUEST` if the warehouse is not in this business (\"Warehouse does not belong to this business\") or the parent is not in that warehouse (\"Parent location does not belong to this warehouse\").",
        "Throws `CONFLICT` (\"A location with this code already exists\") for a duplicate code in the same warehouse. The same code may be reused in different warehouses.",
      ],
      relatedEndpoints: ["warehouse-location-list", "warehouse-location-update"],
    },
    {
      id: "warehouse-location-update",
      method: "mutation",
      path: "warehouse.locationUpdate",
      title: "Update Location",
      description: "Partially update a location, including re-parenting it within its warehouse. A location cannot be moved to another warehouse.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Location ID" },
        { name: "parentId", type: "string (UUID) | null", required: false, description: "New parent in the same warehouse; `null` makes it a root location" },
        { name: "locationType", type: "enum", required: false, description: "Kind of location", enumValues: ["AREA", "RACK", "SHELF", "BIN"] },
        { name: "name", type: "string", required: false, description: "Display name (1–255 chars)" },
        { name: "code", type: "string", required: false, description: "New code, unique within the warehouse (1–100 chars)" },
        { name: "status", type: "string", required: false, description: "Free-text status (max 50 chars)" },
      ],
      output: {
        description: "The updated location row.",
        example: {
          id: "loc-uuid-3",
          warehouseId: "wh-uuid",
          parentId: "loc-uuid-1",
          locationType: "SHELF",
          name: "Shelf A-3",
          code: "A-3",
          status: "active",
          createdAt: "2026-04-03T07:05:00.000Z",
          updatedAt: "2026-04-20T10:30:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/warehouse.locationUpdate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"loc-uuid-3","parentId":"loc-uuid-1","name":"Shelf A-3","code":"A-3"}}'`,
        javascript: `await trpc.warehouse.locationUpdate.mutate({
  id: "loc-uuid-3",
  parentId: "loc-uuid-1",
  name: "Shelf A-3",
  code: "A-3",
});`,
      },
      gotchas: [
        "Requires `Business:manage` permission.",
        "Throws `NOT_FOUND` (\"Location not found\") if the location's warehouse is not in the active business.",
        "Throws `BAD_REQUEST` when `parentId` equals `id` or the parent is in a different warehouse, and `CONFLICT` for a duplicate code in the warehouse.",
        "Only direct self-parenting is rejected — the API does not detect longer cycles (A → B → A), so validate re-parenting client-side.",
      ],
      relatedEndpoints: ["warehouse-location-list", "warehouse-location-delete"],
    },
    {
      id: "warehouse-location-delete",
      method: "mutation",
      path: "warehouse.locationDelete",
      title: "Delete Location",
      description: "Permanently delete a location.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Location ID" },
      ],
      output: {
        description: "Confirmation with the deleted ID.",
        example: { success: true, id: "loc-uuid-3" },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/warehouse.locationDelete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"loc-uuid-3"}}'`,
        javascript: `await trpc.warehouse.locationDelete.mutate({ id: "loc-uuid-3" });`,
      },
      gotchas: [
        "Requires `Business:manage` permission.",
        "Throws `NOT_FOUND` (\"Location not found\") if the location is not in a warehouse of the active business.",
        "`parentId` is not a foreign key, so deleting a location leaves its children pointing at a missing parent (they are not deleted or re-parented). Delete or move children first.",
      ],
      relatedEndpoints: ["warehouse-location-list", "warehouse-location-update"],
    },

    // ── Access ──────────────────────────────────────────────────
    {
      id: "warehouse-permission-create",
      method: "mutation",
      path: "warehouse.warehousePermissionCreate",
      title: "Create Own Warehouse Permission (legacy)",
      description: "Creates a warehouse permission row for the calling user's own business membership. Older endpoint kept for compatibility — to grant or change access for any team member use `warehouse.accessSet`.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "warehouseId", type: "string (UUID)", required: true, description: "Warehouse ID" },
        { name: "canView", type: "boolean", required: false, description: "Stored flag; not enforced by any endpoint today", default: "true" },
        { name: "canReceive", type: "boolean", required: false, description: "Stored flag; not enforced by any endpoint today", default: "false" },
        { name: "canIssue", type: "boolean", required: false, description: "Stored flag; not enforced by any endpoint today", default: "false" },
        { name: "canTransfer", type: "boolean", required: false, description: "Allows `stock.transfer` into/out of this warehouse", default: "false" },
        { name: "canAdjust", type: "boolean", required: false, description: "Allows `stock.adjust`, `stock.verify` and posting stock counts in this warehouse", default: "false" },
      ],
      output: {
        description: "The created permission row.",
        example: {
          id: "wperm-uuid",
          businessId: "biz-uuid",
          businessMemberId: "bm-uuid",
          warehouseId: "wh-uuid",
          canView: true,
          canReceive: false,
          canIssue: false,
          canTransfer: true,
          canAdjust: false,
          createdAt: "2026-04-05T12:00:00.000Z",
          updatedAt: "2026-04-05T12:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/warehouse.warehousePermissionCreate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"warehouseId":"wh-uuid","canTransfer":true}}'`,
        javascript: `await trpc.warehouse.warehousePermissionCreate.mutate({
  warehouseId: "wh-uuid",
  canTransfer: true,
});`,
      },
      gotchas: [
        "Requires `Business:manage` permission — which only owners and admins have, and they already manage every warehouse without grants. The row it creates therefore has no practical effect.",
        "Throws `FORBIDDEN` if the caller has no `business_members` row, `BAD_REQUEST` if the warehouse is not in this business, and `CONFLICT` (\"Warehouse permission already exists\") if the caller already has a row for this warehouse.",
      ],
      relatedEndpoints: ["warehouse-access-set", "warehouse-access-list"],
    },
    {
      id: "warehouse-access-list",
      method: "query",
      path: "warehouse.accessList",
      title: "List Warehouse Access",
      description: "Every team member of the active business with the role they act with and what they may do in one warehouse. Members without a grant row show all flags `false`.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "warehouseId", type: "string (UUID)", required: true, description: "Warehouse ID" },
      ],
      output: {
        description: "One entry per business member. `role` is the effective permission role (`superadmin`, `admin`, `seller_manager`, `seller`, `accountant`); `fullAccess` is true for admins and superadmins, who never need grants.",
        example: [
          {
            businessMemberId: "bm-uuid-1",
            name: "Rakesh Agarwal",
            email: "rakesh@agarwaltraders.in",
            role: "superadmin",
            fullAccess: true,
            canView: false,
            canReceive: false,
            canIssue: false,
            canTransfer: false,
            canAdjust: false,
          },
          {
            businessMemberId: "bm-uuid-2",
            name: "Sunita Patil",
            email: "sunita@agarwaltraders.in",
            role: "seller_manager",
            fullAccess: false,
            canView: true,
            canReceive: false,
            canIssue: false,
            canTransfer: true,
            canAdjust: true,
          },
        ],
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/warehouse.accessList?input=%7B%22json%22%3A%7B%22warehouseId%22%3A%22wh-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const access = await trpc.warehouse.accessList.query({ warehouseId: "wh-uuid" });
const canMoveStock = access.filter(a => a.fullAccess || a.canTransfer);`,
      },
      gotchas: [
        "Requires `Business:manage` permission, even though it is a read.",
        "The warehouse ID is not validated — an unknown or foreign ID just returns every member with all flags `false`.",
        "The role is resolved the same way as request auth: a business-level `admin` membership makes the user `admin` (or `superadmin` if they own the tenant); otherwise the tenant role is mapped (`member` → `seller`, `viewer` → `accountant`, `owner` → `superadmin`).",
      ],
      relatedEndpoints: ["warehouse-access-set", "stock-transfer", "stock-adjust"],
    },
    {
      id: "warehouse-access-set",
      method: "mutation",
      path: "warehouse.accessSet",
      title: "Set Warehouse Access",
      description: "Grant, change or remove one team member's access to a warehouse (upsert). Sending every flag as `false` deletes the grant row.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "warehouseId", type: "string (UUID)", required: true, description: "Warehouse ID" },
        { name: "businessMemberId", type: "string (UUID)", required: true, description: "Business member (from `warehouse.accessList`), not a user ID" },
        { name: "canView", type: "boolean", required: true, description: "Stored flag; not enforced by any endpoint today" },
        { name: "canReceive", type: "boolean", required: true, description: "Stored flag; not enforced by any endpoint today" },
        { name: "canIssue", type: "boolean", required: true, description: "Stored flag; not enforced by any endpoint today" },
        { name: "canTransfer", type: "boolean", required: true, description: "May use `stock.transfer` with this warehouse as source or destination" },
        { name: "canAdjust", type: "boolean", required: true, description: "May use `stock.adjust`, `stock.verify`, `stock.countFinish` (with `post: true`) and `stock.countPost` here" },
      ],
      output: {
        description: "Acknowledgement.",
        example: { ok: true },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/warehouse.accessSet \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "warehouseId": "wh-uuid",
      "businessMemberId": "bm-uuid-2",
      "canView": true,
      "canReceive": false,
      "canIssue": false,
      "canTransfer": true,
      "canAdjust": true
    }
  }'`,
        javascript: `// Let a store manager move and adjust stock at this godown
await trpc.warehouse.accessSet.mutate({
  warehouseId: "wh-uuid",
  businessMemberId: "bm-uuid-2",
  canView: true,
  canReceive: false,
  canIssue: false,
  canTransfer: true,
  canAdjust: true,
});`,
      },
      gotchas: [
        "Requires `Business:manage` permission.",
        "Throws `NOT_FOUND` (\"Warehouse not found\" / \"Team member not found\") if either ID is not in the active business.",
        "All five flags are required on every call — this replaces the row, it does not merge.",
        "Grants only matter for roles that already have `Item:update` but are not admins — in practice `seller_manager`. Sellers and accountants cannot transfer or adjust at all, and admins/owners bypass grants.",
      ],
      relatedEndpoints: ["warehouse-access-list", "stock-transfer", "stock-adjust", "stock-verify"],
    },

    // ── Inventory settings ──────────────────────────────────────
    {
      id: "warehouse-inventory-settings-get",
      method: "query",
      path: "warehouse.inventorySettingsGet",
      title: "Get Inventory Settings",
      description: "The raw inventory settings row: default warehouse per operation, negative stock policy and valuation method. Returns `null` if the business has never had one created (unlike `stock.settings`, this does not create it).",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Inventory settings row or `null`.",
        example: {
          id: "invset-uuid",
          businessId: "biz-uuid",
          salesWarehouseId: "wh-uuid",
          purchaseWarehouseId: "wh-uuid",
          salesReturnWarehouseId: "wh-uuid",
          purchaseReturnWarehouseId: "wh-uuid",
          productionWarehouseId: "wh-uuid-2",
          stockAdjustmentWarehouseId: "wh-uuid",
          negativeStockPolicy: "warn",
          valuationMethod: "weighted_average",
          createdAt: "2026-01-10T09:00:00.000Z",
          updatedAt: "2026-04-02T06:30:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/warehouse.inventorySettingsGet" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const settings = await trpc.warehouse.inventorySettingsGet.query();
const defaultWarehouseId = settings?.salesWarehouseId ?? null;`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "`salesWarehouseId` is what the Stock endpoints call \"the default warehouse\" — legacy stock that no warehouse accounts for is shown and placed there.",
      ],
      relatedEndpoints: ["warehouse-inventory-settings-update", "stock-settings"],
    },
    {
      id: "warehouse-inventory-settings-update",
      method: "mutation",
      path: "warehouse.inventorySettingsUpdate",
      title: "Update Default Warehouses",
      description: "Set the default warehouse for each operation. Creates the settings row if it does not exist. The negative stock policy and valuation method are changed with `stock.updateSettings` instead.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "salesWarehouseId", type: "string (UUID) | null", required: false, description: "Default for sales documents; also the business's default warehouse for unplaced stock" },
        { name: "purchaseWarehouseId", type: "string (UUID) | null", required: false, description: "Default for purchase documents" },
        { name: "salesReturnWarehouseId", type: "string (UUID) | null", required: false, description: "Default for sales returns" },
        { name: "purchaseReturnWarehouseId", type: "string (UUID) | null", required: false, description: "Default for purchase returns" },
        { name: "productionWarehouseId", type: "string (UUID) | null", required: false, description: "Default for manufacturing / production" },
        { name: "stockAdjustmentWarehouseId", type: "string (UUID) | null", required: false, description: "Default for stock adjustments" },
      ],
      output: {
        description: "The saved inventory settings row.",
        example: {
          id: "invset-uuid",
          businessId: "biz-uuid",
          salesWarehouseId: "wh-uuid",
          purchaseWarehouseId: "wh-uuid",
          salesReturnWarehouseId: "wh-uuid",
          purchaseReturnWarehouseId: "wh-uuid",
          productionWarehouseId: "wh-uuid-2",
          stockAdjustmentWarehouseId: "wh-uuid",
          negativeStockPolicy: "warn",
          valuationMethod: "weighted_average",
          createdAt: "2026-01-10T09:00:00.000Z",
          updatedAt: "2026-06-01T05:45:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/warehouse.inventorySettingsUpdate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "salesWarehouseId": "wh-uuid",
      "purchaseWarehouseId": "wh-uuid",
      "salesReturnWarehouseId": "wh-uuid",
      "purchaseReturnWarehouseId": "wh-uuid",
      "productionWarehouseId": "wh-uuid-2",
      "stockAdjustmentWarehouseId": "wh-uuid"
    }
  }'`,
        javascript: `// Always send all six — omitted ones are cleared
const current = await trpc.warehouse.inventorySettingsGet.query();
await trpc.warehouse.inventorySettingsUpdate.mutate({
  salesWarehouseId: current?.salesWarehouseId,
  purchaseWarehouseId: current?.purchaseWarehouseId,
  salesReturnWarehouseId: current?.salesReturnWarehouseId,
  purchaseReturnWarehouseId: current?.purchaseReturnWarehouseId,
  productionWarehouseId: "wh-uuid-2",
  stockAdjustmentWarehouseId: current?.stockAdjustmentWarehouseId,
});`,
      },
      gotchas: [
        "Requires `Business:manage` permission.",
        "Not a partial update: every field you omit is written as `null`. Read the current settings first and send all six IDs.",
        "Throws `BAD_REQUEST` (\"One or more selected warehouses do not belong to the current business\") for a foreign or unknown ID. Inactive warehouses are accepted here, but document posting later fails if a default warehouse is inactive.",
        "A `null` sales warehouse leaves the business with no default; Stock endpoints then stop attributing unplaced stock to any warehouse (`stock.balances` / `stock.availability`), and `stock.warehouses` falls back to the first active warehouse. Write paths that need to place unplaced stock (transfer, adjust, verify, counts) then fail with a server error, so always keep a sales warehouse set.",
      ],
      relatedEndpoints: ["warehouse-inventory-settings-get", "stock-update-settings", "stock-settings"],
    },
  ],
};
