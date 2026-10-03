/**
 * GST on Finvera's subscription invoices: the CGST+SGST / IGST split by place of
 * supply (GSTIN first, then the billing state, else IGST), and what the PDF prints.
 * What is drawn is read by recording the strings PDFKit is asked to draw.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import PDFDocument from "pdfkit";
import { generateBillingInvoicePDF, gstSplit, type BillingInvoiceData } from "../lib/billing/invoice-pdf.js";

const GUJ = "24AAKFS4821M1Z3";
const KA = "29AABCT1332L1ZZ";

const labels = (parts: Array<{ label: string }>) => parts.map((p) => p.label);

describe("gstSplit", () => {
  const cgstSgst = ["CGST (9%)", "SGST (9%)"];
  const igst = ["IGST (18%)"];
  const table: Array<[string, { gstin?: string | null; state?: string | null }, string[]]> = [
    ["GSTIN in Gujarat", { gstin: GUJ }, cgstSgst],
    ["GSTIN in another state", { gstin: KA }, igst],
    ["no GSTIN, state Gujarat", { gstin: null, state: "24" }, cgstSgst],
    ["no GSTIN, another state", { gstin: null, state: "29" }, igst],
    ["no GSTIN, no state (unknown)", { gstin: null, state: null }, igst],
    ["GSTIN in Karnataka with state Gujarat: the GSTIN wins", { gstin: KA, state: "24" }, igst],
    ["GSTIN in Gujarat with state Karnataka: the GSTIN wins", { gstin: GUJ, state: "29" }, cgstSgst],
    ["invalid GSTIN, state Gujarat: treated as none", { gstin: "24XXXX", state: "24" }, cgstSgst],
    ["invalid GSTIN, no state", { gstin: "24XXXX" }, igst],
  ];
  for (const [name, customer, want] of table) {
    it(name, () => expect(labels(gstSplit(customer, 1800))).toEqual(want));
  }

  it("splits an odd paise amount without losing a paisa", () => {
    const parts = gstSplit({ state: "24" }, 1801);
    expect(parts.map((p) => p.paise)).toEqual([900, 901]);
    expect(parts.reduce((s, p) => s + p.paise, 0)).toBe(1801);
  });

  it("uses the seller state it is given (env-driven)", () => {
    expect(labels(gstSplit({ gstin: KA }, 1800, "29"))).toEqual(["CGST (9%)", "SGST (9%)"]);
  });
});

type Doc = InstanceType<typeof PDFDocument>;
const drawn: string[] = [];
const originalText = PDFDocument.prototype.text;
beforeAll(() => {
  vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: Doc, ...args: unknown[]) {
    if (typeof args[0] === "string") drawn.push(args[0]);
    return (originalText as (...a: unknown[]) => Doc).apply(this, args);
  });
});
afterAll(() => vi.restoreAllMocks());

const base = (customer: BillingInvoiceData["customer"]): BillingInvoiceData => ({
  invoiceNumber: "FIN-00001",
  date: new Date("2026-10-03T10:00:00Z"),
  description: "Growth plan — monthly",
  periodStart: new Date("2026-10-03T10:00:00Z"),
  periodEnd: new Date("2026-11-03T10:00:00Z"),
  basePaise: 69900,
  gstPaise: 12582,
  totalPaise: 82482,
  method: "upi",
  providerPaymentId: "pay_demo_x",
  customer,
  isCreditNote: false,
});

async function printed(customer: BillingInvoiceData["customer"]): Promise<string[]> {
  drawn.length = 0;
  const buf = await generateBillingInvoicePDF(base(customer));
  expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  return [...drawn];
}

describe("the subscription invoice PDF", () => {
  it("unregistered customer in Gujarat: State and Place of supply Gujarat (24), CGST + SGST", async () => {
    const t = await printed({ name: "Asha", gstin: null, address: "Surat", state: "24" });
    expect(t).toContain("State: Gujarat (24)");
    expect(t).toContain("Place of supply: Gujarat (24)");
    expect(t).toContain("CGST (9%)");
    expect(t).toContain("SGST (9%)");
    expect(t).not.toContain("IGST (18%)");
  });

  it("unregistered customer in another state: IGST", async () => {
    const t = await printed({ name: "Ravi", gstin: null, address: null, state: "27" });
    expect(t).toContain("State: Maharashtra (27)");
    expect(t).toContain("Place of supply: Maharashtra (27)");
    expect(t).toContain("IGST (18%)");
    expect(t).not.toContain("CGST (9%)");
  });

  it("no GSTIN and no state: says so and charges IGST", async () => {
    const t = await printed({ name: "Meena", gstin: null, address: "Somewhere in Gujarat" });
    expect(t.some((s) => s.startsWith("State:"))).toBe(false);
    expect(t).toContain("Place of supply: Not specified (taxed as IGST)");
    expect(t).toContain("IGST (18%)");
  });

  it("GSTIN decides over a different state, and prints the GSTIN's state", async () => {
    const t = await printed({ name: "Karan", gstin: KA, address: null, state: "24" });
    expect(t).toContain("State: Karnataka (29)");
    expect(t).toContain("Place of supply: Karnataka (29)");
    expect(t).toContain("IGST (18%)");
  });

  it("GSTIN in Gujarat without a billing state: Gujarat from the GSTIN, CGST + SGST", async () => {
    const t = await printed({ name: "Shree", gstin: GUJ, address: null });
    expect(t).toContain("Place of supply: Gujarat (24)");
    expect(t).toContain("SGST (9%)");
  });
});
