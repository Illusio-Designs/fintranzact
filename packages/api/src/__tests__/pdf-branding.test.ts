/**
 * The "Powered by Fintranzact" line on PDFs: the pure link decision, and that
 * every printed document type draws the line (with the right link) for each of
 * the three plans' default, and nothing when a plan switches it off.
 *
 * What is drawn is read by recording the strings (and link options) PDFKit is
 * asked to draw; PDFKit's own output embeds glyph ids, not text.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import PDFDocument from "pdfkit";
import { INVOICE_TEMPLATES, PLAN_IDS, PLAN_LIMITS, type InvoiceTemplate } from "@fintranzact/shared";
import { generateInvoicePDF, type InvoicePDFData } from "../lib/invoice-pdf.js";
import { generateEwayBillPDF, type EwayBillPDFData } from "../lib/eway-bill-pdf.js";
import { sampleInvoiceData } from "../lib/invoice-templates/sample.js";
import { brandingFooterUrl, partnerCodeForBranding, publicSiteBase } from "../lib/pdf-branding.js";

const SITE = "https://app.fintranzact.example";

describe("brandingFooterUrl", () => {
  it("links an organisation referred by an approved partner to sign-up with that partner's code, and nothing else", () => {
    expect(brandingFooterUrl(SITE, { status: "approved", referralCode: "FTZ-7K2M9Q" })).toBe(`${SITE}/register?ref=FTZ-7K2M9Q`);
  });

  it("links to the plain site without a partner", () => {
    expect(brandingFooterUrl(SITE, null)).toBe(SITE);
    expect(brandingFooterUrl(SITE, undefined)).toBe(SITE);
  });

  it("falls back to the plain site for a partner who is not approved, or has no code", () => {
    for (const status of ["pending", "rejected"]) {
      expect(brandingFooterUrl(SITE, { status, referralCode: "FTZ-7K2M9Q" })).toBe(SITE);
    }
    expect(brandingFooterUrl(SITE, { status: "approved", referralCode: null })).toBe(SITE);
    expect(brandingFooterUrl(SITE, { status: "approved", referralCode: "  " })).toBe(SITE);
  });

  it("has no link when there is no public URL, and tolerates a trailing slash", () => {
    expect(brandingFooterUrl("", { status: "approved", referralCode: "FTZ-7K2M9Q" })).toBeUndefined();
    expect(brandingFooterUrl(`${SITE}/`, null)).toBe(SITE);
  });

  it("puts only the code in the query (encoded)", () => {
    const url = new URL(brandingFooterUrl(SITE, { status: "approved", referralCode: "ftz 7k&2" })!);
    expect([...url.searchParams.keys()]).toEqual(["ref"]);
    expect(url.pathname).toBe("/register");
  });

  it("partnerCodeForBranding only returns an approved partner's code", () => {
    expect(partnerCodeForBranding({ status: "approved", referralCode: "FTZ-ABC234" })).toBe("FTZ-ABC234");
    expect(partnerCodeForBranding({ status: "pending", referralCode: "FTZ-ABC234" })).toBeNull();
    expect(partnerCodeForBranding(null)).toBeNull();
  });

  it("publicSiteBase prefers APP_URL over the request origin", () => {
    const saved = process.env.APP_URL;
    try {
      process.env.APP_URL = "https://www.example.in/";
      expect(publicSiteBase("http://localhost:3000")).toBe("https://www.example.in");
      delete process.env.APP_URL;
      expect(publicSiteBase("http://localhost:3000/")).toBe("http://localhost:3000");
      expect(publicSiteBase()).toBe("");
    } finally {
      if (saved === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = saved;
    }
  });
});

type Doc = InstanceType<typeof PDFDocument>;
interface Drawn { text: string; link?: string }
const drawn = new Map<Doc, Drawn[]>();
const originalText = PDFDocument.prototype.text;

beforeAll(() => {
  vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: Doc, ...args: unknown[]) {
    if (typeof args[0] === "string" || typeof args[0] === "number") {
      const opts = [args[1], args[2], args[3]].find((a) => a && typeof a === "object") as { link?: string } | undefined;
      const list = drawn.get(this) ?? [];
      list.push({ text: String(args[0]), link: opts?.link });
      drawn.set(this, list);
    }
    return (originalText as (...a: unknown[]) => Doc).apply(this, args);
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

async function finish(doc: Doc): Promise<Drawn[]> {
  const items = drawn.get(doc) ?? [];
  drawn.delete(doc);
  await new Promise<void>((resolve, reject) => {
    doc.on("data", () => {});
    doc.on("end", () => resolve());
    doc.on("error", reject);
    doc.end();
  });
  return items;
}

const LINK = `${SITE}/register?ref=FTZ-7K2M9Q`;
/** What a plan's flag means for the PDF data: pdfBranding true shows the line (isPaidPlan false). */
const dataFor = (pdfBranding: boolean, over: Partial<InvoicePDFData> = {}): InvoicePDFData => ({
  ...sampleInvoiceData(),
  isPaidPlan: !pdfBranding,
  brandingUrl: LINK,
  ...over,
});
const brandingLines = (items: Drawn[]) => items.filter((d) => /^(Powered by )?Fintranzact$/.test(d.text));

describe("the Powered by Fintranzact line on every printed document", () => {
  for (const planId of PLAN_IDS) {
    describe(`${planId} plan (default pdfBranding ${PLAN_LIMITS[planId].pdfBranding})`, () => {
      const show = PLAN_LIMITS[planId].pdfBranding;

      it("is on by default for every plan", () => {
        expect(show).toBe(true);
      });

      for (const template of INVOICE_TEMPLATES) {
        it(`draws the linked line on the ${template} design`, async () => {
          const data = dataFor(show, { print: { template: template as InvoiceTemplate } });
          const items = await finish(generateInvoicePDF(data, "a4"));
          const lines = brandingLines(items);
          expect(lines.length, template).toBeGreaterThan(0);
          for (const l of lines) expect(l.link).toBe(LINK);
        });
      }

      for (const format of ["a5", "thermal"] as const) {
        it(`draws the linked line on the ${format} print`, async () => {
          const items = await finish(generateInvoicePDF(dataFor(show), format));
          const lines = brandingLines(items);
          expect(lines.length, format).toBeGreaterThan(0);
          for (const l of lines) expect(l.link).toBe(LINK);
        });
      }

      it("draws the linked line on the e-way bill print", async () => {
        const items = await finish(generateEwayBillPDF(ewayData(!show, LINK)));
        const lines = brandingLines(items);
        expect(lines).toHaveLength(1);
        expect(lines[0]!.link).toBe(LINK);
      });
    });
  }

  it("draws nothing when a plan switches the flag off (every design, formats and e-way bill)", async () => {
    for (const template of INVOICE_TEMPLATES) {
      const items = await finish(generateInvoicePDF(dataFor(false, { print: { template: template as InvoiceTemplate } }), "a4"));
      expect(brandingLines(items), template).toHaveLength(0);
    }
    for (const format of ["a5", "thermal"] as const) {
      expect(brandingLines(await finish(generateInvoicePDF(dataFor(false), format))), format).toHaveLength(0);
    }
    expect(brandingLines(await finish(generateEwayBillPDF(ewayData(true, LINK))))).toHaveLength(0);
  });

  it("draws the line as plain text, with no link, when there is no URL", async () => {
    const items = await finish(generateInvoicePDF(dataFor(true, { brandingUrl: undefined }), "a4"));
    const lines = brandingLines(items);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.link).toBeUndefined();
  });
});

function ewayData(isPaidPlan: boolean, brandingUrl: string): EwayBillPDFData {
  return {
    ewbNumber: "181744026633",
    generatedBy: { gstin: "24AAKFS4821M1Z3", name: "Shree Ganesh Electricals LLP" },
    validUpto: "2026-10-02T18:29:00.000Z",
    ewbDate: "2026-10-01T06:12:00.000Z",
    supplier: { gstin: "24AAKFS4821M1Z3", name: "Shree Ganesh Electricals LLP", address: "1 Road", state: "Gujarat" },
    recipient: { gstin: "29AABCT1332L1ZZ", name: "Customer", address: "2 Road", state: "Karnataka" },
    dispatchFrom: "Ahmedabad",
    deliverTo: "Bengaluru",
    documentType: "Tax Invoice",
    documentNumber: "GE/25-26/0418",
    documentDate: "2026-10-01T06:12:00.000Z",
    transactionType: "Regular",
    valueOfGoods: "79705.00",
    taxableValue: "68392.50",
    igst: "11312.25",
    hsnCodes: ["8539"],
    reason: "Outward - Supply",
    partB: [{ mode: "road", vehicle: "GJ05BX4471" }],
    isPaidPlan,
    brandingUrl,
  } as unknown as EwayBillPDFData;
}
