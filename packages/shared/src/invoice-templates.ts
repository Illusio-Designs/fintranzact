/**
 * Printed invoice designs a business can choose from (Settings → Documents →
 * Invoice design). "classic" is the original A4 layout and the default, so
 * nobody's invoices change until they pick another design.
 *
 * Bills of supply (composition dealers), export invoices and quotations /
 * proforma invoices print in their own fixed layouts whatever is chosen here.
 */
export const INVOICE_TEMPLATES = [
  "classic",
  "tally",
  "modern",
  "letterhead",
  "bold",
  "minimal",
  "dense",
  "landscape",
  "compact_a5",
  "service",
] as const;

export type InvoiceTemplate = (typeof INVOICE_TEMPLATES)[number];

export const DEFAULT_INVOICE_TEMPLATE: InvoiceTemplate = "classic";

export interface InvoiceTemplateInfo {
  id: InvoiceTemplate;
  name: string;
  /** Paper size and orientation, as shown in the picker. */
  size: string;
  description: string;
}

export const INVOICE_TEMPLATE_INFO: readonly InvoiceTemplateInfo[] = [
  {
    id: "classic",
    name: "Classic",
    size: "A4 portrait",
    description: "The original Fintranzact GST invoice: a coloured title band, seller and invoice details side by side, and a tax summary under the items.",
  },
  {
    id: "tally",
    name: "Tally Classic",
    size: "A4 portrait",
    description: "The boxed format traders and their CAs know from TallyPrime. Every detail sits in its own cell, with an HSN-wise tax table and the e-invoice QR at the top.",
  },
  {
    id: "modern",
    name: "Modern GST",
    size: "A4 portrait",
    description: "The everyday default for most small businesses: a brand-colour accent, clear cards for the parties and a rate-wise tax summary beside the totals.",
  },
  {
    id: "letterhead",
    name: "Corporate Letterhead",
    size: "A4 portrait",
    description: "A formal, restrained invoice for larger firms and corporate buyers: a centred letterhead, serif-style headings and a registered-office footer on every page.",
  },
  {
    id: "bold",
    name: "Bold Header Band",
    size: "A4 portrait",
    description: "A confident look for D2C brands and online stores: the amount due and dates sit in a dark band that reads well even as a small WhatsApp preview.",
  },
  {
    id: "minimal",
    name: "Minimal",
    size: "A4 portrait",
    description: "Quiet and airy, for consultants, designers and agencies whose clients expect a clean document. Still carries every GST field, just in small grey type.",
  },
  {
    id: "dense",
    name: "Spreadsheet (Batch & MRP)",
    size: "A4 portrait",
    description: "Many lines on one page for distributors, pharma and hardware wholesalers: batch, expiry, MRP and per-line CGST/SGST in a tight grid.",
  },
  {
    id: "landscape",
    name: "Landscape Wide",
    size: "A4 landscape",
    description: "When an invoice needs 14–16 columns, turning the page gives every column room without shrinking the text.",
  },
  {
    id: "compact_a5",
    name: "Compact A5",
    size: "A5 portrait",
    description: "Half a sheet for counter sales: two bills per A4 page, a short table and a single line per tax rate.",
  },
  {
    id: "service",
    name: "Professional Services",
    size: "A4 portrait",
    description: "For CAs, consultants and agencies: no quantity-and-unit clutter, a due-date callout and a pay-now block near the total.",
  },
];

/** Thermal roll widths in millimetres: 58 mm fits about 32 characters a line, 80 mm about 48. */
export const THERMAL_WIDTHS = [58, 80] as const;
export type ThermalWidth = (typeof THERMAL_WIDTHS)[number];
export const DEFAULT_THERMAL_WIDTH: ThermalWidth = 80;

/** Copies of a tax invoice (CGST Rule 48), in print order. */
export const INVOICE_COPIES = ["original", "duplicate", "triplicate"] as const;
export type InvoiceCopy = (typeof INVOICE_COPIES)[number];

/**
 * The label printed at the top right of each copy. Goods: original for the
 * recipient, duplicate for the transporter, triplicate for the supplier.
 * Services need only two: original for the recipient, duplicate for the
 * supplier (a triplicate of a service invoice is not printed).
 */
export function copyLabel(copy: InvoiceCopy, services: boolean): string | null {
  if (copy === "original") return "ORIGINAL FOR RECIPIENT";
  if (copy === "duplicate") return services ? "DUPLICATE FOR SUPPLIER" : "DUPLICATE FOR TRANSPORTER";
  return services ? null : "TRIPLICATE FOR SUPPLIER";
}

/** Parse a `copies=original,duplicate` query value; unknown names are ignored, order is fixed. */
export function parseCopies(raw: string | null | undefined): InvoiceCopy[] {
  if (!raw) return [];
  const asked = new Set(raw.split(",").map((s) => s.trim().toLowerCase()));
  if (asked.has("all")) return [...INVOICE_COPIES];
  return INVOICE_COPIES.filter((c) => asked.has(c));
}
