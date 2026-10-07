/**
 * create_invoice and create_quotation. Both run the real procedure
 * (invoice.create / quotation.create) with createInvoiceSchema's input, so
 * numbering, GST, stock, period locks and plan limits all apply when the person
 * confirms. The card shows the figures from the SAME calculation the procedure
 * uses (calcLineItem / calcInvoiceTotals with the same intra-state rule), so
 * what is reviewed is what is saved.
 */

import {
  AI_ACTION_TOOL_NAMES,
  aiCreateInvoiceInputSchema,
  aiCreateQuotationInputSchema,
  calcInvoiceTotals,
  calcLineItem,
  createInvoiceSchema,
  splitIntraStateTax,
  type AiActionKind,
  type AiActionPreview,
  type AiActionLine,
} from "@fintranzact/shared";
import { documentIsIntraState } from "../../../document-totals.js";
import { AiActionEditError, AiToolInputError } from "../../errors.js";
import { clip } from "../../format.js";
import {
  editAmount, editDate, editPercent, editQuantity, inr, isoToYmd, itemCandidates, itemMatchesMessage, loadItem, parseReal, prettyYmd, resolveParty,
  todayYmd, trimNum, ymdToIso, zodMessage,
} from "../helpers.js";
import type { AiActionCtx, AiActionDef, BuiltAction } from "../types.js";

type Doc = ReturnType<typeof createInvoiceSchema.parse>;
const MAX_EDITABLE_LINES = 20;

const LINE_PROPS = {
  type: "array",
  description: "Lines to bill (1-20). Use an itemId from find_items for catalogue items: the rate and GST then default to the item's own. Only add rate, GST or discount when the person said them.",
  items: {
    type: "object",
    properties: {
      itemId: { type: "string", description: "Item id (UUID) from find_items." },
      itemName: { type: "string", description: "Only for a one-off line that is not in the catalogue (with freeText true)." },
      freeText: { type: "boolean", description: "True for a one-off line that is not in the catalogue." },
      quantity: { type: "number", description: "Quantity the person gave." },
      unitPrice: { type: "number", description: "Rate per unit, only if the person gave it (or the item has no sale price)." },
      taxPercent: { type: "number", description: "GST percent, only if the person gave it." },
      discountPercent: { type: "number", description: "Discount percent, only if the person gave it." },
      description: { type: "string", description: "Optional line note." },
    },
    required: ["quantity"],
    additionalProperties: false,
  },
};

const DOC_PROPS = {
  partyId: { type: "string", description: "Customer id (UUID) from find_parties. Always use this." },
  partyName: { type: "string", description: "Only if you have no id: the server returns candidates, it never picks one." },
  date: { type: "string", description: "Document date YYYY-MM-DD (Indian time). Default today." },
  dueDate: { type: "string", description: "Payment due date (invoice) or valid-until date (quotation), YYYY-MM-DD, only if the person gave it." },
  notes: { type: "string", description: "Optional note printed on the document." },
  lines: LINE_PROPS,
};

function makeDocumentKind(kind: Extract<AiActionKind, "create_invoice" | "create_quotation">): AiActionDef {
  const isInvoice = kind === "create_invoice";
  const noun = isInvoice ? "invoice" : "quotation";

  async function build(ctx: AiActionCtx, payload: Record<string, unknown>): Promise<BuiltAction> {
    const input = parseReal(createInvoiceSchema, payload);
    const party = await ctx.caller.party.getById({ id: input.partyId });
    if (!party) throw new AiToolInputError("The customer is no longer in this business.");
    const intra = await documentIsIntraState(ctx.db, ctx.businessId, input.partyId);

    const calcLines = input.lineItems.map((li) => ({
      li,
      calc: calcLineItem({ quantity: li.quantity, unitPrice: li.unitPrice, taxPercent: li.taxPercent || "0", discountPercent: li.discountPercent || "0", intraState: intra }),
    }));
    // The same call the procedure makes, with the same inputs.
    const charges = input.charges ?? [];
    const totals = calcInvoiceTotals({
      lineItems: input.lineItems.map((li) => ({ quantity: li.quantity, unitPrice: li.unitPrice, taxPercent: li.taxPercent || "0", discountPercent: li.discountPercent || "0" })),
      charges: charges.length > 0 ? charges : [{ amount: input.additionalCharges || "0" }],
      invoiceDiscount: input.invoiceDiscount || "0",
      invoiceDiscountType: input.invoiceDiscountType || "amount",
      roundOff: input.roundOff || "0",
      intraState: intra,
    });

    const warnings: string[] = [];
    if (party.type === "supplier") warnings.push(`${clip(party.name, 60)} is saved as a supplier, not a customer.`);
    const dateYmd = isoToYmd(input.invoiceDate);
    if (input.dueDate && isoToYmd(input.dueDate) < dateYmd) warnings.push(isInvoice ? "The due date is before the invoice date." : "The valid-until date is before the quotation date.");
    const seen = new Set<string>();
    for (const { li } of calcLines) {
      if (li.itemId && !seen.has(li.itemId)) {
        seen.add(li.itemId);
        const item = await loadItem(ctx, li.itemId);
        if (item && isInvoice && item.itemType !== "service" && !item.trackBatches) {
          const need = input.lineItems.filter((x) => x.itemId === li.itemId).reduce((s, x) => s + parseFloat(x.quantity), 0);
          if (parseFloat(item.stockQuantity ?? "0") < need) warnings.push(`Only ${trimNum(item.stockQuantity)} of ${clip(item.name, 50)} in stock, and this ${noun} uses ${trimNum(need)}. Saving is refused if your stock settings block negative stock.`);
        }
        if (item?.tcsSection) warnings.push(`TCS may apply to ${clip(item.name, 50)} and is worked out when the ${noun} is saved.`);
      } else if (!li.itemId && (li.taxPercent || "0") === "0") {
        warnings.push(`GST is 0% on "${clip(li.itemName, 50)}". Check this is right.`);
      }
    }

    const tax = parseFloat(totals.taxTotal);
    const taxTotals = intra
      ? (() => {
          const { cgst, sgst } = splitIntraStateTax(totals.taxTotal);
          return [
            { label: "CGST", value: inr(cgst) },
            { label: "SGST", value: inr(sgst) },
          ];
        })()
      : [{ label: "IGST", value: inr(tax) }];

    const edits: AiActionPreview["edits"] = [
      { key: "date", label: "Date", input: "date", value: dateYmd },
      { key: "dueDate", label: isInvoice ? "Due date" : "Valid until", input: "date", value: input.dueDate ? isoToYmd(input.dueDate) : "" },
      { key: "notes", label: "Notes", input: "text", value: input.notes ?? "", maxLength: 500 },
    ];
    input.lineItems.slice(0, MAX_EDITABLE_LINES).forEach((li, i) => {
      const n = `Line ${i + 1} (${clip(li.itemName, 30)})`;
      edits.push(
        { key: `lines.${i}.quantity`, label: `${n}: quantity`, input: "number", value: li.quantity },
        { key: `lines.${i}.unitPrice`, label: `${n}: rate`, input: "number", value: li.unitPrice },
        { key: `lines.${i}.discountPercent`, label: `${n}: discount %`, input: "number", value: li.discountPercent || "0" },
      );
    });

    const preview: AiActionPreview = {
      title: isInvoice ? "New sales invoice" : "New quotation",
      fields: [
        { label: "Customer", value: `${clip(party.name, 80)}${party.city ? `, ${clip(party.city, 40)}` : ""}` },
        { label: "Date", value: prettyYmd(dateYmd) },
        { label: isInvoice ? "Due date" : "Valid until", value: input.dueDate ? prettyYmd(isoToYmd(input.dueDate)) : "Not set" },
        { label: "Place of supply", value: `${party.state ? clip(party.state, 40) : "Not set"} (${intra ? "same state: CGST and SGST" : "other state: IGST"})` },
        ...(input.notes ? [{ label: "Notes", value: clip(input.notes, 200) }] : []),
      ],
      table: {
        columns: ["Item", "Qty", "Rate", "Disc %", "GST %", "Amount incl. GST"],
        rows: calcLines.map(({ li, calc }) => [
          clip(li.itemName, 50),
          `${trimNum(li.quantity)}${li.selectedUnit ? ` ${clip(li.selectedUnit, 10)}` : ""}`,
          inr(li.unitPrice),
          trimNum(li.discountPercent || "0"),
          trimNum(li.taxPercent || "0"),
          inr(calc.total),
        ]),
      },
      totals: [
        { label: "Subtotal", value: inr(totals.subtotal) },
        ...(parseFloat(totals.invoiceDiscountAmount) > 0 ? [{ label: "Discount", value: inr(totals.invoiceDiscountAmount) }] : []),
        ...taxTotals,
        { label: "Total", value: inr(totals.total), strong: true },
      ],
      warnings: warnings.slice(0, 6),
      note: `Nothing is saved until you tap Confirm. The ${noun} number is given when it is saved.`,
      edits,
    };
    return { payload: input as unknown as Record<string, unknown>, preview, summary: clip(`Create ${noun} for ${party.name}, ${inr(totals.total)}`, 200) };
  }

  return {
    kind,
    toolName: AI_ACTION_TOOL_NAMES[kind],
    description: isInvoice
      ? "Prepare a SALES INVOICE for the person to review. Nothing is saved: the person sees a confirmation card and must tap Confirm. Needs a customer (partyId from find_parties) and lines (itemId from find_items). Never invent quantities, rates, dates or GST: use what the person said, and ask if something needed is missing."
      : "Prepare a QUOTATION for the person to review. Nothing is saved: the person sees a confirmation card and must tap Confirm. Same inputs as an invoice.",
    properties: DOC_PROPS,
    required: ["lines"],
    inputSchema: isInvoice ? aiCreateInvoiceInputSchema : aiCreateQuotationInputSchema,

    async propose(ctx, rawInput: never) {
      const input = rawInput as { partyId?: string; partyName?: string; date?: string; dueDate?: string; notes?: string; lines: AiActionLine[] };
      const party = await resolveParty(ctx, input);
      const lineItems: Array<Record<string, unknown>> = [];
      for (const [i, line] of input.lines.entries()) {
        const where = `Line ${i + 1}`;
        if (line.itemId) {
          const item = await loadItem(ctx, line.itemId);
          if (!item) throw new AiToolInputError(`${where}: no item with that id in this business. Look it up with find_items and use the id it returns.`);
          const unitPrice = line.unitPrice ?? (item.salePrice && parseFloat(item.salePrice) > 0 ? item.salePrice : undefined);
          if (!unitPrice) throw new AiToolInputError(`${where}: "${clip(item.name, 50)}" has no sale price. Ask the person for the rate.`);
          lineItems.push({
            itemId: item.id,
            itemName: item.name,
            ...(line.description ? { description: line.description } : {}),
            quantity: line.quantity,
            unitPrice,
            taxPercent: line.taxPercent ?? item.taxPercent ?? "0",
            discountPercent: line.discountPercent ?? "0",
          });
        } else {
          const name = line.itemName!;
          if (!line.freeText) {
            const found = await itemCandidates(ctx, name);
            if (found.rows.length > 0) throw new AiToolInputError(`${where}: ${itemMatchesMessage(name, found)}`);
          }
          if (!line.unitPrice) throw new AiToolInputError(`${where}: "${clip(name, 50)}" is not in the catalogue and has no rate. Ask the person for the rate.`);
          lineItems.push({
            itemName: name,
            ...(line.description ? { description: line.description } : {}),
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxPercent: line.taxPercent ?? "0",
            discountPercent: line.discountPercent ?? "0",
          });
        }
      }
      const candidate = {
        partyId: party.id,
        type: "sale",
        documentType: isInvoice ? "invoice" : "quotation",
        invoiceDate: ymdToIso(input.date ?? todayYmd(ctx.now)),
        ...(input.dueDate ? { dueDate: ymdToIso(input.dueDate) } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        lineItems,
      };
      const parsed = createInvoiceSchema.safeParse(candidate);
      if (!parsed.success) throw new AiToolInputError(`Invalid ${noun}: ${zodMessage(parsed.error)}`);
      return build(ctx, parsed.data as unknown as Record<string, unknown>);
    },

    build,

    applyEdits(payload, edits) {
      const next = structuredClone(payload) as Record<string, unknown> & { lineItems: Array<Record<string, string>> };
      for (const [key, raw] of Object.entries(edits)) {
        if (key === "date") next.invoiceDate = ymdToIso(editDate(raw, "Date"));
        else if (key === "dueDate") {
          if (raw.trim() === "") delete next.dueDate;
          else next.dueDate = ymdToIso(editDate(raw, isInvoice ? "Due date" : "Valid until"));
        } else if (key === "notes") {
          const v = raw.trim().slice(0, 500);
          if (v) next.notes = v;
          else delete next.notes;
        } else {
          const m = /^lines\.(\d{1,2})\.(quantity|unitPrice|discountPercent)$/.exec(key);
          const line = m ? next.lineItems[Number(m[1])] : undefined;
          if (!m || !line) throw new AiActionEditError(`"${clip(key, 40)}" cannot be edited here.`);
          const label = `Line ${Number(m[1]) + 1}`;
          if (m[2] === "quantity") line.quantity = editQuantity(raw, `${label} quantity`);
          else if (m[2] === "unitPrice") line.unitPrice = editAmount(raw, `${label} rate`);
          else line.discountPercent = editPercent(raw, `${label} discount`);
        }
      }
      return next;
    },

    async execute(ctx, payload) {
      const input = parseReal(createInvoiceSchema, payload) as Doc;
      const doc = isInvoice ? await ctx.caller.invoice.create(input) : await ctx.caller.quotation.create(input);
      const number = (doc as { invoiceNumber?: string }).invoiceNumber ?? "";
      return { entityType: isInvoice ? "invoice" : "quotation", id: (doc as { id: string }).id, label: `${isInvoice ? "Invoice" : "Quotation"} ${number}`.trim() };
    },
  };
}

export const createInvoiceKind = makeDocumentKind("create_invoice");
export const createQuotationKind = makeDocumentKind("create_quotation");
