/**
 * tds-certificate.ts — a statement of TDS deducted from (Form 16A style) or
 * TCS collected from (Form 27D style) one party in one quarter, generated from
 * the books.
 *
 * This is NOT the certificate issued through TRACES: that is issued after the
 * quarterly return is filed and processed. The statement lists each payment,
 * the tax, and the challan it was deposited with where one is recorded; tax not
 * yet linked to a deposited challan is listed as pending. The builder is pure
 * (plain rows in, structured data out); the PDF is drawn from that data.
 */

import PDFDocument from "pdfkit";
import { formatIstDate, money, tdsQuarterRange } from "@fintranzact/shared";
import { Ctx, drawTable, line, rect, registerFonts, text, textHeight, type Column, type Doc, type Row } from "./invoice-templates/engine.js";
import { inr } from "./invoice-templates/model.js";

export type CertificateKind = "tds" | "tcs";
type Quarter = 1 | 2 | 3 | 4;

export interface CertificateRow {
  sectionCode: string;
  deductedOn: Date;
  /** Amount paid / credited (TDS) or collected on (TCS): what the tax was worked out on. */
  baseAmount: string;
  amount: string;
  challan: { bsrCode: string; challanNumber: string; depositedOn: Date } | null;
}

export interface CertificateInput {
  kind: CertificateKind;
  /** The deductor (TDS) or collector (TCS); blank where the business has not set a field. */
  deductor: { name: string; tan: string | null; pan: string | null; address: string | null };
  deductee: { name: string; pan: string | null };
  financialYear: string;
  quarter: Quarter;
  rows: CertificateRow[];
  /** Section code → description, for the heading of each section. */
  sectionLabels?: Record<string, string>;
}

export interface CertificateLine {
  sectionCode: string;
  sectionLabel: string;
  date: Date;
  baseAmount: string;
  tax: string;
  status: "deposited" | "pending";
  challan: CertificateRow["challan"];
}

export interface CertificateData {
  kind: CertificateKind;
  title: string;
  deductor: { name: string; tan: string; pan: string; address: string };
  deductee: { name: string; pan: string };
  financialYear: string;
  assessmentYear: string;
  quarter: Quarter;
  period: { from: Date; to: Date };
  lines: CertificateLine[];
  sections: string[];
  totals: { paid: string; tax: string; deposited: string; pending: string };
  /** What the reader must know before relying on the statement. */
  notes: string[];
}

/** "2026-27" → "2027-28". */
export function assessmentYear(fy: string): string {
  const start = parseInt(fy.slice(0, 4), 10) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export const NOT_TRACES_NOTICE =
  "This is a statement generated from the books of the deductor. It is NOT the certificate issued through TRACES. " +
  "The official certificate is issued by the Income Tax Department after the quarterly return is filed and processed.";

export function buildCertificateData(input: CertificateInput): CertificateData {
  const tcs = input.kind === "tcs";
  const lines: CertificateLine[] = [...input.rows]
    .sort((a, b) => a.deductedOn.getTime() - b.deductedOn.getTime() || a.sectionCode.localeCompare(b.sectionCode))
    .map((r) => ({
      sectionCode: r.sectionCode,
      sectionLabel: input.sectionLabels?.[r.sectionCode] ?? "",
      date: r.deductedOn,
      baseAmount: r.baseAmount,
      tax: r.amount,
      status: r.challan ? "deposited" : "pending",
      challan: r.challan,
    }));

  const depositedTax = money.sum(lines.filter((l) => l.status === "deposited").map((l) => l.tax));
  const tax = money.sum(lines.map((l) => l.tax));
  const notes = [NOT_TRACES_NOTICE];
  const pending = money.sub(tax, depositedTax);
  if (money.isPositive(pending)) {
    notes.push(`Tax of Rs ${pending} is not yet linked to a deposited challan; it is shown as pending.`);
  }
  if (!input.deductor.tan?.trim()) notes.push(`The ${tcs ? "collector" : "deductor"}'s TAN is not set in the business profile.`);
  if (!input.deductee.pan?.trim()) notes.push(`The ${tcs ? "buyer" : "deductee"}'s PAN is not recorded.`);

  return {
    kind: input.kind,
    title: tcs ? "TCS statement (Form 27D style)" : "TDS statement (Form 16A style)",
    deductor: {
      name: input.deductor.name,
      tan: input.deductor.tan?.trim() ?? "",
      pan: input.deductor.pan?.trim() ?? "",
      address: input.deductor.address?.trim() ?? "",
    },
    deductee: { name: input.deductee.name, pan: input.deductee.pan?.trim() ?? "" },
    financialYear: input.financialYear,
    assessmentYear: assessmentYear(input.financialYear),
    quarter: input.quarter,
    period: tdsQuarterRange(input.financialYear, input.quarter),
    lines,
    sections: [...new Set(lines.map((l) => l.sectionCode))],
    totals: {
      // Paid/credited is summed per deduction row, as recorded.
      paid: money.sum(lines.map((l) => l.baseAmount)),
      tax,
      deposited: depositedTax,
      pending,
    },
    notes,
  };
}

// ── PDF ───────────────────────────────────────────────────────

const W = 595.28;
const H = 841.89;
const M = 36;
const CW = W - 2 * M;
const LBL = "#555555";

const rupees = (v: string) => inr(Math.round(parseFloat(v || "0") * 100));

function kv(doc: Doc, rows: Array<[string, string]>, x: number, y: number, w: number, labelW: number): number {
  for (const [k, v] of rows) {
    const h = Math.max(textHeight(doc, k, { w: labelW - 6, size: 8 }), textHeight(doc, v || "—", { w: w - labelW, size: 8, bold: true }));
    text(doc, k, x, y, { w: labelW - 6, size: 8, color: LBL });
    text(doc, v || "—", x + labelW, y, { w: w - labelW, size: 8, bold: true });
    y += h + 3.5;
  }
  return y;
}

function sectionTitle(doc: Doc, s: string, y: number): number {
  rect(doc, M, y, CW, 16, { fill: "#eef1f5" });
  text(doc, s, M + 6, y + 3.5, { w: CW - 12, size: 8.5, bold: true });
  return y + 22;
}

export function generateCertificatePDF(d: CertificateData): Doc {
  const tcs = d.kind === "tcs";
  const doc = new PDFDocument({
    size: [W, H],
    margin: 0,
    bufferPages: true,
    info: { Title: `${tcs ? "TCS" : "TDS"} statement ${d.deductee.name} Q${d.quarter} ${d.financialYear}`, Author: d.deductor.name, Creator: "Fintranzact" },
  });
  registerFonts(doc);
  let y = M;

  y += text(doc, d.title, M, y, { w: CW, size: 15, bold: true, align: "center" }) + 4;
  y += text(doc, `Quarter ${d.quarter} · Financial year ${d.financialYear} · Assessment year ${d.assessmentYear}`, M, y, { w: CW, size: 9, align: "center", color: LBL }) + 8;

  // The warning that this is not the TRACES certificate, boxed, on page one.
  const noticeH = textHeight(doc, NOT_TRACES_NOTICE, { w: CW - 16, size: 8, bold: true }) + 12;
  rect(doc, M, y, CW, noticeH, { fill: "#fff6e5", stroke: "#d9a441", lw: 0.8 });
  text(doc, NOT_TRACES_NOTICE, M + 8, y + 6, { w: CW - 16, size: 8, bold: true, color: "#7a4b00" });
  y += noticeH + 12;

  const half = CW / 2 - 8;
  y = sectionTitle(doc, tcs ? "Collector and buyer" : "Deductor and deductee", y);
  const yL = kv(doc, [
    [tcs ? "Name of collector" : "Name of deductor", d.deductor.name],
    ["TAN", d.deductor.tan],
    ["PAN", d.deductor.pan],
    ["Address", d.deductor.address],
  ], M + 6, y, half, 80);
  const yR = kv(doc, [
    [tcs ? "Name of buyer" : "Name of deductee", d.deductee.name],
    ["PAN", d.deductee.pan],
    ["Section(s)", d.sections.join(", ")],
    ["Period", `${formatIstDate(d.period.from)} to ${formatIstDate(d.period.to)}`],
  ], M + CW / 2 + 6, y, half, 80);
  y = Math.max(yL, yR) + 8;

  y = sectionTitle(doc, tcs ? "Tax collected and deposited" : "Tax deducted and deposited", y);
  const cols: Column[] = [
    { header: "Date", w: 52 },
    { header: "Section", w: 52 },
    { header: tcs ? "Amount collected on (Rs)" : "Amount paid / credited (Rs)", w: 0, flex: 1.1, align: "right", headerAlign: "right" },
    { header: tcs ? "TCS (Rs)" : "TDS (Rs)", w: 0, flex: 0.9, align: "right", headerAlign: "right" },
    { header: "BSR code", w: 46 },
    { header: "Challan no.", w: 46 },
    { header: "Deposited on", w: 56 },
    { header: "Status", w: 46 },
  ];
  const rows: Row[] = d.lines.map((l) => ({
    cells: [
      formatIstDate(l.date),
      l.sectionCode,
      rupees(l.baseAmount),
      rupees(l.tax),
      l.challan?.bsrCode ?? "—",
      l.challan?.challanNumber ?? "—",
      l.challan ? formatIstDate(l.challan.depositedOn) : "—",
      { text: l.status === "deposited" ? "Deposited" : "Pending", color: l.status === "deposited" ? "#1a6b3a" : "#b45309", bold: true },
    ],
  }));
  const tail: Row[] = [
    { cells: ["Total", "", rupees(d.totals.paid), rupees(d.totals.tax), "", "", "", ""], bold: true, topLine: { w: 0.8, c: "#555555" } },
    { cells: ["Deposited", "", "", rupees(d.totals.deposited), "", "", "", ""] },
    { cells: ["Pending deposit", "", "", rupees(d.totals.pending), "", "", "", ""] },
  ];
  const ctx = new Ctx(doc, undefined as never, { size: [W, H], margins: { t: M, r: M, b: M, l: M } });
  y = drawTable(ctx, y, {
    columns: cols,
    rows: rows.length ? rows : [{ cells: ["No tax recorded for this party in this quarter", "", "", "", "", "", "", ""], span: { 0: 8 } }],
    tail,
    style: { size: 7.6, padX: 3.5, padY: 3.5, grid: { w: 0.5, c: "#9aa3ae" }, headerFill: "#f5f7fa", headerBold: true },
    newPage: (c) => { c.addPage(); return M; },
  });

  y += 14;
  if (d.notes.length > 1) {
    for (const n of d.notes.slice(1)) y += text(doc, `• ${n}`, M, y, { w: CW, size: 7.8, color: "#7a4b00" }) + 3;
    y += 4;
  }
  line(doc, M, y, M + CW, y, "#cccccc", 0.5);
  text(doc, "Generated from books by Fintranzact. Not a TRACES-issued certificate. Verify rates and due dates with your CA.", M, y + 5, { w: CW, size: 6.8, color: "#777777", align: "center" });
  return doc;
}

/** The PDF as bytes. */
export function certificateToBuffer(d: CertificateData): Promise<Buffer> {
  const doc = generateCertificatePDF(d);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}
