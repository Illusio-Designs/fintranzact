/**
 * PDFs of Payroll Phase 4: the bonus statement, the full and final settlement statement and the relieving letter.
 * They reuse the payslip look (pdfkit, Noto Sans, the business header). None of them claims a signature: the letter has a
 * blank signature line (and the business's own signature image only when the owner uploaded one), and the statements say
 * they are computer generated working documents.
 */

import PDFDocument from "pdfkit";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_REGULAR = resolve(__dirname, "../../../fonts/NotoSans-Regular.ttf");
const FONT_BOLD = resolve(__dirname, "../../../fonts/NotoSans-Bold.ttf");

const margin = 40;
const pageW = 595.28;
const contentW = pageW - margin * 2;
const ink = "#1a1a2e";
const soft = "#495057";
const muted = "#868e96";
const lineColor = "#dee2e6";
const band = "#f1f3f5";
const accent = "#2b4a8c";

export interface PdfBusiness {
  name: string;
  legalName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
}

export function fmtMoney(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!Number.isFinite(num)) return "0.00";
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

export function fmtDay(ymd: string | null | undefined): string {
  if (!ymd) return "-";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

function open(title: string, business: PdfBusiness) {
  const doc = new PDFDocument({ size: "A4", margin, info: { Title: title, Author: business.name, Creator: "Fintranzact" } });
  doc.registerFont("NotoSans", FONT_REGULAR);
  doc.registerFont("NotoSans-Bold", FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res, rej) => {
    doc.on("end", () => res(Buffer.concat(chunks)));
    doc.on("error", rej);
  });
  return { doc, done };
}

type Doc = InstanceType<typeof PDFDocument>;

/** Business header; returns the y position below it. */
function header(doc: Doc, b: PdfBusiness, logo: Buffer | null | undefined): number {
  let y = margin;
  let textX = margin;
  if (logo) {
    try {
      doc.image(logo, margin, y, { fit: [56, 56] });
      textX = margin + 68;
    } catch {
      /* an unreadable logo is skipped */
    }
  }
  doc.font("NotoSans-Bold").fontSize(16).fillColor(ink).text(b.legalName || b.name, textX, y, { width: contentW - (textX - margin) });
  const address = [b.address, [b.city, b.state].filter(Boolean).join(", "), b.pincode].filter(Boolean).join(", ");
  doc.font("NotoSans").fontSize(8.5).fillColor(soft);
  if (address) doc.text(address, textX, doc.y + 2, { width: contentW - (textX - margin) });
  const contact = [b.phone, b.email].filter(Boolean).join("  |  ");
  if (contact) doc.text(contact, textX, doc.y + 1, { width: contentW - (textX - margin) });
  y = Math.max(doc.y, y + (logo ? 60 : 0)) + 12;
  doc.moveTo(margin, y).lineTo(margin + contentW, y).strokeColor(lineColor).lineWidth(0.75).stroke();
  return y + 12;
}

function titleBand(doc: Doc, y: number, left: string, right: string): number {
  doc.rect(margin, y, contentW, 26).fill(accent);
  doc.font("NotoSans-Bold").fontSize(11).fillColor("#ffffff").text(left, margin + 10, y + 8, { width: contentW - 20 });
  doc.font("NotoSans").fontSize(8.5).fillColor("#ffffff").text(right, margin + 10, y + 9, { width: contentW - 20, align: "right" });
  return y + 36;
}

// ── Bonus statement ──────────────────────────────────────────────────────────

export interface BonusStatementData {
  business: PdfBusiness;
  number: string;
  fyLabel: string;
  status: string;
  percent: string;
  total: string;
  note: string | null;
  lines: Array<{ code: string; name: string; monthsPaid: number; daysPaid: string; wages: string; calculationWages: string; eligible: boolean; reasonText: string; bonus: string }>;
  generatedAt: string;
}

export function generateBonusStatementPDF(s: BonusStatementData, opts: { logo?: Buffer | null } = {}): Promise<Buffer> {
  const { doc, done } = open(`Bonus statement ${s.number}`, s.business);
  let y = header(doc, s.business, opts.logo);
  y = titleBand(doc, y, `BONUS STATEMENT, FINANCIAL YEAR ${s.fyLabel}`, `${s.number}  |  ${s.percent}%`);
  doc.font("NotoSans").fontSize(8).fillColor(muted).text("Payment of Bonus Act working statement. Rates and ceilings come from your Statutory settings and must be verified with your CA. Set-on and set-off are not computed.", margin, y, { width: contentW });
  y = doc.y + 8;

  const cols = [
    { label: "EMPLOYEE", x: margin, w: 150, align: "left" as const },
    { label: "MONTHS", x: margin + 150, w: 38, align: "right" as const },
    { label: "BASIC + DA", x: margin + 190, w: 78, align: "right" as const },
    { label: "BONUS WAGES", x: margin + 270, w: 78, align: "right" as const },
    { label: "BONUS", x: margin + 350, w: 78, align: "right" as const },
    { label: "NOTE", x: margin + 432, w: contentW - 432, align: "left" as const },
  ];
  const head = () => {
    doc.rect(margin, y, contentW, 18).fill(band);
    doc.font("NotoSans-Bold").fontSize(7.5).fillColor(soft);
    for (const c of cols) doc.text(c.label, c.x + 4, y + 6, { width: c.w - 8, align: c.align });
    y += 22;
  };
  head();
  for (const l of s.lines) {
    if (y > 770) {
      doc.addPage();
      y = margin;
      head();
    }
    doc.font("NotoSans").fontSize(8.5).fillColor(ink);
    doc.text(`${l.name} (${l.code})`, cols[0]!.x + 4, y, { width: cols[0]!.w - 8, lineBreak: false, ellipsis: true });
    doc.text(String(l.monthsPaid), cols[1]!.x + 4, y, { width: cols[1]!.w - 8, align: "right" });
    doc.text(fmtMoney(l.wages), cols[2]!.x + 4, y, { width: cols[2]!.w - 8, align: "right" });
    doc.text(fmtMoney(l.calculationWages), cols[3]!.x + 4, y, { width: cols[3]!.w - 8, align: "right" });
    doc.font("NotoSans-Bold").text(fmtMoney(l.bonus), cols[4]!.x + 4, y, { width: cols[4]!.w - 8, align: "right" });
    doc.font("NotoSans").fontSize(7).fillColor(l.eligible ? muted : "#c92a2a").text(l.eligible ? "" : l.reasonText, cols[5]!.x + 4, y, { width: cols[5]!.w - 4, lineBreak: false, ellipsis: true });
    doc.moveTo(margin, y + 13).lineTo(margin + contentW, y + 13).strokeColor(lineColor).lineWidth(0.4).stroke();
    y += 16;
  }
  y += 6;
  doc.font("NotoSans-Bold").fontSize(10).fillColor(ink).text(`Total bonus: INR ${fmtMoney(s.total)}`, margin, y, { width: contentW, align: "right" });
  doc.font("NotoSans").fontSize(7.5).fillColor(muted).text(`Status: ${s.status}. Generated ${s.generatedAt.slice(0, 10)}. This is a computer-generated working statement.`, margin, Math.max(doc.y + 14, 780), { width: contentW, align: "center" });
  doc.end();
  return done;
}

// ── Full and final statement ─────────────────────────────────────────────────

export interface FnfStatementData {
  business: PdfBusiness;
  number: string;
  status: string;
  employee: { code: string; name: string; designation: string | null; department: string | null; dateOfJoining: string; lastWorkingDay: string; exitReason: string | null };
  earnings: Array<{ label: string; amount: string; detail: string | null }>;
  deductions: Array<{ label: string; amount: string; detail: string | null }>;
  gross: string;
  deductionsTotal: string;
  net: string;
  netWords: string;
  salaryNote: string;
  warnings: string[];
  generatedAt: string;
}

export function generateFnfStatementPDF(s: FnfStatementData, opts: { logo?: Buffer | null } = {}): Promise<Buffer> {
  const { doc, done } = open(`Full and final settlement ${s.number}`, s.business);
  let y = header(doc, s.business, opts.logo);
  y = titleBand(doc, y, "FULL AND FINAL SETTLEMENT STATEMENT", s.number);
  const e = s.employee;
  const pairs: Array<[string, string]> = [
    ["Employee", `${e.name} (${e.code})`],
    ["Designation", e.designation ?? "-"],
    ["Department", e.department ?? "-"],
    ["Date of joining", fmtDay(e.dateOfJoining)],
    ["Last working day", fmtDay(e.lastWorkingDay)],
    ["Reason", e.exitReason ? e.exitReason.replace(/_/g, " ") : "-"],
  ];
  pairs.forEach(([k, v], i) => {
    const x = margin + (i % 2) * (contentW / 2);
    const ry = y + Math.floor(i / 2) * 15;
    doc.font("NotoSans").fontSize(8).fillColor(muted).text(k, x, ry, { width: 84 });
    doc.font("NotoSans-Bold").fontSize(8.5).fillColor(ink).text(v, x + 88, ry, { width: contentW / 2 - 96, lineBreak: false, ellipsis: true });
  });
  y += Math.ceil(pairs.length / 2) * 15 + 8;

  const section = (label: string, rows: Array<{ label: string; amount: string; detail: string | null }>, total: string, totalLabel: string) => {
    doc.rect(margin, y, contentW, 20).fill(band);
    doc.font("NotoSans-Bold").fontSize(8).fillColor(soft).text(label, margin + 8, y + 6, { width: contentW - 110 });
    doc.text("AMOUNT (INR)", margin + contentW - 90, y + 6, { width: 82, align: "right" });
    y += 24;
    if (rows.length === 0) {
      doc.font("NotoSans").fontSize(9).fillColor(muted).text("None", margin + 8, y);
      y += 16;
    }
    for (const r of rows) {
      doc.font("NotoSans").fontSize(9).fillColor(ink).text(r.label, margin + 8, y, { width: contentW - 110, lineBreak: false, ellipsis: true });
      doc.text(fmtMoney(r.amount), margin + contentW - 90, y, { width: 82, align: "right" });
      y += 14;
      if (r.detail) {
        doc.font("NotoSans").fontSize(7.5).fillColor(muted).text(r.detail, margin + 14, y, { width: contentW - 120 });
        y = doc.y + 2;
      }
      doc.moveTo(margin, y).lineTo(margin + contentW, y).strokeColor(lineColor).lineWidth(0.4).stroke();
      y += 4;
    }
    doc.font("NotoSans-Bold").fontSize(9).fillColor(ink).text(totalLabel, margin + 8, y + 2, { width: contentW - 110 });
    doc.text(fmtMoney(total), margin + contentW - 90, y + 2, { width: 82, align: "right" });
    y += 24;
  };
  section("AMOUNTS DUE", s.earnings, s.gross, "Total amounts due");
  section("RECOVERIES", s.deductions, s.deductionsTotal, "Total recoveries");

  doc.rect(margin, y, contentW, 46).fill(band);
  doc.font("NotoSans").fontSize(8).fillColor(muted).text("NET PAYABLE", margin + 10, y + 7);
  doc.font("NotoSans-Bold").fontSize(15).fillColor(ink).text(`INR ${fmtMoney(s.net)}`, margin + 10, y + 19, { width: contentW - 20 });
  y += 54;
  doc.font("NotoSans").fontSize(8.5).fillColor(soft).text(`In words: ${s.netWords}`, margin, y, { width: contentW });
  y = doc.y + 8;
  doc.font("NotoSans").fontSize(8).fillColor(soft).text(s.salaryNote, margin, y, { width: contentW });
  y = doc.y + 6;
  for (const w of s.warnings) {
    doc.font("NotoSans").fontSize(7.5).fillColor("#7c5e00").text(`Note: ${w}`, margin, y, { width: contentW });
    y = doc.y + 2;
  }
  doc.font("NotoSans").fontSize(7.5).fillColor(muted).text(
    `Status: ${s.status}. Generated ${s.generatedAt.slice(0, 10)}. A computer-generated settlement statement; it does not need a signature unless your policy asks for one.`,
    margin,
    Math.max(y + 16, 770),
    { width: contentW, align: "center" },
  );
  doc.end();
  return done;
}

// ── Relieving letter ─────────────────────────────────────────────────────────

export interface LetterData {
  business: PdfBusiness;
  title: string;
  /** The rendered body, paragraphs separated by blank lines. */
  body: string;
  dateText: string;
  place: string | null;
  subject: string;
  signatoryName: string | null;
  signatoryTitle: string | null;
}

/** A letter on the business's header. The signature line is blank unless the owner uploaded a signature image. No signature is ever drawn for the person. */
export function generateLetterPDF(l: LetterData, opts: { logo?: Buffer | null; signature?: Buffer | null } = {}): Promise<Buffer> {
  const { doc, done } = open(l.title, l.business);
  let y = header(doc, l.business, opts.logo);
  doc.font("NotoSans").fontSize(9.5).fillColor(soft).text(`${l.place ? `${l.place}, ` : ""}${l.dateText}`, margin, y, { width: contentW, align: "right" });
  y = doc.y + 18;
  doc.font("NotoSans-Bold").fontSize(13).fillColor(ink).text(l.title.toUpperCase(), margin, y, { width: contentW, align: "center", underline: true });
  y = doc.y + 6;
  doc.font("NotoSans-Bold").fontSize(9.5).fillColor(soft).text(l.subject, margin, y, { width: contentW, align: "center" });
  y = doc.y + 20;
  for (const para of l.body.split(/\n{2,}/)) {
    doc.font("NotoSans").fontSize(10.5).fillColor(ink).text(para.replace(/\n/g, " ").trim(), margin, y, { width: contentW, align: "justify", lineGap: 3 });
    y = doc.y + 12;
  }
  y += 30;
  if (opts.signature) {
    try {
      doc.image(opts.signature, margin, y, { fit: [120, 48] });
    } catch {
      /* skipped */
    }
  }
  y += 52;
  doc.moveTo(margin, y).lineTo(margin + 180, y).strokeColor(ink).lineWidth(0.6).stroke();
  doc.font("NotoSans-Bold").fontSize(9.5).fillColor(ink).text(l.signatoryName || "Authorised signatory", margin, y + 4, { width: 260 });
  if (l.signatoryTitle) doc.font("NotoSans").fontSize(9).fillColor(soft).text(l.signatoryTitle, margin, doc.y + 1, { width: 260 });
  doc.font("NotoSans").fontSize(9).fillColor(soft).text(l.business.legalName || l.business.name, margin, doc.y + 1, { width: 260 });
  doc.end();
  return done;
}
