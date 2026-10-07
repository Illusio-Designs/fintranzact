/**
 * create_party and create_item: run party.create / item.create as the person.
 * Small and exact: only the fields the person gave; the procedure fills in the
 * rest (PAN and state from a GSTIN, defaults) exactly as the screen does. A
 * likely duplicate is shown as a warning on the card, never silently skipped.
 */

import {
  AI_ACTION_TOOL_NAMES,
  aiCreateItemInputSchema,
  aiCreatePartyInputSchema,
  createItemSchema,
  createPartySchema,
  units,
  type AiActionPreview,
} from "@fintranzact/shared";
import { AiActionEditError, AiToolInputError } from "../../errors.js";
import { clip } from "../../format.js";
import { editAmount, editPercent, editQuantity, inr, itemCandidates, parseReal, trimNum, zodMessage } from "../helpers.js";
import type { AiActionCtx, AiActionDef, BuiltAction } from "../types.js";

const sameName = (a: unknown, b: string) => String(a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

// ── Party ────────────────────────────────────────────────────────────────────

async function buildParty(ctx: AiActionCtx, payload: Record<string, unknown>): Promise<BuiltAction> {
  const input = parseReal(createPartySchema, payload);
  const warnings: string[] = [];
  const found = await ctx.caller.party.list({ search: input.name, filter: "all", sortBy: "name", sortDir: "asc", page: 1, limit: 5 });
  const dup = (found.data ?? []).find((p) => sameName(p.name, input.name));
  if (dup) warnings.push(`A ${dup.type} named "${clip(dup.name, 60)}" already exists. Adding another makes a duplicate.`);
  const fields = [
    { label: "Type", value: input.type === "customer" ? "Customer" : "Supplier" },
    { label: "Name", value: clip(input.name, 100) },
    ...(input.phone ? [{ label: "Phone", value: clip(input.phone, 15) }] : []),
    ...(input.email ? [{ label: "Email", value: clip(input.email, 100) }] : []),
    ...(input.gstin ? [{ label: "GSTIN", value: clip(input.gstin, 15) }] : []),
    ...(input.city ? [{ label: "City", value: clip(input.city, 60) }] : []),
    ...(input.state ? [{ label: "State", value: clip(input.state, 60) }] : []),
    ...(input.billingAddress ? [{ label: "Address", value: clip(input.billingAddress, 200) }] : []),
  ];
  const preview: AiActionPreview = {
    title: input.type === "customer" ? "Add customer" : "Add supplier",
    fields,
    totals: [],
    warnings,
    note: "Nothing is saved until you tap Confirm. PAN and state are filled from the GSTIN when you give one.",
    edits: [
      { key: "name", label: "Name", input: "text", value: input.name, maxLength: 200 },
      { key: "type", label: "Type", input: "select", value: input.type, options: [{ value: "customer", label: "Customer" }, { value: "supplier", label: "Supplier" }] },
      { key: "phone", label: "Phone", input: "text", value: input.phone ?? "", maxLength: 15 },
      { key: "email", label: "Email", input: "text", value: input.email ?? "", maxLength: 200 },
      { key: "gstin", label: "GSTIN", input: "text", value: input.gstin ?? "", maxLength: 15 },
      { key: "city", label: "City", input: "text", value: input.city ?? "", maxLength: 100 },
      { key: "state", label: "State", input: "text", value: input.state ?? "", maxLength: 100 },
      { key: "billingAddress", label: "Address", input: "text", value: input.billingAddress ?? "", maxLength: 500 },
    ],
  };
  return { payload: input as unknown as Record<string, unknown>, preview, summary: clip(`Add ${input.type} ${input.name}`, 200) };
}

export const createPartyKind: AiActionDef = {
  kind: "create_party",
  toolName: AI_ACTION_TOOL_NAMES.create_party,
  description:
    "Prepare a new CUSTOMER or SUPPLIER for the person to review. Nothing is saved: the person sees a confirmation card and must tap Confirm. Check with find_parties first that the party does not already exist. Only include details the person gave.",
  properties: {
    type: { type: "string", enum: ["customer", "supplier"] },
    name: { type: "string" },
    phone: { type: "string" },
    email: { type: "string" },
    gstin: { type: "string", description: "15-character GSTIN, only if given." },
    city: { type: "string" },
    state: { type: "string" },
    billingAddress: { type: "string" },
  },
  required: ["type", "name"],
  inputSchema: aiCreatePartyInputSchema,

  async propose(ctx, rawInput: never) {
    const input = rawInput as Record<string, string>;
    const candidate: Record<string, unknown> = { type: input.type, name: input.name };
    for (const k of ["phone", "email", "gstin", "city", "state", "billingAddress"]) if (input[k]) candidate[k] = input[k];
    const parsed = createPartySchema.safeParse(candidate);
    if (!parsed.success) throw new AiToolInputError(`Invalid party: ${zodMessage(parsed.error)}`);
    return buildParty(ctx, parsed.data as unknown as Record<string, unknown>);
  },

  build: buildParty,

  applyEdits(payload, edits) {
    const next = structuredClone(payload) as Record<string, unknown>;
    for (const [key, raw] of Object.entries(edits)) {
      const v = raw.trim();
      if (key === "name") {
        if (!v) throw new AiActionEditError("Name cannot be empty.");
        next.name = v.slice(0, 200);
      } else if (key === "type") {
        if (v !== "customer" && v !== "supplier") throw new AiActionEditError("Type: pick customer or supplier.");
        next.type = v;
      } else if (["phone", "email", "gstin", "city", "state", "billingAddress"].includes(key)) {
        if (v) next[key] = key === "gstin" ? v.toUpperCase() : v;
        else delete next[key];
      } else throw new AiActionEditError(`"${clip(key, 40)}" cannot be edited here.`);
    }
    return next;
  },

  async execute(ctx, payload) {
    const input = parseReal(createPartySchema, payload);
    const party = await ctx.caller.party.create(input);
    return { entityType: "party", id: party.id, label: `${input.type === "customer" ? "Customer" : "Supplier"} ${clip(party.name, 80)}` };
  },
};

// ── Item ─────────────────────────────────────────────────────────────────────

async function buildItem(ctx: AiActionCtx, payload: Record<string, unknown>): Promise<BuiltAction> {
  const input = parseReal(createItemSchema, payload);
  const warnings: string[] = [];
  const found = await itemCandidates(ctx, input.name);
  const dup = found.rows.find((i) => sameName(i.name, input.name));
  if (dup) warnings.push(`An item named "${clip(dup.name, 60)}" already exists. Adding another makes a duplicate.`);
  if (!input.salePrice) warnings.push("No sale price is set: you will have to give a rate every time you bill it.");
  const isService = input.itemType === "service";
  const preview: AiActionPreview = {
    title: isService ? "Add service" : "Add item",
    fields: [
      { label: "Name", value: clip(input.name, 100) },
      { label: "Type", value: isService ? "Service" : "Product" },
      { label: "Unit", value: input.unit },
      { label: "Sale price", value: input.salePrice ? inr(input.salePrice) : "Not set" },
      ...(input.purchasePrice ? [{ label: "Purchase price", value: inr(input.purchasePrice) }] : []),
      { label: "GST", value: `${trimNum(input.taxPercent)}%` },
      ...(input.hsn ? [{ label: "HSN / SAC", value: clip(input.hsn, 20) }] : []),
      ...(!isService ? [{ label: "Opening stock", value: trimNum(input.stockQuantity) }] : []),
    ],
    totals: [],
    warnings,
    note: "Nothing is saved until you tap Confirm.",
    edits: [
      { key: "name", label: "Name", input: "text", value: input.name, maxLength: 200 },
      { key: "unit", label: "Unit", input: "select", value: input.unit, options: units.map((u) => ({ value: u, label: u })) },
      { key: "salePrice", label: "Sale price", input: "number", value: input.salePrice ?? "" },
      { key: "purchasePrice", label: "Purchase price", input: "number", value: input.purchasePrice ?? "" },
      { key: "taxPercent", label: "GST %", input: "number", value: input.taxPercent },
      { key: "hsn", label: "HSN / SAC", input: "text", value: input.hsn ?? "", maxLength: 20 },
      ...(!isService ? [{ key: "stockQuantity", label: "Opening stock", input: "number" as const, value: input.stockQuantity }] : []),
    ],
  };
  return { payload: input as unknown as Record<string, unknown>, preview, summary: clip(`Add ${isService ? "service" : "item"} ${input.name}`, 200) };
}

export const createItemKind: AiActionDef = {
  kind: "create_item",
  toolName: AI_ACTION_TOOL_NAMES.create_item,
  description:
    "Prepare a new ITEM (product or service) for the person to review. Nothing is saved: the person sees a confirmation card and must tap Confirm. Check with find_items first that it does not already exist. Only include prices, GST, HSN or opening stock the person gave.",
  properties: {
    name: { type: "string" },
    itemType: { type: "string", enum: ["product", "service"] },
    unit: { type: "string", enum: [...units], description: "Default pcs." },
    salePrice: { type: "number" },
    purchasePrice: { type: "number" },
    taxPercent: { type: "number", description: "GST percent, only if given." },
    hsn: { type: "string" },
    openingStock: { type: "number" },
  },
  required: ["name"],
  inputSchema: aiCreateItemInputSchema,

  async propose(ctx, rawInput: never) {
    const input = rawInput as Record<string, string>;
    const candidate: Record<string, unknown> = { name: input.name };
    for (const k of ["itemType", "unit", "salePrice", "purchasePrice", "taxPercent", "hsn"]) if (input[k]) candidate[k] = input[k];
    if (input.openingStock) candidate.stockQuantity = input.openingStock;
    const parsed = createItemSchema.safeParse(candidate);
    if (!parsed.success) throw new AiToolInputError(`Invalid item: ${zodMessage(parsed.error)}`);
    return buildItem(ctx, parsed.data as unknown as Record<string, unknown>);
  },

  build: buildItem,

  applyEdits(payload, edits) {
    const next = structuredClone(payload) as Record<string, unknown>;
    for (const [key, raw] of Object.entries(edits)) {
      const v = raw.trim();
      if (key === "name") {
        if (!v) throw new AiActionEditError("Name cannot be empty.");
        next.name = v.slice(0, 200);
      } else if (key === "unit") {
        if (!(units as readonly string[]).includes(v)) throw new AiActionEditError("Unit: pick one from the list.");
        next.unit = v;
      } else if (key === "salePrice" || key === "purchasePrice") {
        if (v) next[key] = editAmount(v, key === "salePrice" ? "Sale price" : "Purchase price");
        else delete next[key];
      } else if (key === "taxPercent") next.taxPercent = editPercent(v || "0", "GST", 56);
      else if (key === "hsn") {
        if (v) next.hsn = v.slice(0, 20);
        else delete next.hsn;
      } else if (key === "stockQuantity") next.stockQuantity = v ? editQuantity(v, "Opening stock") : "0";
      else throw new AiActionEditError(`"${clip(key, 40)}" cannot be edited here.`);
    }
    return next;
  },

  async execute(ctx, payload) {
    const input = parseReal(createItemSchema, payload);
    const item = await ctx.caller.item.create(input);
    return { entityType: "item", id: item.id, label: `Item ${clip(item.name, 80)}` };
  },
};
