/**
 * tds-return.ts — the figures behind a quarterly TDS return (the deductee
 * annexure and challan details a CA needs for Form 26Q / its successor).
 *
 * Pure: takes plain rows, returns the structured data, warnings and CSV text.
 * The tds router loads the rows. This is data for preparing the return, not a
 * filed return: check the layout with your CA or return software.
 */

import { money, formatIstDate } from "@fintranzact/shared";

export interface ReturnDeducteeRow {
  partyName: string;
  pan: string | null;
  hasPan: boolean;
  sectionCode: string;
  deductedOn: Date;
  /** Amount the tax was worked out on. */
  baseAmount: string;
  rate: string;
  amount: string;
  invoiceNumber: string | null;
  challan: { bsrCode: string; challanNumber: string; depositedOn: Date } | null;
}

export interface ReturnChallanRow {
  challanNumber: string;
  bsrCode: string;
  depositedOn: Date;
  amount: string;
  interest: string;
  linked: string;
}

export interface TdsReturnInput {
  deductor: { name: string; tan: string | null; pan: string | null; gstin: string | null };
  financialYear: string;
  quarter: 1 | 2 | 3 | 4;
  rows: ReturnDeducteeRow[];
  challans: ReturnChallanRow[];
}

export interface TdsReturnData {
  deductor: TdsReturnInput["deductor"];
  financialYear: string;
  quarter: number;
  rows: ReturnDeducteeRow[];
  challans: ReturnChallanRow[];
  totals: { deducted: string; deposited: string; pending: string; deducteeCount: number };
  /** Things to fix before the return is prepared. */
  warnings: string[];
  deducteeCsv: string;
  challanCsv: string;
}

/** One CSV field: quoted when it holds a comma, quote or newline. */
function field(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const line = (cells: Array<string | number | null | undefined>) => cells.map(field).join(",");
const date = (d: Date) => formatIstDate(d, "/");

export function buildTdsReturn(input: TdsReturnInput): TdsReturnData {
  const { rows, challans } = input;
  const deducted = money.sum(rows.map((r) => r.amount));
  const deposited = money.sum(rows.filter((r) => r.challan).map((r) => r.amount));
  const pending = money.sub(deducted, deposited);

  const warnings: string[] = [];
  if (!input.deductor.tan?.trim()) {
    warnings.push("Your TAN is not set. Add it under Settings → Business: a TDS return cannot be prepared without it.");
  }
  const noPan = [...new Set(rows.filter((r) => !r.hasPan).map((r) => r.partyName))];
  if (noPan.length > 0) {
    warnings.push(`${noPan.length} deductee${noPan.length === 1 ? " has" : "s have"} no PAN (${noPan.slice(0, 3).join(", ")}${noPan.length > 3 ? ", …" : ""}). TDS was deducted at the higher rate; get their PAN before filing.`);
  }
  const undeposited = rows.filter((r) => !r.challan);
  if (undeposited.length > 0) {
    warnings.push(`${undeposited.length} deduction${undeposited.length === 1 ? " is" : "s are"} not on a challan yet (${money.sum(undeposited.map((r) => r.amount))}). Record the challans before filing: each deduction needs one.`);
  }

  const deducteeCsv = [
    line(["Sr No", "Deductee name", "PAN", "Section", "Date of payment / credit", "Amount paid / credited", "TDS rate %", "TDS deducted", "Higher rate (no PAN)", "Bill number", "BSR code", "Challan serial no", "Challan deposit date"]),
    ...rows.map((r, i) =>
      line([
        i + 1, r.partyName, r.pan ?? "PANNOTAVBL", r.sectionCode, date(r.deductedOn), r.baseAmount, parseFloat(r.rate), r.amount,
        r.hasPan ? "No" : "Yes", r.invoiceNumber ?? "", r.challan?.bsrCode ?? "", r.challan?.challanNumber ?? "", r.challan ? date(r.challan.depositedOn) : "",
      ]),
    ),
    line(["", "Total", "", "", "", money.sum(rows.map((r) => r.baseAmount)), "", deducted, "", "", "", "", ""]),
  ].join("\n");

  const challanCsv = [
    line(["Sr No", "BSR code", "Challan serial no", "Date deposited", "Challan amount", "Interest / fee", "TDS covered"]),
    ...challans.map((c, i) => line([i + 1, c.bsrCode, c.challanNumber, date(c.depositedOn), c.amount, c.interest, c.linked])),
    line(["", "Total", "", "", money.sum(challans.map((c) => c.amount)), money.sum(challans.map((c) => c.interest)), money.sum(challans.map((c) => c.linked))]),
  ].join("\n");

  return {
    deductor: input.deductor,
    financialYear: input.financialYear,
    quarter: input.quarter,
    rows,
    challans,
    totals: { deducted, deposited, pending, deducteeCount: new Set(rows.map((r) => `${r.partyName}|${r.pan ?? ""}`)).size },
    warnings,
    deducteeCsv,
    challanCsv,
  };
}
