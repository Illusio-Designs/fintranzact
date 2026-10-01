/**
 * The printed invoice designs (lib/invoice-templates): every design renders a
 * valid PDF for an intra-state invoice, an inter-state invoice and a 45-line
 * invoice, with and without an IRN and an e-way bill; bills of supply, export
 * invoices and quotations get their own layout whatever is chosen; copies
 * print one page set each with the right label; thermal receipts on 58 and
 * 80 mm; and the e-way bill PDF.
 *
 * Text is read by recording every string PDFKit is asked to draw on the
 * document under test (PDFKit's own output embeds glyph ids, not text).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import PDFDocument from "pdfkit";
import { INVOICE_TEMPLATES, copyLabel, parseCopies, type InvoiceCopy, type InvoiceTemplate } from "@fintranzact/shared";
import { generateInvoicePDF, type InvoicePDFData } from "../lib/invoice-pdf.js";
import { generateEwayBillPDF, type EwayBillPDFData } from "../lib/eway-bill-pdf.js";
import { sampleInvoiceData, withSampleQrs } from "../lib/invoice-templates/sample.js";
import { amountInWords, buildModel, indianWords, inr, rs } from "../lib/invoice-templates/model.js";
import { COMPOSITION_NOTICE, NOT_A_TAX_INVOICE } from "../lib/invoice-templates/notices.js";

type Doc = InstanceType<typeof PDFDocument>;

const drawn = new Map<Doc, string[]>();
const originalText = PDFDocument.prototype.text;

beforeAll(() => {
  vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: Doc, ...args: unknown[]) {
    if (typeof args[0] === "string" || typeof args[0] === "number") {
      const list = drawn.get(this) ?? [];
      list.push(String(args[0]));
      drawn.set(this, list);
    }
    return (originalText as (...a: unknown[]) => Doc).apply(this, args);
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

interface Rendered { buf: Buffer; pages: number; text: string; strings: string[]; width: number; height: number }

async function render(doc: Doc): Promise<Rendered> {
  const pages = doc.bufferedPageRange().count;
  doc.switchToPage(0);
  const width = doc.page.width;
  const height = doc.page.height;
  const strings = drawn.get(doc) ?? [];
  drawn.delete(doc);
  const buf = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
  return { buf, pages, text: strings.join("\n"), strings, width, height };
}

async function invoice(data: InvoicePDFData, format: "a4" | "a5" | "thermal" = "a4"): Promise<Rendered> {
  return render(generateInvoicePDF(await withSampleQrs(data), format));
}

function withTemplate(template: InvoiceTemplate, data: InvoicePDFData, copies?: InvoiceCopy[]): InvoicePDFData {
  return { ...data, print: { ...data.print, template, ...(copies ? { copies } : {}) } };
}

const count = (r: Rendered, s: string) => r.strings.filter((x) => x === s).length;

describe("amounts in words and Indian grouping", () => {
  it("uses lakh and crore", () => {
    expect(indianWords(12345678)).toBe("One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight");
    expect(amountInWords(7970500)).toBe("Rupees Seventy Nine Thousand Seven Hundred Five Only");
    expect(amountInWords(9950)).toBe("Rupees Ninety Nine and Fifty Paise Only");
    expect(amountInWords(10000000000)).toBe("Rupees Ten Crore Only");
  });
  it("groups digits the Indian way", () => {
    expect(rs(123456700)).toBe("₹12,34,567.00");
    expect(inr(-150)).toBe("-1.50");
  });
});

describe("copies", () => {
  it("parses the copies query and labels goods and services copies (Rule 48)", () => {
    expect(parseCopies("triplicate,original")).toEqual(["original", "triplicate"]);
    expect(parseCopies("all")).toEqual(["original", "duplicate", "triplicate"]);
    expect(parseCopies("bogus")).toEqual([]);
    expect(copyLabel("duplicate", false)).toBe("DUPLICATE FOR TRANSPORTER");
    expect(copyLabel("duplicate", true)).toBe("DUPLICATE FOR SUPPLIER");
    expect(copyLabel("triplicate", true)).toBeNull();
  });
});

describe("the totals every design prints", () => {
  it("splits intra-state tax into CGST and SGST and sums to the grand total", () => {
    const m = buildModel(sampleInvoiceData());
    expect(m.intra).toBe(true);
    expect(m.cgst + m.sgst).toBe(m.tax);
    expect(m.taxable + m.tax + m.roundOff).toBe(m.grand);
    expect(m.byRate.map((r) => r.rate)).toEqual([5, 18]);
    expect(m.byHsn.reduce((s, h) => s + h.tax, 0)).toBe(m.tax);
  });
  it("charges IGST between states", () => {
    const m = buildModel(sampleInvoiceData({ interState: true }));
    expect(m.intra).toBe(false);
    expect(m.igst).toBe(m.tax);
    expect(m.cgst).toBe(0);
  });
});

const DESIGNS = INVOICE_TEMPLATES;

describe.each(DESIGNS)("design %s", (template) => {
  it("renders an intra-state invoice with IRN and e-way bill", async () => {
    const data = sampleInvoiceData({ withIrn: true, withEwayBill: true });
    const r = await invoice(withTemplate(template, data));
    expect(r.buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(r.pages).toBe(1);
    expect(r.text).toContain("24AAKFS4821M1Z3");
    expect(r.text).toContain("24AAJFP7788L1Z9");
    expect(r.text).toMatch(/GE\/25-26\/0418/);
    expect(r.text).toContain("79,705.00");
    expect(r.text).toMatch(/Seventy Nine Thousand Seven Hundred (and )?Five/);
    if (template !== "classic") {
      expect(r.text).toMatch(/TAX INVOICE|Tax Invoice|Tax invoice/);
      expect(r.text).toMatch(/CGST/);
      expect(r.text).toMatch(/SGST/);
      expect(r.text).toContain("181744026633");
      expect(r.text).toContain("GJ05BX4471");
      expect(r.text).toContain("8f3c1e2a7d65b0c4e91a2f3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c9b04d7");
      expect(r.text).toContain("ORIGINAL FOR RECIPIENT");
      expect(r.text).toMatch(/Authori[sz]ed Signatory/);
      expect(r.text).toContain("8539");
    }
  });

  it("renders an inter-state invoice without IRN or e-way bill", async () => {
    const r = await invoice(withTemplate(template, sampleInvoiceData({ interState: true })));
    expect(r.buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(r.pages).toBe(1);
    expect(r.text).toContain("29AABCB7781K1Z5");
    expect(r.text).toMatch(/IGST/);
    if (template !== "classic") {
      expect(r.text).not.toMatch(/IRN:/);
      expect(r.text).not.toContain("181744026633");
      expect(r.text).not.toMatch(/CGST @/);
      expect(r.text).toContain("Karnataka (29)");
    }
  });

  it("runs a 45-line invoice over several pages with page numbers and the header repeated", async () => {
    const r = await invoice(withTemplate(template, sampleInvoiceData({ lines: 45 })));
    expect(r.buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(r.pages).toBeGreaterThan(1);
    expect(r.pages).toBeLessThan(8);
    expect(r.text).toContain(`Page 1 of ${r.pages}`);
    expect(r.text).toContain(`Page ${r.pages} of ${r.pages}`);
    // Long names wrap: every line's full name is drawn, never cut.
    expect(r.text).toContain("Solar LED Lantern with USB charging — lot 11");
    if (template !== "classic") {
      expect(r.text).toContain("Carried forward");
      expect(r.text).toContain("Brought forward");
    }
  });

  it("prints one page set per copy, each labelled", async () => {
    const single = await invoice(withTemplate(template, sampleInvoiceData()));
    const r = await invoice(withTemplate(template, sampleInvoiceData(), ["original", "duplicate", "triplicate"]));
    expect(r.pages).toBe(single.pages * 3);
    for (const label of ["ORIGINAL FOR RECIPIENT", "DUPLICATE FOR TRANSPORTER", "TRIPLICATE FOR SUPPLIER"]) {
      expect(count(r, label)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("automatic layouts", () => {
  it("prints a composition dealer's invoice as a Bill of Supply with the notice and no tax columns", async () => {
    for (const template of ["classic", "modern", "minimal"] as const) {
      const r = await invoice(withTemplate(template, sampleInvoiceData({ gstRegistrationType: "composition" })));
      expect(r.text).toContain("Bill of Supply");
      expect(r.text).toContain(COMPOSITION_NOTICE);
      expect(r.text).not.toMatch(/CGST|SGST|IGST|Tax Invoice|TAX INVOICE/);
      expect(r.text).toContain("ORIGINAL FOR RECIPIENT");
    }
  });

  it("prints an export (overseas buyer) with the LUT endorsement", async () => {
    const r = await invoice(withTemplate("tally", sampleInvoiceData({ export: true })));
    expect(r.text).toContain("EXPORT INVOICE");
    expect(r.text).toMatch(/SUPPLY MEANT FOR EXPORT UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX · LUT ARN AD240326009871P/);
    expect(r.text).toContain("Outside India (96)");
    expect(r.text).toContain("United Arab Emirates");
    expect(r.text).toContain("0% (LUT)");
  });

  it("prints an export with IGST paid under the 'on payment of IGST' endorsement", async () => {
    const data = sampleInvoiceData({ export: true });
    const taxed: InvoicePDFData = {
      ...data,
      lineItems: data.lineItems.map((l) => ({ ...l, taxPercent: "18", taxAmount: (parseFloat(l.totalAmount) * 0.18).toFixed(2), totalAmount: (parseFloat(l.totalAmount) * 1.18).toFixed(2) })),
    };
    taxed.taxAmount = taxed.lineItems.reduce((s, l) => s + parseFloat(l.taxAmount), 0).toFixed(2);
    taxed.totalAmount = taxed.lineItems.reduce((s, l) => s + parseFloat(l.totalAmount), 0).toFixed(2);
    taxed.roundOff = "0.00";
    const r = await invoice(withTemplate("modern", taxed));
    expect(r.text).toContain("SUPPLY MEANT FOR EXPORT ON PAYMENT OF INTEGRATED TAX");
    expect(r.text).toMatch(/IGST @ 18%/);
  });

  it("prints quotations and proforma invoices as estimates: watermark, not-a-tax-invoice, valid till, no copy labels", async () => {
    const q = await invoice(withTemplate("tally", sampleInvoiceData({ documentType: "quotation" }), ["original", "duplicate"]));
    expect(q.pages).toBe(1);
    expect(q.text).toContain("QUOTATION");
    expect(q.text).toContain("ESTIMATE");
    expect(q.text).toContain(NOT_A_TAX_INVOICE);
    expect(q.text).toContain("Valid till 31-10-2026");
    expect(q.text).not.toContain("ORIGINAL FOR RECIPIENT");
    const p = await invoice(withTemplate("classic", sampleInvoiceData({ documentType: "proforma" })));
    expect(p.text).toContain("PROFORMA INVOICE");
    expect(p.text).toContain("PROFORMA");
  });

  it("labels service invoices' copies for the supplier, and prints no triplicate", async () => {
    const r = await invoice(withTemplate("service", sampleInvoiceData({ services: true }), ["original", "duplicate", "triplicate"]));
    const single = await invoice(withTemplate("service", sampleInvoiceData({ services: true })));
    expect(r.pages).toBe(single.pages * 2);
    expect(r.text).toContain("DUPLICATE FOR SUPPLIER");
    expect(r.text).not.toContain("TRIPLICATE");
    expect(r.text).toContain("998231");
  });

  it("keeps the classic layout unlabelled when no copies are asked for", async () => {
    const r = await invoice(sampleInvoiceData());
    expect(r.text).toContain("TAX INVOICE");
    expect(r.text).not.toContain("ORIGINAL FOR RECIPIENT");
  });

  it("uses the chosen design only for A4: A5 stays the simple invoice", async () => {
    const r = await invoice(withTemplate("tally", sampleInvoiceData()), "a5");
    expect(r.width).toBeCloseTo(595.28, 1);
    expect(r.height).toBeCloseTo(419.53, 1);
    expect(r.text).not.toContain("Description of Goods");
  });

  it("prints landscape and compact A5 on their own paper sizes", async () => {
    const l = await invoice(withTemplate("landscape", sampleInvoiceData()));
    expect(l.width).toBeGreaterThan(l.height);
    const a5 = await invoice(withTemplate("compact_a5", sampleInvoiceData()));
    expect(a5.width).toBeCloseTo(419.53, 1);
    expect(a5.height).toBeCloseTo(595.28, 1);
  });
});

describe("thermal receipts", () => {
  it.each([[58, 164.4], [80, 226.8]] as const)("%i mm roll", async (width, points) => {
    const data = sampleInvoiceData({ withEwayBill: true });
    const r = await invoice({ ...data, print: { thermalWidth: width } }, "thermal");
    expect(r.buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(r.pages).toBe(1);
    expect(r.width).toBeCloseTo(points, 0);
    expect(r.text).toContain("SHREE GANESH ELECTRICALS");
    expect(r.text).toContain("TAX INVOICE");
    expect(r.text).toContain("₹79,705.00");
    expect(r.text).toContain("GSTIN 24AAKFS4821M1Z3");
    expect(r.text).toMatch(/e-Way Bill 181744026633/);
    // The 80 mm receipt has room for the HSN beside the name; 58 mm moves it to the summary.
    if (width === 80) expect(r.text).toContain("LED Bulb 9W Cool Daylight (B22) (8539)");
    else expect(r.text).toContain("LED Bulb 9W Cool Daylight (B22)");
  });

  it("grows with the receipt and keeps a long one on a single page", async () => {
    const short = await invoice(sampleInvoiceData(), "thermal");
    const long = await invoice(sampleInvoiceData({ lines: 40 }), "thermal");
    expect(long.pages).toBe(1);
    expect(long.height).toBeGreaterThan(short.height + 600);
  });

  it("prints a composition dealer's receipt as a bill of supply", async () => {
    const r = await invoice(sampleInvoiceData({ gstRegistrationType: "composition" }), "thermal");
    expect(r.text).toContain("BILL OF SUPPLY");
    expect(r.text).toContain(COMPOSITION_NOTICE);
    expect(r.text).not.toMatch(/CGST/);
  });
});

describe("e-way bill PDF", () => {
  const base: EwayBillPDFData = {
    ewbNumber: "181744026633",
    ewbDate: "2026-10-01T06:30:00.000Z",
    validUpto: "2026-10-02T18:29:00.000Z",
    status: "generated",
    generatedBy: { gstin: "24AAKFS4821M1Z3", name: "Shree Ganesh Electricals LLP" },
    supplier: { gstin: "24AAKFS4821M1Z3", name: "Shree Ganesh Electricals LLP", address: "Relief Road, Ahmedabad, Gujarat" },
    recipient: { gstin: "29AABCB7781K1Z5", name: "Bengaluru Power Traders", address: "22 Residency Road, Bengaluru" },
    dispatchFrom: "Relief Road, Ahmedabad, 380001",
    deliverTo: "22 Residency Road, Bengaluru, 560025",
    documentType: "Tax Invoice",
    documentNumber: "GE/25-26/0418",
    documentDate: "2026-10-01T06:12:00.000Z",
    transactionType: "Regular",
    valueOfGoods: "79705.00",
    taxableValue: "68392.50",
    igst: "11312.25",
    hsnCodes: ["8539", "8544"],
    reason: "Outward - Supply",
    transporterId: "29AAACT1234Q1Z2",
    transporterName: "VRL Logistics",
    distance: 265,
    partB: [{ mode: "road", vehicle: "GJ05BX4471", from: "Ahmedabad", enteredDate: "2026-10-01T06:30:00.000Z", enteredBy: "24AAKFS4821M1Z3" }],
    isPaidPlan: true,
  };

  it("prints the EWB-01 layout: number, validity, Part A and Part B", async () => {
    const r = await render(generateEwayBillPDF(base));
    expect(r.buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(r.pages).toBe(1);
    for (const s of ["e-Way Bill", "1817 4402 6633", "Part - A", "Part - B", "GSTIN of Supplier", "Place of Dispatch", "GSTIN of Recipient",
      "Place of Delivery", "Value of Goods", "8539, 8544", "Outward - Supply", "29AAACT1234Q1Z2 - VRL Logistics", "GJ05BX4471", "Road",
      "Valid Until", "02-10-2026 23:59", "GE/25-26/0418"]) {
      expect(r.text).toContain(s);
    }
    expect(r.text).toContain("24AAKFS4821M1Z3 - Shree Ganesh Electricals LLP");
    expect(r.text).toContain("₹79,705.00");
  });

  it("marks a cancelled e-way bill", async () => {
    const r = await render(generateEwayBillPDF({ ...base, status: "cancelled", cancelReason: "Data Entry Mistake" }));
    expect(r.text).toContain("CANCELLED (Data Entry Mistake)");
  });
});
