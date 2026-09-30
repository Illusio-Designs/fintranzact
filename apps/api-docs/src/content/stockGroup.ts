import type { EndpointGroup } from "./types";
const API_BASE_URL = (import.meta.env.API_URL || (typeof window !== "undefined" ? window.location.origin : "https://fintranzact-production.up.railway.app")).replace(/\/$/, "");

export const stockGroupEndpoints: EndpointGroup = {
  id: "stock-groups",
  title: "Stock Groups",
  description: "Stock groups (Tally's \"Stock Groups\") are a per-business tree that items are filed under — e.g. Finished Goods → Kurtas. Each group has a `name` (unique per business, compared case-insensitively on create/rename) and an optional `parentId`. They replace the free-text item `category`: the category column is kept and always set to the item's group name, so older clients (CLI, mobile, online store) still see a category. Items are assigned to a group through `item.create`/`item.update` (`stockGroupId`, or a `category` name that is matched to — or creates — a top-level group of that name). Groups feed the `inventoryReports.stockGroupSummary` report. All changes are written to the audit log.",
  endpoints: [
    {
      id: "stock-group-list",
      method: "query",
      path: "stockGroup.list",
      title: "List Stock Groups",
      description: "Every stock group in tree order (parents before children, siblings sorted by name) with its depth and item counts. `itemCount` includes items in sub-groups; `directItemCount` counts only items filed directly in the group.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Groups in tree order and the number of items with no group.",
        example: {
          data: [
            { id: "group-uuid-1", name: "Finished Goods", parentId: null, depth: 0, directItemCount: 2, itemCount: 9, childCount: 2 },
            { id: "group-uuid-2", name: "Kurtas", parentId: "group-uuid-1", depth: 1, directItemCount: 4, itemCount: 4, childCount: 0 },
            { id: "group-uuid-3", name: "Sarees", parentId: "group-uuid-1", depth: 1, directItemCount: 3, itemCount: 3, childCount: 0 },
            { id: "group-uuid-4", name: "Raw Material", parentId: null, depth: 0, directItemCount: 5, itemCount: 5, childCount: 0 },
          ],
          ungroupedItemCount: 7,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/stockGroup.list" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, ungroupedItemCount } = await trpc.stockGroup.list.query();

data.forEach(g => console.log(\`\${"  ".repeat(g.depth)}\${g.name} (\${g.itemCount})\`));
console.log("Ungrouped items:", ungroupedItemCount);`,
      },
      gotchas: [
        "Requires `Item:read` permission.",
        "Counts include every non-deleted item — products and services alike.",
        "Not paginated; the whole tree is returned.",
      ],
      relatedEndpoints: ["stock-group-create", "inventory-reports-stock-group-summary"],
    },
    {
      id: "stock-group-create",
      method: "mutation",
      path: "stockGroup.create",
      title: "Create Stock Group",
      description: "Create a stock group, at the top level or under an existing group.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "name", type: "string", required: true, description: "Group name, trimmed, 1–100 characters. Must not match another group's name (case-insensitive)." },
        { name: "parentId", type: "string (UUID) | null", required: false, description: "Parent group. Omit or null for a top-level group." },
      ],
      output: {
        description: "The created stock group row.",
        example: {
          id: "group-uuid-2",
          businessId: "biz-uuid",
          name: "Kurtas",
          parentId: "group-uuid-1",
          createdAt: "2026-09-30T06:45:12.000Z",
          updatedAt: "2026-09-30T06:45:12.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/stockGroup.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"name":"Kurtas","parentId":"group-uuid-1"}}'`,
        javascript: `const top = await trpc.stockGroup.create.mutate({ name: "Finished Goods" });
const kurtas = await trpc.stockGroup.create.mutate({ name: "Kurtas", parentId: top.id });`,
      },
      gotchas: [
        "Requires `Item:create` permission.",
        "CONFLICT `A stock group named \"...\" already exists` when the name matches any group of the business, ignoring case — group names are unique across the whole tree, not just among siblings.",
        "NOT_FOUND `Stock group not found` if `parentId` is not a group of this business.",
        "Writes a `stockGroup.create` audit log entry.",
      ],
      relatedEndpoints: ["stock-group-list", "stock-group-move"],
    },
    {
      id: "stock-group-rename",
      method: "mutation",
      path: "stockGroup.rename",
      title: "Rename Stock Group",
      description: "Rename a group. In the same transaction, the `category` of every item directly in the group is set to the new name.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Group to rename" },
        { name: "name", type: "string", required: true, description: "New name, trimmed, 1–100 characters, unique per business (case-insensitive)" },
      ],
      output: {
        description: "The updated stock group row.",
        example: {
          id: "group-uuid-2",
          businessId: "biz-uuid",
          name: "Kurtas & Kurtis",
          parentId: "group-uuid-1",
          createdAt: "2026-09-30T06:45:12.000Z",
          updatedAt: "2026-09-30T07:10:03.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/stockGroup.rename \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"group-uuid-2","name":"Kurtas & Kurtis"}}'`,
        javascript: `await trpc.stockGroup.rename.mutate({ id: "group-uuid-2", name: "Kurtas & Kurtis" });`,
      },
      gotchas: [
        "Requires `Item:update` permission.",
        "NOT_FOUND if the group doesn't exist; CONFLICT if another group already has the name (renaming to a different casing of its own name is allowed).",
        "Items' `category` follows the new name — including soft-deleted items in the group. Items in sub-groups are unaffected (their category is their own group's name).",
        "Writes a `stockGroup.rename` audit log entry with the old and new names.",
      ],
      relatedEndpoints: ["stock-group-list"],
    },
    {
      id: "stock-group-move",
      method: "mutation",
      path: "stockGroup.move",
      title: "Move Stock Group",
      description: "Put a group under another group, or at the top level with `parentId: null`. Its sub-groups and items move with it.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Group to move" },
        { name: "parentId", type: "string (UUID) | null", required: true, description: "New parent group, or `null` for top level. The key must be present." },
      ],
      output: {
        description: "The updated stock group row.",
        example: {
          id: "group-uuid-3",
          businessId: "biz-uuid",
          name: "Sarees",
          parentId: null,
          createdAt: "2026-09-12T09:00:00.000Z",
          updatedAt: "2026-09-30T07:15:40.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/stockGroup.move \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"group-uuid-3","parentId":null}}'`,
        javascript: `// Move "Sarees" to the top level
await trpc.stockGroup.move.mutate({ id: "group-uuid-3", parentId: null });`,
      },
      gotchas: [
        "Requires `Item:update` permission.",
        "`parentId` is required-but-nullable: omitting it fails validation; send `null` explicitly to move to the top.",
        "BAD_REQUEST `A stock group can't be moved under itself or one of its sub-groups` — cycles are refused.",
        "NOT_FOUND if either the group or the new parent doesn't belong to the business.",
        "Writes a `stockGroup.move` audit log entry.",
      ],
      relatedEndpoints: ["stock-group-list", "stock-group-create"],
    },
    {
      id: "stock-group-delete",
      method: "mutation",
      path: "stockGroup.delete",
      title: "Delete Stock Group",
      description: "Delete a group. Without `reassignItemsTo` the group must be empty — no (non-deleted) items and no sub-groups. With `reassignItemsTo` present, its items move to that group (or become ungrouped when it is `null`) and its sub-groups move up to its parent. Runs in one transaction.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Group to delete" },
        { name: "reassignItemsTo", type: "string (UUID) | null", required: false, description: "Omit to require an empty group. A group id moves the items there; `null` makes them ungrouped. Either way sub-groups move up one level." },
      ],
      output: {
        description: "Success flag.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST ${API_BASE_URL}/api/trpc/stockGroup.delete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"group-uuid-2","reassignItemsTo":"group-uuid-1"}}'`,
        javascript: `// Fold "Kurtas" into its parent "Finished Goods"
await trpc.stockGroup.delete.mutate({ id: "group-uuid-2", reassignItemsTo: "group-uuid-1" });

// Delete and leave its items ungrouped
await trpc.stockGroup.delete.mutate({ id: "group-uuid-5", reassignItemsTo: null });`,
      },
      gotchas: [
        "Requires `Item:delete` permission — by default only admins and superadmins have it.",
        "`reassignItemsTo: null` and omitting the field behave differently: `null` ungroups the items, omitting it refuses to delete a non-empty group.",
        "PRECONDITION_FAILED `\"<name>\" still has N items and M sub-groups. Move them first or choose a group to move them to.` when the group isn't empty and no reassignment was given.",
        "BAD_REQUEST `Choose a different group to move the items to` when `reassignItemsTo` equals `id`. NOT_FOUND if the group or the target doesn't exist.",
        "Reassigned items (soft-deleted ones included) get `category` set to the target group's name, or null when ungrouped.",
        "Writes a `stockGroup.delete` audit log entry.",
      ],
      relatedEndpoints: ["stock-group-list", "stock-group-move"],
    },
  ],
};
