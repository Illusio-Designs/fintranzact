/**
 * gst-seed.ts — The GST month the J9 (GST filing) journey books through the
 * UI, and the masters it books it with.
 *
 *   - Masters (customers, suppliers, items) are J3's journey: seeded here
 *     through the API.
 *   - The month's documents are J9's: J9 creates them in the UI. J10
 *     (dashboard & reports) checks the same month's figures and seeds the
 *     identical documents through the API with `seedGstMonthViaApi`, so both
 *     journeys share one definition — and one set of expected figures
 *     (GST_MONTH below).
 *
 * The month is the last full calendar month in India (the return a business
 * files at the start of the next one), so every journey run sees a month
 * that is over, whatever today's date is.
 */
import type { SeededOwner } from "./journey-seed";
import { uid } from "./journey";

// ── The month ────────────────────────────────────────────────────

/** 00:00 IST on a calendar day in India (the app's shared istStartOfDay). */
function istStartOfDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - 330 * 60_000);
}

export type GstPeriod = {
  year: number;
  /** 1-12 */
  month: number;
  /** "September" */
  monthName: string;
  /** "Sep 2026" — the report's own period label */
  label: string;
  /** Start year of the financial year it falls in (2026 for FY 2026-27). */
  fyStart: number;
  /** "2026-09" (GSTR-2B return period) */
  returnPeriod: string;
  /** "092026" (the portal's `fp`) */
  fp: string;
  /** FY quarter 1-4 (Q1 = Apr–Jun) */
  quarter: number;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The calendar month before the current one, in India. */
export function lastMonthInIndia(now = new Date()): GstPeriod {
  const ist = new Date(now.getTime() + 330 * 60_000);
  let year = ist.getUTCFullYear();
  let month = ist.getUTCMonth(); // previous month, 1-12 (0 → December)
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  const monthName = MONTHS[month - 1];
  return {
    year,
    month,
    monthName,
    label: `${monthName.slice(0, 3)} ${year}`,
    fyStart: month >= 4 ? year : year - 1,
    returnPeriod: `${year}-${String(month).padStart(2, "0")}`,
    fp: `${String(month).padStart(2, "0")}${year}`,
    quarter: month >= 4 ? Math.floor((month - 4) / 3) + 1 : 4,
  };
}

/** An instant on `day` of the period at hh:mm India time. */
export function istAt(p: GstPeriod, day: number, hh = 12, mm = 0): Date {
  return new Date(istStartOfDay(p.year, p.month, day).getTime() + (hh * 60 + mm) * 60_000);
}

/** The instant a date picked in an Indian browser is stored as: 00:00 IST that day. */
export function istMidnight(p: GstPeriod, day: number): Date {
  return istStartOfDay(p.year, p.month, day);
}

/** DD-MM-YYYY, the portal's date format. */
export function portalDate(p: GstPeriod, day: number) {
  return `${String(day).padStart(2, "0")}-${String(p.month).padStart(2, "0")}-${p.year}`;
}

// ── Masters ─────────────────────────────────────────────────────

type Ref = { id: string; name: string };

export type GstMasters = {
  id: string;
  /** Maharashtra, registered: B2B, CGST + SGST */
  pune: Ref;
  /** Karnataka, registered: B2B, IGST */
  tumkur: Ref;
  /** Maharashtra, unregistered: B2C small */
  ramesh: Ref;
  /** Gujarat, unregistered: B2C large when above ₹1,00,000 */
  anand: Ref;
  /** Maharashtra supplier, registered */
  bhiwandi: Ref;
  /** Karnataka supplier, registered */
  bengaluru: Ref;
  /** 18%, HSN 7326, pcs — bought at ₹700, sold at ₹1,000 */
  bracket: Ref;
  /** 12%, HSN 3004, btl — bought at ₹300, sold at ₹500 */
  tonic: Ref;
  /** 0% (exempt), HSN 1006, kg — bought at ₹35, sold at ₹50 */
  rice: Ref;
  /** 18% service, SAC 998719 — ₹2,000 */
  install: Ref;
};

/** GSTINs of the parties, as the 2B and the GSTR-1 JSON carry them. */
export const GSTIN = {
  business: "27AAPFU0939F1ZV",
  pune: "27AAACR5055K1Z5",
  tumkur: "29AABCT1332L1ZT",
  bhiwandi: "27AADCB2230M1ZT",
  bengaluru: "29AAGCB7383J1Z4",
  /** In the 2B only: a supplier whose bill never reached the books */
  thane: "27AAFCT2114Q1ZK",
};

export async function seedGstMasters(owner: SeededOwner): Promise<GstMasters> {
  const api = owner.api;
  const id = uid();
  const party = (name: string, type: "customer" | "supplier", extra: Record<string, unknown>) =>
    api.mutate<Ref>("party.create", { name, type, ...extra }).then((r) => ({ id: r.id, name: r.name }));
  const item = (name: string, extra: Record<string, unknown>) =>
    api
      .mutate<Ref>("item.create", { name, itemMode: "simple", itemType: "product", taxInclusive: false, stockQuantity: "0", ...extra })
      .then((r) => ({ id: r.id, name: r.name }));

  return {
    id,
    pune: await party(`Pune Retail ${id}`, "customer", {
      phone: "9822012345",
      gstin: GSTIN.pune,
      gstRegistrationType: "regular",
      state: "Maharashtra",
      stateCode: "27",
      billingAddress: "14 FC Road, Pune",
      city: "Pune",
      pincode: "411004",
    }),
    tumkur: await party(`Tumkur Traders ${id}`, "customer", {
      phone: "9845012345",
      gstin: GSTIN.tumkur,
      gstRegistrationType: "regular",
      state: "Karnataka",
      stateCode: "29",
      billingAddress: "12 BH Road, Tumakuru",
      city: "Tumakuru",
      pincode: "572101",
    }),
    ramesh: await party(`Ramesh Kumar ${id}`, "customer", {
      phone: "9820011111",
      gstRegistrationType: "unregistered",
      state: "Maharashtra",
      stateCode: "27",
      billingAddress: "Flat 4, Shivaji Nagar, Mumbai",
      city: "Mumbai",
      pincode: "400016",
    }),
    anand: await party(`Anand Sharma ${id}`, "customer", {
      phone: "9825022222",
      gstRegistrationType: "unregistered",
      state: "Gujarat",
      stateCode: "24",
      billingAddress: "22 CG Road, Ahmedabad",
      city: "Ahmedabad",
      pincode: "380009",
    }),
    bhiwandi: await party(`Bhiwandi Steel Distributors ${id}`, "supplier", {
      phone: "9822098765",
      gstin: GSTIN.bhiwandi,
      gstRegistrationType: "regular",
      state: "Maharashtra",
      stateCode: "27",
      billingAddress: "Gala 7, Mankoli Naka, Bhiwandi",
      city: "Bhiwandi",
      pincode: "421302",
    }),
    bengaluru: await party(`Bengaluru Herbals ${id}`, "supplier", {
      phone: "9845098765",
      gstin: GSTIN.bengaluru,
      gstRegistrationType: "regular",
      state: "Karnataka",
      stateCode: "29",
      billingAddress: "88 Peenya Industrial Area, Bengaluru",
      city: "Bengaluru",
      pincode: "560058",
    }),
    bracket: await item(`Steel Bracket ${id}`, { hsn: "7326", unit: "pcs", salePrice: "1000.00", purchasePrice: "700.00", taxPercent: "18" }),
    tonic: await item(`Herbal Tonic ${id}`, { hsn: "3004", unit: "btl", salePrice: "500.00", purchasePrice: "300.00", taxPercent: "12" }),
    rice: await item(`Loose Rice ${id}`, { hsn: "1006", unit: "kg", salePrice: "50.00", purchasePrice: "35.00", taxPercent: "0" }),
    install: await item(`Installation Service ${id}`, {
      hsn: "998719",
      unit: "other",
      itemType: "service",
      salePrice: "2000.00",
      taxPercent: "18",
    }),
  };
}

// ── The month's documents ───────────────────────────────────────

export type GstLine = { item: keyof Pick<GstMasters, "bracket" | "tonic" | "rice" | "install">; qty: number; price: number; tax: number };

export type GstDoc = {
  key: string;
  kind: "sale" | "purchase" | "credit_note";
  party: keyof Pick<GstMasters, "pune" | "tumkur" | "ramesh" | "anand" | "bhiwandi" | "bengaluru">;
  day: number;
  /** India time the document is entered (the browser clock in J9) */
  hh: number;
  mm: number;
  lines: GstLine[];
  discount?: number;
  /** Purchases: the supplier's own bill number */
  supplierInvoiceNumber?: string;
  /** Credit notes: the sale it is issued against */
  against?: string;
  /** Expected */
  taxable: number;
  tax: number;
  total: number;
};

/**
 * The month, in the order it happens. Business: Maharashtra (27), regular.
 *
 *   1st 00:05  B2C small, service: Ramesh, 1 × ₹2,000 @18%     = ₹2,360
 *   2nd        bill: Bhiwandi BPD/…/118, 120 brackets @₹700 @18% + 100 kg rice @₹35 @0%
 *              = ₹84,000 + ₹15,120 + ₹3,500 = ₹1,02,620
 *   3rd        bill: Bengaluru KAR-INV-0042, 30 tonic @₹300 @12% IGST = ₹10,080
 *   4th        B2B same state: Pune, 10 brackets + 4 tonic       = ₹12,000 + ₹2,040 = ₹14,040
 *   5th        B2B other state: Tumkur, 20 tonic, ₹500 discount  = ₹9,500 + ₹1,140 IGST = ₹10,640
 *   8th        B2C large, other state: Anand (Gujarat), 100 brackets = ₹1,00,000 + ₹18,000 IGST = ₹1,18,000
 *   10th       exempt: Ramesh, 40 kg rice @0%                     = ₹2,000
 *   11th       bill: Bhiwandi BPD/…/131, 10 brackets              = ₹7,000 + ₹1,260 = ₹8,260 (not in the 2B)
 *   12th       credit note to unregistered: Anand, 10 brackets    = ₹10,000 + ₹1,800 IGST = ₹11,800 (CDNUR)
 *   15th       credit note to registered: Pune, 2 brackets        = ₹2,000 + ₹360 = ₹2,360 (CDNR)
 */
export const GST_DOCS: GstDoc[] = [
  { key: "boundary", kind: "sale", party: "ramesh", day: 1, hh: 0, mm: 5, lines: [{ item: "install", qty: 1, price: 2000, tax: 18 }], taxable: 2000, tax: 360, total: 2360 },
  {
    key: "bill118",
    kind: "purchase",
    party: "bhiwandi",
    day: 2,
    hh: 11,
    mm: 0,
    supplierInvoiceNumber: "BPD/2627/118",
    lines: [
      { item: "bracket", qty: 120, price: 700, tax: 18 },
      { item: "rice", qty: 100, price: 35, tax: 0 },
    ],
    taxable: 87500,
    tax: 15120,
    total: 102620,
  },
  {
    key: "bill42",
    kind: "purchase",
    party: "bengaluru",
    day: 3,
    hh: 11,
    mm: 0,
    supplierInvoiceNumber: "KAR-INV-0042",
    lines: [{ item: "tonic", qty: 30, price: 300, tax: 12 }],
    taxable: 9000,
    tax: 1080,
    total: 10080,
  },
  {
    key: "b2bIntra",
    kind: "sale",
    party: "pune",
    day: 4,
    hh: 12,
    mm: 0,
    lines: [
      { item: "bracket", qty: 10, price: 1000, tax: 18 },
      { item: "tonic", qty: 4, price: 500, tax: 12 },
    ],
    taxable: 12000,
    tax: 2040,
    total: 14040,
  },
  { key: "b2bInter", kind: "sale", party: "tumkur", day: 5, hh: 12, mm: 0, lines: [{ item: "tonic", qty: 20, price: 500, tax: 12 }], discount: 500, taxable: 9500, tax: 1140, total: 10640 },
  { key: "b2cl", kind: "sale", party: "anand", day: 8, hh: 12, mm: 0, lines: [{ item: "bracket", qty: 100, price: 1000, tax: 18 }], taxable: 100000, tax: 18000, total: 118000 },
  { key: "exempt", kind: "sale", party: "ramesh", day: 10, hh: 12, mm: 0, lines: [{ item: "rice", qty: 40, price: 50, tax: 0 }], taxable: 2000, tax: 0, total: 2000 },
  {
    key: "bill131",
    kind: "purchase",
    party: "bhiwandi",
    day: 11,
    hh: 11,
    mm: 0,
    supplierInvoiceNumber: "BPD/2627/131",
    lines: [{ item: "bracket", qty: 10, price: 700, tax: 18 }],
    taxable: 7000,
    tax: 1260,
    total: 8260,
  },
  { key: "cnUnreg", kind: "credit_note", party: "anand", day: 12, hh: 12, mm: 0, against: "b2cl", lines: [{ item: "bracket", qty: 10, price: 1000, tax: 18 }], taxable: 10000, tax: 1800, total: 11800 },
  { key: "cnReg", kind: "credit_note", party: "pune", day: 15, hh: 12, mm: 0, against: "b2bIntra", lines: [{ item: "bracket", qty: 2, price: 1000, tax: 18 }], taxable: 2000, tax: 360, total: 2360 },
];

/** The month's figures, worked out by hand from GST_DOCS (see the table above). */
export const GST_MONTH = {
  gstr1: {
    invoiceCount: 5,
    taxable: 125500,
    cgst: 1200,
    sgst: 1200,
    igst: 19140,
    tax: 21540,
    value: 147040,
  },
  gstr3b: {
    /** 3.1(a): net of both credit notes, without the exempt rice */
    outward: { taxable: 111500, igst: 17340, cgst: 1020, sgst: 1020 },
    /** 3.1(c): nil-rated / exempt */
    exempt: 2000,
    /** 4: ITC from the three bills */
    itc: { igst: 1080, cgst: 8190, sgst: 8190, total: 17460 },
    net: { igst: 16260, cgst: -7170, sgst: -7170, total: 1920 },
  },
  /** Stock left at the end of the month (credit notes move no stock) */
  stock: { bracket: 20, tonic: 6, rice: 60 },
};

/**
 * J10's copy of the month: the same documents through the API, each dated
 * at the moment J9 enters it (an Indian browser sends local midnight).
 */
export async function seedGstMonthViaApi(owner: SeededOwner, m: GstMasters, p: GstPeriod) {
  const api = owner.api;
  const ids: Record<string, { id: string; invoiceNumber: string }> = {};
  for (const doc of GST_DOCS) {
    const lineItems = doc.lines.map((l) => ({
      itemId: m[l.item].id,
      itemName: m[l.item].name,
      quantity: String(l.qty),
      unitPrice: l.price.toFixed(2),
      taxPercent: String(l.tax),
      discountPercent: "0",
      conversionFactor: "1",
    }));
    const common = {
      partyId: m[doc.party].id,
      invoiceDate: istMidnight(p, doc.day).toISOString(),
      lineItems,
      invoiceDiscount: (doc.discount ?? 0).toFixed(2),
      invoiceDiscountType: "amount",
      additionalCharges: "0",
      roundOff: "0",
    };
    if (doc.kind === "credit_note") {
      ids[doc.key] = await api.mutate("creditNote.create", {
        ...common,
        type: "sale",
        documentType: "credit_note",
        referenceDocumentId: ids[doc.against!].id,
      });
    } else {
      ids[doc.key] = await api.mutate("invoice.create", {
        ...common,
        type: doc.kind,
        documentType: "invoice",
        ...(doc.supplierInvoiceNumber ? { supplierInvoiceNumber: doc.supplierInvoiceNumber } : {}),
      });
    }
  }
  return ids;
}
