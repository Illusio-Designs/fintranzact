/**
 * record_payment: runs payment.create as the person (allocation to the invoice,
 * overpayment guard, period lock, bank account movement, numbering and audit
 * all stay in the procedure). The model gives the party or invoice (by id),
 * amount and mode; the date, reference and notes only if the person said them.
 * The bank account is the screen's own default for this party (payment.defaultAccount),
 * shown on the card; a role that cannot read bank accounts gets none, like the screen.
 */

import {
  AI_ACTION_TOOL_NAMES,
  aiRecordPaymentInputSchema,
  createPaymentSchema,
  paymentModes,
  type AiActionPreview,
} from "@fintranzact/shared";
import { AiActionEditError, AiToolInputError } from "../../errors.js";
import { clip, toNum, round2 } from "../../format.js";
import { editAmount, editDate, inr, isoToYmd, parseReal, prettyYmd, resolveParty, todayYmd, ymdToIso, zodMessage } from "../helpers.js";
import type { AiActionCtx, AiActionDef, BuiltAction } from "../types.js";

export const PAYMENT_MODE_LABELS: Record<(typeof paymentModes)[number], string> = {
  cash: "Cash",
  bank: "Bank transfer",
  upi: "UPI",
  cheque: "Cheque",
  other: "Other",
  credit_card: "Credit card",
  debit_card: "Debit card",
  net_banking: "Net banking",
  wallet: "Wallet",
};

interface InvoiceInfo {
  id: string;
  invoiceNumber: string;
  type: string;
  documentType: string;
  status: string;
  partyId: string;
  balance: number;
}

async function loadInvoiceInfo(ctx: AiActionCtx, id: string): Promise<InvoiceInfo> {
  const inv = await ctx.caller.invoice.getById({ id });
  if (!inv) throw new AiToolInputError("No invoice with that id in this business. Look it up with find_invoices and use the id it returns.");
  if (inv.documentType !== "invoice") throw new AiToolInputError("A payment can only be recorded against an invoice, not another kind of document.");
  if (inv.status === "cancelled" || inv.status === "draft") throw new AiToolInputError(`That invoice is ${inv.status}, so a payment cannot be recorded against it.`);
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    type: inv.type,
    documentType: inv.documentType,
    status: inv.status,
    partyId: inv.partyId,
    balance: round2(toNum(inv.totalAmount) - toNum(inv.amountPaid) - toNum(inv.totalAdjusted)),
  };
}

async function accountName(ctx: AiActionCtx, id: string | undefined): Promise<string | null> {
  if (!id) return null;
  try {
    const list = (await ctx.caller.bankAccount.list()) as Array<{ id: string; accountName: string }>;
    return list.find((a) => a.id === id)?.accountName ?? null;
  } catch {
    return null;
  }
}

async function build(ctx: AiActionCtx, payload: Record<string, unknown>): Promise<BuiltAction> {
  const input = parseReal(createPaymentSchema, payload);
  const party = await ctx.caller.party.getById({ id: input.partyId });
  if (!party) throw new AiToolInputError("The party is no longer in this business.");
  const invoice = input.invoiceId ? await loadInvoiceInfo(ctx, input.invoiceId) : null;
  const outflow = invoice ? invoice.type === "purchase" : party.type === "supplier";
  const warnings: string[] = [];
  if (invoice && toNum(input.amount) > invoice.balance + 0.005) {
    warnings.push(`The amount is more than the ${inr(invoice.balance)} still due on ${invoice.invoiceNumber}; saving will be refused.`);
  }
  if (!invoice) warnings.push("Not linked to an invoice: it is recorded as a payment on account.");
  const dateYmd = isoToYmd(input.paymentDate);
  const account = await accountName(ctx, input.bankAccountId);

  const preview: AiActionPreview = {
    title: outflow ? "Record payment made" : "Record payment received",
    fields: [
      { label: outflow ? "Paid to" : "Received from", value: `${clip(party.name, 80)}${party.city ? `, ${clip(party.city, 40)}` : ""}` },
      { label: "Amount", value: inr(input.amount) },
      { label: "Mode", value: PAYMENT_MODE_LABELS[input.mode] },
      { label: "Date", value: prettyYmd(dateYmd) },
      ...(invoice ? [{ label: "Against invoice", value: `${invoice.invoiceNumber} (${inr(invoice.balance)} due before this payment)` }] : []),
      ...(input.referenceNumber ? [{ label: "Reference", value: clip(input.referenceNumber, 100) }] : []),
      ...(account ? [{ label: outflow ? "Paid from" : "Deposited to", value: clip(account, 60) }] : []),
      ...(input.notes ? [{ label: "Notes", value: clip(input.notes, 200) }] : []),
    ],
    totals: invoice ? [{ label: "Due after this payment", value: inr(Math.max(0, round2(invoice.balance - toNum(input.amount)))), strong: true }] : [],
    warnings,
    note: "Nothing is recorded until you tap Confirm.",
    edits: [
      { key: "amount", label: "Amount", input: "number", value: input.amount },
      { key: "mode", label: "Mode", input: "select", value: input.mode, options: paymentModes.map((m) => ({ value: m, label: PAYMENT_MODE_LABELS[m] })) },
      { key: "date", label: "Date", input: "date", value: dateYmd },
      { key: "referenceNumber", label: "Reference", input: "text", value: input.referenceNumber ?? "", maxLength: 100 },
      { key: "notes", label: "Notes", input: "text", value: input.notes ?? "", maxLength: 500 },
    ],
  };
  return {
    payload: input as unknown as Record<string, unknown>,
    preview,
    summary: clip(`${outflow ? "Record payment of" : "Record payment of"} ${inr(input.amount)} ${outflow ? "to" : "from"} ${party.name}`, 200),
  };
}

export const recordPaymentKind: AiActionDef = {
  kind: "record_payment",
  toolName: AI_ACTION_TOOL_NAMES.record_payment,
  description:
    "Prepare a PAYMENT entry for the person to review (money received from a customer, or paid to a supplier). Nothing is saved: the person sees a confirmation card and must tap Confirm. Needs the party (partyId from find_parties) or the invoice (invoiceId from find_invoices), the amount and the mode. Never invent the amount or mode: ask if the person did not say.",
  properties: {
    partyId: { type: "string", description: "Party id (UUID) from find_parties." },
    partyName: { type: "string", description: "Only if you have no id: the server returns candidates, it never picks one." },
    invoiceId: { type: "string", description: "Invoice id (UUID) from find_invoices when the payment is for one invoice." },
    amount: { type: "number", description: "Amount in rupees, as the person said." },
    mode: { type: "string", enum: [...paymentModes], description: "How it was paid." },
    date: { type: "string", description: "YYYY-MM-DD (Indian time). Default today." },
    referenceNumber: { type: "string", description: "Cheque, UPI or transaction reference, only if given." },
    notes: { type: "string" },
  },
  required: ["amount", "mode"],
  inputSchema: aiRecordPaymentInputSchema,

  async propose(ctx, rawInput: never) {
    const input = rawInput as { partyId?: string; partyName?: string; invoiceId?: string; amount: string; mode: (typeof paymentModes)[number]; date?: string; referenceNumber?: string; notes?: string };
    let partyId = input.partyId;
    let invoice: InvoiceInfo | null = null;
    if (input.invoiceId) {
      invoice = await loadInvoiceInfo(ctx, input.invoiceId);
      if (partyId && partyId !== invoice.partyId) throw new AiToolInputError("That invoice belongs to a different party than the one given. Check with the person.");
      partyId = invoice.partyId;
    }
    const party = await resolveParty(ctx, { partyId, partyName: input.partyName });
    if (invoice && toNum(input.amount) > invoice.balance + 0.005) {
      throw new AiToolInputError(`The amount is more than the ${inr(invoice.balance)} still due on invoice ${invoice.invoiceNumber}. Ask the person what to record.`);
    }
    let bankAccountId: string | undefined;
    try {
      const def = await ctx.caller.payment.defaultAccount({ partyId: party.id });
      if (def && def.accountType !== "payment_gateway") bankAccountId = def.id;
    } catch {
      /* a role without access to bank accounts records it without one, like the screen */
    }
    const candidate = {
      partyId: party.id,
      ...(invoice ? { invoiceId: invoice.id } : {}),
      amount: input.amount,
      mode: input.mode,
      paymentDate: ymdToIso(input.date ?? todayYmd(ctx.now)),
      ...(input.referenceNumber ? { referenceNumber: input.referenceNumber } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
      ...(bankAccountId ? { bankAccountId } : {}),
    };
    const parsed = createPaymentSchema.safeParse(candidate);
    if (!parsed.success) throw new AiToolInputError(`Invalid payment: ${zodMessage(parsed.error)}`);
    return build(ctx, parsed.data as unknown as Record<string, unknown>);
  },

  build,

  applyEdits(payload, edits) {
    const next = structuredClone(payload) as Record<string, unknown>;
    for (const [key, raw] of Object.entries(edits)) {
      if (key === "amount") {
        const v = editAmount(raw, "Amount");
        if (!(parseFloat(v) > 0)) throw new AiActionEditError("Amount: enter an amount above 0.");
        next.amount = v;
      } else if (key === "mode") {
        if (!(paymentModes as readonly string[]).includes(raw)) throw new AiActionEditError("Mode: pick one from the list.");
        next.mode = raw;
      } else if (key === "date") next.paymentDate = ymdToIso(editDate(raw, "Date"));
      else if (key === "referenceNumber") {
        const v = raw.trim().slice(0, 100);
        if (v) next.referenceNumber = v;
        else delete next.referenceNumber;
      } else if (key === "notes") {
        const v = raw.trim().slice(0, 500);
        if (v) next.notes = v;
        else delete next.notes;
      } else throw new AiActionEditError(`"${clip(key, 40)}" cannot be edited here.`);
    }
    return next;
  },

  async execute(ctx, payload) {
    const input = parseReal(createPaymentSchema, payload);
    const pmt = await ctx.caller.payment.create(input);
    return { entityType: "payment", id: pmt.id, label: `Payment ${pmt.paymentNumber ?? ""}`.trim() };
  },
};
