import PDFDocument from "pdfkit";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { formatPayrollMonth, paiseToRupees, type Form16Data } from "@fintranzact/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_REGULAR = resolve(__dirname, "../../../fonts/NotoSans-Regular.ttf");
const FONT_BOLD = resolve(__dirname, "../../../fonts/NotoSans-Bold.ttf");

function fmt(paise: number): string {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(paiseToRupees(paise)));
}

/**
 * A Form 16 working copy (a Part A and Part B style summary) as an A4 PDF. It is
 * for the CA's review: it is NOT a TRACES-generated certificate and says so on
 * every page. The PAN is printed in full (the file goes to a person with Payroll
 * "update" permission); the contents are never logged.
 */
export function generateForm16WorkingCopyPDF(data: Form16Data, business: { name: string; tan: string | null }): Promise<Buffer> {
  return new Promise((resolvePdf, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      info: { Title: `Form 16 working copy ${data.fyLabel} ${data.employee.code}`, Author: business.name, Subject: "Form 16 working copy for CA review", Creator: "Fintranzact" },
    });
    doc.registerFont("NotoSans", FONT_REGULAR);
    doc.registerFont("NotoSans-Bold", FONT_BOLD);
    const margin = 40;
    const contentW = 595.28 - margin * 2;
    const ink = "#1a1a2e";
    const soft = "#495057";
    const line = "#dee2e6";
    const band = "#f1f3f5";
    let y = margin;

    const banner = () => {
      doc.rect(margin, y, contentW, 22).fill("#fff3bf");
      doc.font("NotoSans-Bold").fontSize(8.5).fillColor("#7c5e00").text(data.label.toUpperCase(), margin + 8, y + 7, { width: contentW - 16 });
      y += 32;
    };
    const row = (label: string, value: string, bold = false) => {
      if (y > 780) {
        doc.addPage();
        y = margin;
        banner();
      }
      doc.font(bold ? "NotoSans-Bold" : "NotoSans").fontSize(9).fillColor(ink).text(label, margin + 6, y, { width: contentW - 140 });
      doc.text(value, margin + contentW - 130, y, { width: 124, align: "right" });
      doc.moveTo(margin, y + 14).lineTo(margin + contentW, y + 14).strokeColor(line).lineWidth(0.4).stroke();
      y += 18;
    };
    const head = (label: string) => {
      if (y > 760) {
        doc.addPage();
        y = margin;
        banner();
      }
      doc.rect(margin, y, contentW, 20).fill(band);
      doc.font("NotoSans-Bold").fontSize(8.5).fillColor(soft).text(label.toUpperCase(), margin + 6, y + 6, { width: contentW - 12 });
      y += 26;
    };

    banner();
    doc.font("NotoSans-Bold").fontSize(15).fillColor(ink).text(`Form 16 summary, financial year ${data.fyLabel}`, margin, y, { width: contentW });
    y = doc.y + 4;
    doc.font("NotoSans").fontSize(9).fillColor(soft).text(`Employer: ${business.name}${business.tan ? `   TAN: ${business.tan}` : ""}`, margin, y, { width: contentW });
    y = doc.y + 2;
    doc.text(`Employee: ${data.employee.name} (${data.employee.code})   PAN: ${data.employee.pan ?? "not recorded"}   ${data.regime === "new" ? "New" : "Old"} tax regime`, margin, y, { width: contentW });
    y = doc.y + 12;

    head("Part A style: tax deducted and deposited, by quarter");
    for (const q of data.quarters) row(`Quarter ${q.quarter}: salary paid ${fmt(q.grossPaise)}`, fmt(q.tdsPaise));
    row("Total tax deducted by this employer", fmt(data.tdsDeductedPaise), true);
    y += 6;

    head("Part B style: computation of tax");
    row("Gross salary from this employer", fmt(data.grossSalaryPaise));
    if (data.previousEmployerIncomePaise > 0) row("Income from the previous employer", fmt(data.previousEmployerIncomePaise));
    row("Standard deduction", `- ${fmt(data.standardDeductionPaise)}`);
    if (data.professionalTaxPaise > 0) row("Professional tax", `- ${fmt(data.professionalTaxPaise)}`);
    for (const d of data.declaredDeductions) if (d.paise > 0) row(d.label, `- ${fmt(d.paise)}`);
    row("Taxable income", fmt(data.taxableIncomePaise), true);
    row("Tax on the income (slabs)", fmt(data.tax.slabTaxPaise));
    if (data.tax.rebatePaise > 0) row("Rebate / relief", `- ${fmt(data.tax.rebatePaise)}`);
    row("Health and education cess", fmt(data.tax.cessPaise));
    row("Total tax payable", fmt(data.tax.totalPaise), true);
    row("Tax deducted by this employer", `- ${fmt(data.tdsDeductedPaise)}`);
    if (data.previousEmployerTdsPaise > 0) row("Tax deducted by the previous employer", `- ${fmt(data.previousEmployerTdsPaise)}`);
    row(data.differencePaise > 0 ? "Short deducted" : "Excess deducted (refundable on filing)", fmt(Math.abs(data.differencePaise)), true);
    y += 6;

    head("Month by month");
    for (const m of data.months) row(`${formatPayrollMonth(m.month)}: salary ${fmt(m.grossPaise)}`, `TDS ${fmt(m.tdsPaise)}`);

    y += 10;
    doc.font("NotoSans").fontSize(7.5).fillColor("#868e96").text(
      "Prepared from Fintranzact payroll for review by your chartered accountant. The official Form 16 is generated from the TRACES portal after the quarterly returns are filed. Surcharge and senior-citizen slabs are not computed.",
      margin,
      y,
      { width: contentW },
    );

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolvePdf(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}
