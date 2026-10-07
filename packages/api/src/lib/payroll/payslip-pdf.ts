import PDFDocument from "pdfkit";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { PayslipSnapshot } from "./run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_REGULAR = resolve(__dirname, "../../../fonts/NotoSans-Regular.ttf");
const FONT_BOLD = resolve(__dirname, "../../../fonts/NotoSans-Bold.ttf");

function fmt(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!Number.isFinite(num)) return "0.00";
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

function fmtDate(ymd: string | null): string {
  if (!ymd) return "-";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

const TYPE_LABEL: Record<string, string> = { permanent: "Permanent", contract: "Contract", intern: "Intern" };

export interface PayslipPdfOptions {
  /** A preview of a run that is not approved yet: printed with a "not final" notice. */
  draft?: boolean;
  logo?: Buffer | null;
}

/**
 * The payslip as an A4 PDF, drawn from the payslip snapshot (the data stored at
 * approval). Identity numbers in the snapshot are already masked.
 */
export function generatePayslipPDF(s: PayslipSnapshot, opts: PayslipPdfOptions = {}): Promise<Buffer> {
  return new Promise((resolvePdf, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      info: { Title: `Payslip ${s.number}`, Author: s.business.name, Subject: `Payslip for ${s.monthLabel}`, Creator: "Fintranzact" },
    });
    doc.registerFont("NotoSans", FONT_REGULAR);
    doc.registerFont("NotoSans-Bold", FONT_BOLD);

    const margin = 40;
    const pageW = 595.28;
    const contentW = pageW - margin * 2;
    const ink = "#1a1a2e";
    const soft = "#495057";
    const muted = "#868e96";
    const line = "#dee2e6";
    const band = "#f1f3f5";
    const accent = "#2b4a8c";
    let y = margin;

    // Header: logo, business name and address.
    let textX = margin;
    if (opts.logo) {
      try {
        doc.image(opts.logo, margin, y, { fit: [56, 56] });
        textX = margin + 68;
      } catch {
        /* an unreadable logo is skipped */
      }
    }
    doc.font("NotoSans-Bold").fontSize(16).fillColor(ink).text(s.business.legalName || s.business.name, textX, y, { width: contentW - (textX - margin) });
    const address = [s.business.address, [s.business.city, s.business.state].filter(Boolean).join(", "), s.business.pincode].filter(Boolean).join(", ");
    doc.font("NotoSans").fontSize(8.5).fillColor(soft);
    if (address) doc.text(address, textX, doc.y + 2, { width: contentW - (textX - margin) });
    const contact = [s.business.phone, s.business.email].filter(Boolean).join("  |  ");
    if (contact) doc.text(contact, textX, doc.y + 1, { width: contentW - (textX - margin) });
    y = Math.max(doc.y, y + (opts.logo ? 60 : 0)) + 12;

    doc.moveTo(margin, y).lineTo(margin + contentW, y).strokeColor(line).lineWidth(0.75).stroke();
    y += 12;

    // Title band.
    doc.rect(margin, y, contentW, 26).fill(accent);
    doc.font("NotoSans-Bold").fontSize(11).fillColor("#ffffff").text(`PAYSLIP FOR ${s.monthLabel.toUpperCase()}`, margin + 10, y + 8, { width: contentW - 20 });
    doc.font("NotoSans").fontSize(8.5).fillColor("#ffffff").text(`No. ${s.number}`, margin + 10, y + 9, { width: contentW - 20, align: "right" });
    y += 36;
    if (opts.draft) {
      doc.font("NotoSans-Bold").fontSize(8.5).fillColor("#c92a2a").text("DRAFT: this run is not approved yet. Figures can still change.", margin, y, { width: contentW });
      y += 16;
    }

    // Employee and attendance details in two columns.
    const e = s.employee;
    const left: Array<[string, string]> = [
      ["Employee", `${e.name} (${e.code})`],
      ["Designation", e.designation ?? "-"],
      ["Department", e.department ?? "-"],
      ["Branch", e.branch ?? "-"],
      ["Type", TYPE_LABEL[e.employmentType] ?? e.employmentType],
      ["Date of joining", fmtDate(e.dateOfJoining)],
    ];
    const right: Array<[string, string]> = [
      ["PAN", e.panMasked ?? "-"],
      ["UAN", e.uanMasked ?? "-"],
      ["Bank account", e.bankAccountMasked ? `${e.bankAccountMasked}${e.bankName ? ` (${e.bankName})` : ""}` : "-"],
      ["Days in month", String(s.attendance.daysInMonth)],
      ["Paid days", s.attendance.paidDays.replace(/\.0$/, "")],
      ["Loss of pay days", s.attendance.lopDays.replace(/\.0$/, "")],
    ];
    const colW = contentW / 2 - 8;
    const rowH = 15;
    const drawPairs = (pairs: Array<[string, string]>, x: number) => {
      pairs.forEach(([k, v], i) => {
        const ry = y + i * rowH;
        doc.font("NotoSans").fontSize(8).fillColor(muted).text(k, x, ry, { width: 84 });
        doc.font("NotoSans-Bold").fontSize(8.5).fillColor(ink).text(v, x + 88, ry, { width: colW - 88, lineBreak: false, ellipsis: true });
      });
    };
    drawPairs(left, margin);
    drawPairs(right, margin + colW + 16);
    y += left.length * rowH + 10;
    if (Number(s.attendance.overtimeHours) > 0) {
      doc.font("NotoSans").fontSize(8).fillColor(muted).text(`Overtime hours: ${Number(s.attendance.overtimeHours)}`, margin, y);
      y += 14;
    }

    // Earnings and deductions side by side.
    const half = (contentW - 16) / 2;
    const xL = margin;
    const xR = margin + half + 16;
    const head = (label: string, x: number) => {
      doc.rect(x, y, half, 20).fill(band);
      doc.font("NotoSans-Bold").fontSize(8).fillColor(soft).text(label, x + 8, y + 6, { width: half - 90 });
      doc.text("AMOUNT (INR)", x + half - 90, y + 6, { width: 82, align: "right" });
    };
    head("EARNINGS", xL);
    head("DEDUCTIONS", xR);
    y += 24;

    const rows = Math.max(s.earnings.length, s.deductions.length, 1);
    for (let i = 0; i < rows; i++) {
      const ry = y + i * 18;
      const earn = s.earnings[i];
      const ded = s.deductions[i];
      doc.font("NotoSans").fontSize(9).fillColor(ink);
      if (earn) {
        doc.text(earn.name, xL + 8, ry, { width: half - 100, lineBreak: false, ellipsis: true });
        doc.text(fmt(earn.amount), xL + half - 90, ry, { width: 82, align: "right" });
      }
      if (ded) {
        doc.text(ded.name, xR + 8, ry, { width: half - 100, lineBreak: false, ellipsis: true });
        doc.text(fmt(ded.amount), xR + half - 90, ry, { width: 82, align: "right" });
      }
      doc.moveTo(xL, ry + 14).lineTo(xL + half, ry + 14).strokeColor(line).lineWidth(0.4).stroke();
      doc.moveTo(xR, ry + 14).lineTo(xR + half, ry + 14).strokeColor(line).lineWidth(0.4).stroke();
    }
    y += rows * 18 + 4;

    doc.font("NotoSans-Bold").fontSize(9).fillColor(ink);
    doc.text("Gross earnings", xL + 8, y, { width: half - 100 });
    doc.text(fmt(s.grossEarnings), xL + half - 90, y, { width: 82, align: "right" });
    doc.text("Total deductions", xR + 8, y, { width: half - 100 });
    doc.text(fmt(s.totalDeductions), xR + half - 90, y, { width: 82, align: "right" });
    y += 26;

    // Net pay.
    doc.rect(margin, y, contentW, 46).fill(band);
    doc.font("NotoSans").fontSize(8).fillColor(muted).text("NET PAY", margin + 10, y + 7);
    doc.font("NotoSans-Bold").fontSize(15).fillColor(ink).text(`INR ${fmt(s.netPay)}`, margin + 10, y + 19, { width: contentW - 20 });
    y += 54;
    doc.font("NotoSans").fontSize(8.5).fillColor(soft).text(`In words: ${s.netPayWords}`, margin, y, { width: contentW });
    y = doc.y + 8;
    if (s.finalSettlement) {
      doc.font("NotoSans").fontSize(8.5).fillColor(soft).text(`Last working day: ${fmtDate(e.lastWorkingDay)}. This is the final month of employment.`, margin, y, { width: contentW });
      y = doc.y + 8;
    }

    doc.font("NotoSans").fontSize(7.5).fillColor(muted).text(
      "This is a computer-generated payslip and does not need a signature. Identity and bank numbers are partly hidden for your security.",
      margin,
      Math.max(y + 16, 740),
      { width: contentW, align: "center" },
    );

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolvePdf(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}
