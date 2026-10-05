import { z } from "zod";
import { INVOICE_TEMPLATES } from "./invoice-templates.js";
import {
  GSTIN_REGEX,
  PAN_REGEX,
  IFSC_REGEX,
  UDYAM_REGEX,
  panFromGstin,
  partyGstTypes,
  partyConstitutions,
  gstinStatuses,
  msmeCategories,
  tdsSectionCodes,
} from "./party-compliance.js";
import { tcsSectionCodes } from "./tcs.js";

// ── Common ─────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const searchSchema = z.object({
  query: z.string().min(1).max(200),
});

// ── Auth ───────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(128),
});

export const registerSchema = z.object({
  username: z.string().trim().min(3).max(50).optional(),
  name: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(128),
  confirmPassword: z.string(),
  referralCode: z.string().trim().max(50).optional().or(z.literal("")),
  /** The plan chosen at sign-up (starter, growth or business); Growth when left out. Removed plan ids are refused by the API. */
  plan: z.string().trim().max(40).optional(),
  turnstileToken: z.string().optional(),
}).superRefine((data, ctx) => {
  const username = (data.username ?? data.name)?.trim();
  if (!username) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["username"],
      message: "Username is required",
    });
  }

  if (data.password !== data.confirmPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmPassword"],
      message: "Passwords don't match",
    });
  }
});

export const completeProfileSchema = z.object({
  name: z.string().min(2).max(100),
});

// ── Business ───────────────────────────────────────────────────

export const gstRegistrationTypes = ["regular", "composition", "unregistered"] as const;
export type GstRegistrationType = (typeof gstRegistrationTypes)[number];

export const businessTypes = [
  "proprietorship",
  "partnership",
  "llp",
  "private_limited",
  "public_limited",
  "one_person_company",
  "huf",
  "trust",
  "society",
  "other",
] as const;

export type BusinessType = (typeof businessTypes)[number];

export const createBusinessSchema = z.object({
  // General business details
  name: z.string().min(1).max(200),
  legalName: z.string().max(200).optional(),
  businessType: z.enum(businessTypes).default("proprietorship"),

  phone: z.string().min(1).max(15),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().min(1).max(500),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  landmark: z.string().optional(),
  countryOfOperations: z.string().optional(),
  financialYearStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid financial year start date")
    .optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  stateCode: z.string().max(2).optional(),
  pincode: z.string().max(10).optional(),

  // Statutory details
  gstRegistrationType: z.enum(gstRegistrationTypes).default("unregistered"),
  gstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
    .optional()
    .or(z.literal("")),
  pan: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/),
  tan: z.string().max(10).optional().or(z.literal("")),
  deductorType: z
    .string()
    .max(50)
    .optional()
    .or(z.literal("")),

  responsiblePersonName: z
    .string()
    .max(200)
    .optional()
    .or(z.literal("")),

  responsiblePersonPan: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
    .optional()
    .or(z.literal("")),

  responsiblePersonDesignation: z
    .string()
    .max(100)
    .optional()
    .or(z.literal("")),
  cin: z.string().max(21).optional().or(z.literal("")),
  llpin: z.string().max(7).optional().or(z.literal("")),
  udyamNumber: z.string().max(30).optional().or(z.literal("")),
  iecCode: z.string().max(10).optional().or(z.literal("")),
  lutArn: z.string().max(100).optional().or(z.literal("")),
  eInvoiceEnabled: z.boolean().default(false),
  eWayBillEnabled: z.boolean().default(false),

  // Taxpayer API credentials for the compliance portals. Optional: the feature
  // toggles work without them, and they can be filled in later from Settings.
  eInvoiceUsername: z.string().max(100).optional().or(z.literal("")),
  eInvoicePassword: z.string().max(200).optional().or(z.literal("")),
  eWayBillUsername: z.string().max(100).optional().or(z.literal("")),
  eWayBillPassword: z.string().max(200).optional().or(z.literal("")),
  assesseeOfOtherTerritory: z.boolean().default(false),
  gstReturnPeriodicity: z.enum(["monthly", "quarterly"]).default("monthly"),
  eWayBillThreshold: z.coerce
    .number()
    .nonnegative()
    .optional()
    .nullable(),

  // Document defaults
  invoicePrefix: z.string().min(1).max(10).default("INV"),
  currency: z.string().length(3).default("INR"),
  paymentPrefix: z.string().min(1).max(10).default("PAY"),
  quotationPrefix: z.string().min(1).max(10).default("QTN"),
  creditNotePrefix: z.string().min(1).max(10).default("CN"),
  deliveryChallanPrefix: z.string().min(1).max(10).default("DC"),
  proformaPrefix: z.string().min(1).max(10).default("PI"),
  debitNotePrefix: z.string().min(1).max(10).default("DN"),
  salesReturnPrefix: z.string().min(1).max(10).default("SR"),
  purchaseReturnPrefix: z.string().min(1).max(10).default("PR"),
  purchaseOrderPrefix: z.string().min(1).max(10).default("PO"),
  salesOrderPrefix: z.string().min(1).max(10).default("SO"),
  goodsReceiptNotePrefix: z.string().min(1).max(10).default("GRN"),
  // Drives HSN digit enforcement and the e-invoicing threshold.
  annualTurnover: z.number().nonnegative().nullable().optional(),
  defaultRoundOff: z.boolean().default(true),
  defaultTermsAndConditions: z.string().max(2000).nullable().optional(),
  // Print settings (Settings → Documents → Invoice design). No defaults here:
  // the columns default to "classic" / 80 mm, and update must not reset them.
  invoiceTemplate: z.enum(INVOICE_TEMPLATES).optional(),
  thermalWidth: z.union([z.literal(58), z.literal(80)]).optional(),

  // Settings → Shipping: user-defined delivery methods shown in the invoice form.
  customShippingMethods: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        label: z.string().min(1).max(100),
        hasTracking: z.boolean(),
      }),
    )
    .max(50)
    .refine((methods) => new Set(methods.map((m) => m.id)).size === methods.length, {
      message: "Each delivery method needs its own id",
    })
    .refine((methods) => !methods.some((m) => isBuiltInDeliveryMethod(m.id)), {
      message: "A custom delivery method can't reuse a built-in method's id",
    })
    .nullable()
    .optional(),
});

export const updateBusinessSchema = createBusinessSchema.partial();

// Logo upload: data URL ≤ ~1.4MB base64 (≈ 1MB decoded), PNG or JPEG only.
// Server performs a second magic-byte check on decoded bytes — do NOT
// rely on the declared MIME for anything sensitive.
export const uploadBusinessLogoSchema = z.object({
  dataUrl: z.string()
    .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, "must be a base64 data URL for PNG or JPEG")
    .max(1_500_000, "logo too large (max ~1MB)"),
  width: z.number().int().positive().max(4000),
  height: z.number().int().positive().max(4000),
});

// Signature upload: same envelope as the logo (PNG/JPEG data URL, ~1MB
// decoded). Server re-checks magic bytes on the decoded bytes.
export const uploadBusinessSignatureSchema = uploadBusinessLogoSchema;

export const updateSequenceNumberSchema = z.object({
  documentType: z.enum(["invoice", "payment", "quotation", "credit_note", "delivery_challan", "proforma", "purchase_order", "sales_order", "goods_receipt_note"]),
  newNumber: z.number().int().min(1),
});

// ── Party ──────────────────────────────────────────────────────

export const itemTypes = ["product", "service"] as const;
export type ItemType = (typeof itemTypes)[number];

export const documentTypes = ["invoice", "quotation", "credit_note", "debit_note", "delivery_challan", "proforma", "sales_return", "purchase_return", "purchase_order", "sales_order", "goods_receipt_note"] as const;
export type DocumentType = (typeof documentTypes)[number];

export const bankAccountTypes = ["savings", "current", "cash", "upi", "credit_card", "payment_gateway"] as const;
export type BankAccountType = (typeof bankAccountTypes)[number];

export const bankTransactionTypes = ["deposit", "withdrawal", "transfer"] as const;
export type BankTransactionType = (typeof bankTransactionTypes)[number];

export const partyTypes = ["customer", "supplier"] as const;
export type PartyType = (typeof partyTypes)[number];

export { GSTIN_REGEX, PAN_REGEX, panFromGstin };

/** An extra delivery location for a party (beyond its main shipping address). */
export const partyShippingAddressSchema = z.object({
  label: z.string().max(100).optional(),
  address: z.string().min(1, "Address is required").max(500),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  stateCode: z.string().max(2).optional(),
  pincode: z.string().max(10).optional(),
});
export type PartyShippingAddress = z.infer<typeof partyShippingAddressSchema>;

/** A party can keep up to this many extra shipping addresses. */
export const MAX_ADDITIONAL_SHIPPING_ADDRESSES = 20;

const addressKey = (address: string) => address.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Shipping addresses for the party that survives a merge. The target keeps its
 * default address (or takes the source's when it has none); every other
 * address from both parties is kept as an extra one, without repeats.
 */
export function mergePartyShippingAddresses(
  target: { shippingAddress?: string | null; additionalShippingAddresses?: readonly PartyShippingAddress[] | null },
  source: { shippingAddress?: string | null; additionalShippingAddresses?: readonly PartyShippingAddress[] | null },
): { shippingAddress: string | null; additionalShippingAddresses: PartyShippingAddress[] | null } {
  const shippingAddress = target.shippingAddress?.trim() || source.shippingAddress?.trim() || null;
  const seen = new Set(shippingAddress ? [addressKey(shippingAddress)] : []);
  const extras: PartyShippingAddress[] = [];
  const candidates: PartyShippingAddress[] = [
    ...(target.additionalShippingAddresses ?? []),
    ...(source.shippingAddress?.trim() ? [{ address: source.shippingAddress.trim() }] : []),
    ...(source.additionalShippingAddresses ?? []),
  ];
  for (const entry of candidates) {
    const key = addressKey(entry.address ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    extras.push(entry);
  }
  const kept = extras.slice(0, MAX_ADDITIONAL_SHIPPING_ADDRESSES);
  return { shippingAddress, additionalShippingAddresses: kept.length ? kept : null };
}

// Fields shared by create and update.
const partyFields = {
  type: z.enum(partyTypes),
  name: z.string().min(1).max(200),
  phone: z.string().max(15).optional(),
  email: z.string().email().optional().or(z.literal("")),
  gstin: z.string().regex(GSTIN_REGEX).optional().or(z.literal("")),
  pan: z.string().regex(PAN_REGEX).optional().or(z.literal("")),
  billingAddress: z.string().max(500).optional(),
  shippingAddress: z.string().max(500).optional(),
  additionalShippingAddresses: z.array(partyShippingAddressSchema).max(MAX_ADDITIONAL_SHIPPING_ADDRESSES).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  stateCode: z.string().max(2).optional(),
  pincode: z.string().max(10).optional(),
  openingBalance: z.string().regex(/^-?\d{1,13}(\.\d{1,2})?$/).default("0"),
  category: z.string().max(100).optional(),
  creditPeriodDays: z.number().int().min(0).max(365).optional(),
  creditLimit: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).optional(),
  contactPersonName: z.string().max(200).optional(),
  contactPersonDob: z.string().datetime().optional(),
  bankAccountNumber: z.string().max(34).optional(),
  bankIfsc: z.string().regex(IFSC_REGEX, "Invalid IFSC (e.g. HDFC0001234)").optional().or(z.literal("")),
  bankName: z.string().max(200).optional(),
  legalName: z.string().max(200).optional(),
  tradeName: z.string().max(200).optional(),
  gstRegistrationType: z.enum(partyGstTypes).optional(),
  constitution: z.enum(partyConstitutions).optional(),
  gstinStatus: z.enum(gstinStatuses).optional(),
  gstinVerifiedAt: z.string().datetime().optional(),
  isMsme: z.boolean().optional(),
  // Customer asked not to be sent payment reminders.
  doNotRemind: z.boolean().optional(),
  udyamNumber: z.string().regex(UDYAM_REGEX, "Invalid Udyam number (e.g. UDYAM-MH-26-0012345)").optional().or(z.literal("")),
  msmeCategory: z.enum(msmeCategories).optional(),
  tdsSection: z.enum(tdsSectionCodes).optional(),
  // Price level sales to this party use; null = the business default.
  priceLevelId: z.string().uuid().nullable().optional(),
};

// A PAN or state that contradicts the GSTIN is only a warning
// (partyComplianceWarnings), so imports and hand-entered values still save.
export const createPartySchema = z.object(partyFields);

export const updatePartySchema = z.object(partyFields).partial().omit({ type: true });

// ── Item ───────────────────────────────────────────────────────

export const units = ["pcs", "kg", "g", "l", "ml", "m", "cm", "ft", "in", "box", "dozen", "pair", "set", "pkt", "bun", "pouch", "jar", "btl", "bag", "ton", "pack", "pet", "person", "other"] as const;
export type Unit = (typeof units)[number];

export const itemModes = ["simple", "alt_units", "variants"] as const;
export type ItemMode = (typeof itemModes)[number];

export const unitVariantSchema = z.object({
  unit: z.string().min(1).max(50),
  conversionFactor: z.number().positive(),
  salePrice: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/),
  purchasePrice: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).optional(),
});

export type UnitVariant = z.infer<typeof unitVariantSchema>;

export const decimalStr = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/);
export const decimalStr3 = z.string().regex(/^-?\d+(\.\d{1,3})?$/);

export const itemVariantSchema = z.object({
  attributeValues: z.record(z.string().min(1), z.string().min(1)),
  sku: z.string().max(50).optional(),
  // Scannable code. Printable ASCII only — Code 128 encodes exactly that
  // range, and it keeps stray whitespace from a scanner out of the value.
  barcode: z
    .string()
    .max(64)
    .regex(/^[ -~]*$/, "Barcode may only contain printable characters")
    .optional()
    .or(z.literal("")),

  salePrice: decimalStr.optional(),
  purchasePrice: decimalStr.optional(),
  // Printed MRP; "" clears it.
  mrp: decimalStr.optional().or(z.literal("")),
  stockQuantity: decimalStr3.default("0"),
  lowStockAlert: z.string().regex(/^\d+(\.\d{1,3})?$/).optional(),
});

export type ItemVariant = z.infer<typeof itemVariantSchema>;

/** A calendar date, YYYY-MM-DD. */
export const dateOnlyStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

/** Batch number, dates and MRP of one batch of an item that tracks batches. */
export const batchFieldsSchema = z.object({
  batchNumber: z.string().trim().min(1, "Enter a batch number").max(60),
  mfgDate: dateOnlyStr.nullish(),
  expiryDate: dateOnlyStr.nullish(),
  mrp: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).nullish(),
});

const createItemBaseSchema = z.object({
  name: z.string().min(1).max(200),
  hsn: z.string().max(20).optional(),
  // TCS section (s.206C) for specified goods such as scrap; null clears it.
  tcsSection: z.enum(tcsSectionCodes).nullable().optional(),
  sku: z.string().max(50).optional(),
  // Scannable code. Printable ASCII only — Code 128 encodes exactly that
  // range, and it keeps stray whitespace from a scanner out of the value.
  barcode: z
    .string()
    .max(64)
    .regex(/^[ -~]*$/, "Barcode may only contain printable characters")
    .optional()
    .or(z.literal("")),
  unit: z.enum(units).default("pcs"),
  itemMode: z.enum(itemModes).default("simple"),
  salePrice: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).optional(),
  purchasePrice: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).optional(),
  // Printed MRP (maximum retail price); null clears it. A sale price above it
  // is only a warning (see mrpWarning).
  mrp: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).nullable().optional(),
  taxPercent: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
  stockQuantity: z.string().regex(/^-?\d+(\.\d{1,3})?$/).default("0"),
  lowStockAlert: z.string().regex(/^\d+(\.\d{1,3})?$/).optional(),
  description: z.string().max(1000).optional(),
  itemType: z.enum(itemTypes).default("product"),
  category: z.string().max(100).optional(),
  // Stock group. Takes precedence over `category`, which then mirrors the
  // group's name; null clears it.
  stockGroupId: z.string().uuid().nullish(),
  taxInclusive: z.boolean().default(false),
  // Batch / lot tracking (see item_batches). Off by default.
  trackBatches: z.boolean().optional(),
  trackExpiry: z.boolean().optional(),
  // Opening stock of a new batch-tracked item goes into this batch.
  openingBatch: batchFieldsSchema.optional(),
  unitVariants: z.array(unitVariantSchema).optional(),
  variantAttributes: z.array(z.string().min(1).max(50)).max(5).optional(),
  variants: z.array(itemVariantSchema).optional(),
});

export const createItemSchema = createItemBaseSchema.refine((d) => {
  if (d.itemMode === "variants" && d.unitVariants && d.unitVariants.length > 0) return false;
  if (d.itemMode === "alt_units" && d.variantAttributes && d.variantAttributes.length > 0) return false;
  if (d.itemMode === "alt_units" && d.variants && d.variants.length > 0) return false;
  return true;
}, { message: "An item cannot have both unit variants and product variants" });

export const updateItemSchema = createItemBaseSchema.partial();

/**
 * Warning text when a selling price is above the printed MRP (selling above
 * MRP is not allowed under the Legal Metrology rules), else null.
 */
export function mrpWarning(price: string | number | null | undefined, mrp: string | number | null | undefined): string | null {
  const p = parseFloat(String(price ?? ""));
  const m = parseFloat(String(mrp ?? ""));
  if (!Number.isFinite(p) || !Number.isFinite(m) || m <= 0) return null;
  return p > m + 0.0001 ? `Price ${p.toFixed(2)} is above the MRP ${m.toFixed(2)}` : null;
}

// ── Price levels ───────────────────────────────────────────────

export const priceSlabSchema = z.object({
  minQuantity: z.string().regex(/^\d{1,12}(\.\d{1,3})?$/).default("0"),
  price: decimalStr.nullable().optional(),
  discountPercent: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).refine((v) => parseFloat(v) <= 100, "Discount can't exceed 100%").nullable().optional(),
}).refine((s) => !!s.price || !!s.discountPercent, { message: "Give a price or a discount" });

export type PriceSlab = z.infer<typeof priceSlabSchema>;

// ── Invoice ────────────────────────────────────────────────────

export const invoiceTypes = ["sale", "purchase"] as const;
export const invoiceStatuses = ["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled", "adjusted"] as const;
export const deliveryMethods = ["self_pickup", "hand_delivery", "courier", "bus", "transport", "post"] as const;
export type DeliveryMethod = (typeof deliveryMethods)[number];

export function isBuiltInDeliveryMethod(method: string): method is DeliveryMethod {
  return (deliveryMethods as readonly string[]).includes(method);
}

/**
 * How the goods go out: a built-in method, or the id of one of the
 * business's own methods from Settings → Shipping. Only the shape is checked
 * here; the server checks custom ids against the business's list.
 */
export const deliveryMethodSchema = z.string().trim().min(1).max(100);

export const invoiceChargeSchema = z.object({
  label: z.string().min(1).max(100),
  amount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/),
  shipmentId: z.string().uuid().optional(),
});

/**
 * Batch fields on a document line, for items that track batches.
 * Inward lines name the batch by id, or by number (created if new, with its
 * dates and MRP). Outward lines name a batch, or leave it empty to have
 * stock taken first-expiry-first-out; an expired batch goes out only with
 * `allowExpired`.
 */
export const lineBatchFields = {
  batchId: z.string().uuid().nullish(),
  batchNumber: z.string().trim().max(60).nullish(),
  mfgDate: dateOnlyStr.nullish(),
  expiryDate: dateOnlyStr.nullish(),
  batchMrp: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).nullish(),
  allowExpired: z.boolean().nullish(),
};

const lineQuantityStr = z.string().regex(/^\d+(\.\d{1,3})?$/);

/**
 * Document types whose lines can carry free goods ("10 + 1"). Credit and
 * debit notes are money only.
 */
export const freeQuantityDocumentTypes = [
  "invoice", "quotation", "proforma", "delivery_challan", "sales_return", "purchase_return",
  "purchase_order", "sales_order", "goods_receipt_note",
] as const;

/** Reasons offered for goods rejected on receipt; any other text is allowed too. */
export const rejectionReasons = ["Damaged", "Short expiry", "Wrong item", "Quality not as ordered", "Excess supply"] as const;

const invoiceLineItemBaseSchema = z.object({
  itemId: z.string().uuid().optional(),
  // Snapshot of the item name at billing time. Required on every line — this
  // is the primary display text on invoices and must be frozen at create
  // time so future renames of the underlying item don't rewrite history.
  itemName: z.string().min(1).max(200),
  // Optional free-text line notes (e.g. "Keep separate from order #42").
  // Nullable because the DB column is nullable and the client may pass null
  // explicitly to clear notes. Empty string is coerced to null downstream.
  description: z.string().max(500).optional().nullable(),
  /**
   * Billed quantity: what the price, discount and tax apply to. On a goods
   * receipt note, the quantity accepted. May be 0 only when the line has free
   * or rejected goods.
   */
  quantity: lineQuantityStr,
  unitPrice: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/),
  taxPercent: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0").refine((v) => parseFloat(v) <= 56, { message: "Tax percent cannot exceed 56%" }),
  discountPercent: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0").refine((v) => parseFloat(v) <= 100, { message: "Discount cannot exceed 100%" }),
  selectedUnit: z.string().nullish(),
  conversionFactor: z.string().nullish(), // stored as string like all numerics
  variantId: z.string().uuid().nullish(),
  /** Free goods on top of the billed quantity ("10 + 1"), in the line's unit. Moves stock, adds no value. */
  freeQuantity: lineQuantityStr.nullish(),
  /** Goods receipt notes only: received but rejected, in the line's unit. Never enters stock. */
  rejectedQuantity: lineQuantityStr.nullish(),
  rejectionReason: z.string().max(200).nullish(),
  ...lineBatchFields,
});

export const invoiceLineItemSchema = invoiceLineItemBaseSchema.superRefine((li, ctx) => {
  const billed = parseFloat(li.quantity);
  const other = parseFloat(li.freeQuantity || "0") + parseFloat(li.rejectedQuantity || "0");
  if (!(billed > 0) && !(other > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "Quantity must be greater than 0" });
  }
});

export const createInvoiceSchema = z.object({
  partyId: z.string().uuid(),
  type: z.enum(invoiceTypes),
  documentType: z.enum(documentTypes).default("invoice"),
  invoiceDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
  /**
   * Purchase invoices: the supplier's own bill number, as it appears in the
   * supplier's GSTR-1 and so in our GSTR-2B. Ignored on sales.
   */
  supplierInvoiceNumber: z.string().trim().max(50).optional(),
  notes: z.string().max(2000).optional(),
  termsAndConditions: z.string().max(2000).optional(),
  additionalCharges: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
  charges: z.array(invoiceChargeSchema).optional(),
  invoiceDiscount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
  invoiceDiscountType: z.enum(["amount", "percent"]).default("amount"),
  roundOff: z.string().regex(/^-?\d{1,13}(\.\d{1,2})?$/).default("0"),
  referenceDocumentId: z.string().uuid().optional(),
  /** Warehouse the goods come into (purchase) or go out of (sale). Default warehouse when omitted. */
  warehouseId: z.string().uuid().nullish(),
  lineItems: z.array(invoiceLineItemSchema).min(1),
  /**
   * When true, skip stock adjustment on create. Used when converting a
   * delivery_challan → invoice to avoid double-decrementing stock (the
   * challan already decremented it).
   */
  skipStockAdjustment: z.boolean().optional(),
  isReverseCharge: z.boolean().default(false),
  deliveryMethod: deliveryMethodSchema.default("self_pickup"),
  /**
   * Origin channel for this invoice. "pos" for the fullscreen register,
   * "online_store" for storefront orders, "webhook" for public-API /
   * carrier-webhook triggered invoices. Null/undefined = manually created
   * from the invoice form. Used by reporting and the invoice list to
   * attribute a sale to its channel.
   */
  source: z.enum(["pos", "online_store", "webhook"]).optional(),
  /**
   * TDS we deduct on a purchase bill, worked out when it is credited:
   * auto (from the supplier's TDS section and the year's limits), none, or
   * manual (tdsSection + tdsAmount entered here).
   */
  tdsMode: z.enum(["auto", "none", "manual"]).default("auto"),
  tdsSection: z.enum(tdsSectionCodes).optional(),
  tdsAmount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).optional(),
  /** TCS (s.206C) on a sale: `auto` collects it on lines whose item has a TCS section; `none` collects none. */
  tcsMode: z.enum(["auto", "none"]).default("auto"),
});

export const updateInvoiceStatusSchema = z.object({
  status: z.enum(invoiceStatuses),
});

// ── Payment ────────────────────────────────────────────────────

export const paymentModes = ["cash", "bank", "upi", "cheque", "other", "credit_card", "debit_card", "net_banking", "wallet"] as const;

export const paymentAllocationSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).refine((v) => parseFloat(v) > 0, { message: "Amount must be greater than zero" }),
});

export const createPaymentSchema = z.object({
  invoiceId: z.string().uuid().optional(),
  partyId: z.string().uuid(),
  amount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).refine((v) => parseFloat(v) > 0, { message: "Amount must be greater than zero" }),
  discount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
  mode: z.enum(paymentModes),
  referenceNumber: z.string().max(100).optional(),
  paymentDate: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
  bankAccountId: z.string().uuid().optional(),
  // Multi-invoice allocation: allocate a single payment across multiple invoices
  allocations: z.array(paymentAllocationSchema).optional(),
  // Income tax withheld from `amount` (we deduct it from a supplier, or a
  // customer deducts it from us). The bank moves amount - tdsAmount.
  tdsAmount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
  tdsSection: z.enum(tdsSectionCodes).optional(),
  // Taxable value the TDS was worked out on, when it differs from the amount (e.g. excluding GST).
  tdsBase: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).optional(),
});

export const updatePaymentSchema = z.object({
  id: z.string().uuid(),
  amount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).refine((v) => parseFloat(v) > 0, { message: "Amount must be greater than zero" }).optional(),
  discount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).optional(),
  mode: z.enum(paymentModes).optional(),
  referenceNumber: z.string().max(100).optional().nullable(),
  paymentDate: z.string().datetime().optional(),
  notes: z.string().max(500).optional().nullable(),
  bankAccountId: z.string().uuid().optional().nullable(),
  // Replace all allocations (reverse old, apply new)
  allocations: z.array(paymentAllocationSchema).optional(),
  tdsAmount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).optional(),
  tdsSection: z.enum(tdsSectionCodes).optional().nullable(),
  tdsBase: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).optional().nullable(),
});

// ── Expense ────────────────────────────────────────────────────

export const createExpenseSchema = z.object({
  category: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  amount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).refine((v) => parseFloat(v) > 0, { message: "Amount must be greater than zero" }),
  mode: z.enum(paymentModes),
  expenseDate: z.string().datetime().optional(),
  referenceNumber: z.string().max(100).optional(),
  bankAccountId: z.string().uuid().optional(),
  /** Who was paid (landlord, consultant…). Required when TDS is deducted. */
  partyId: z.string().uuid().nullable().optional(),
  /**
   * TDS deducted from this payment: none (the default), auto (worked out from
   * the section, the payee's PAN and the year's limits) or manual
   * (tdsSection + tdsAmount entered here). The amount above is gross; the
   * bank moves amount - TDS.
   */
  tdsMode: z.enum(["none", "auto", "manual"]).optional(),
  tdsSection: z.enum(tdsSectionCodes).nullable().optional(),
  tdsAmount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).optional(),
});

// ── Payment Gateway Configs ───────────────────────────────────

export const gatewayChargeRateSchema = z.object({
  type: z.enum(["percentage", "flat"]),
  value: z.string().regex(/^\d+(\.\d{1,4})?$/),
});

export const gatewayChargeConfigSchema = z.object({
  credit_card: gatewayChargeRateSchema.optional(),
  debit_card: gatewayChargeRateSchema.optional(),
  upi: gatewayChargeRateSchema.optional(),
  net_banking: gatewayChargeRateSchema.optional(),
  wallet: gatewayChargeRateSchema.optional(),
  default: gatewayChargeRateSchema.optional(),
});

export const createPaymentGatewayConfigSchema = z.object({
  bankAccountId: z.string().uuid(),
  settlementAccountId: z.string().uuid(),
  chargeConfig: gatewayChargeConfigSchema,
  expenseCategory: z.string().min(1).max(100).default("Payment Gateway Charges"),
  autoSettle: z.boolean().default(true),
});

export const updatePaymentGatewayConfigSchema = createPaymentGatewayConfigSchema
  .partial()
  .omit({ bankAccountId: true });

// ── Bank Accounts ──────────────────────────────────────────────

export const createBankAccountSchema = z.object({
  accountName: z.string().min(1).max(200),
  accountNumber: z.string().max(34).optional(),
  ifsc: z.string().max(11).optional(),
  bankName: z.string().max(200).optional(),
  accountType: z.enum(bankAccountTypes).default("savings"),
  openingBalance: z.string().regex(/^-?\d{1,13}(\.\d{1,2})?$/).default("0"),
  isDefault: z.boolean().default(false),
});

export const updateBankAccountSchema = createBankAccountSchema.partial();

export const createBankTransactionSchema = z.object({
  bankAccountId: z.string().uuid(),
  type: z.enum(bankTransactionTypes),
  amount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).refine((v) => parseFloat(v) > 0, { message: "Amount must be greater than zero" }),
  description: z.string().max(500).optional(),
  referenceType: z.string().max(50).optional(),
  referenceId: z.string().uuid().optional(),
  transactionDate: z.string().datetime().optional(),
});

export const bankTransferSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).refine((v) => parseFloat(v) > 0, { message: "Amount must be greater than zero" }),
  description: z.string().max(500).optional(),
  transactionDate: z.string().datetime().optional(),
});

/**
 * Documents that track what is still pending against them: orders until they
 * are delivered or received, and challans/GRNs until they are billed.
 */
export const pendingTrackedDocumentTypes = ["sales_order", "purchase_order", "goods_receipt_note", "delivery_challan"] as const;
export type PendingTrackedDocumentType = (typeof pendingTrackedDocumentTypes)[number];

export const convertDocumentSchema = z.object({
  sourceDocumentId: z.string().uuid(),
  targetDocumentType: z.enum(documentTypes),
  /**
   * Quantities to take from the source, per source line, in the line's unit.
   * Only for sources that track pending quantities (orders, challans, GRNs).
   * Omitted, every line's pending quantity is taken; lines left out are not
   * converted.
   */
  lines: z.array(z.object({
    sourceLineId: z.string().uuid(),
    /** Billed quantity; on a GRN made from a purchase order, the quantity accepted. */
    quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
    /**
     * Free quantity to take, up to what is pending free. Omitted, all of the
     * pending free quantity goes along when the whole pending billed quantity
     * is taken, and none otherwise.
     */
    freeQuantity: z.string().regex(/^\d+(\.\d{1,3})?$/).optional(),
    /** Purchase order → GRN only: received but rejected. Stays pending on the order. */
    rejectedQuantity: z.string().regex(/^\d+(\.\d{1,3})?$/).optional(),
    rejectionReason: z.string().max(200).optional(),
    /**
     * Items that track batches, when the new document brings goods in (a GRN
     * or purchase invoice from a purchase order): the batch they arrive in,
     * matched by number or created with these dates.
     */
    batchNumber: z.string().trim().max(60).optional(),
    expiryDate: dateOnlyStr.optional(),
    mfgDate: dateOnlyStr.optional(),
  })).optional(),
  /**
   * Goods receipt note → purchase return or debit note: take the goods
   * rejected on receipt that have not been returned yet (or the quantities in
   * `lines`, up to that). The return moves no stock, since rejected goods
   * never came in.
   */
  fromRejected: z.boolean().optional(),
  /** Warehouse for the new document when it moves stock. Default warehouse when omitted. */
  warehouseId: z.string().uuid().nullish(),
});

export const pendingOrdersInputSchema = z.object({
  documentType: z.enum(pendingTrackedDocumentTypes),
  partyId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  /** Only lines whose due date has passed. */
  overdueOnly: z.boolean().default(false),
});

// ── Reports ────────────────────────────────────────────────────

export const daybookInputSchema = z.object({
  fromDate: z.string().date(),
  toDate: z.string().date(),
  typeFilter: z.enum(["all", "invoices", "payments", "expenses"]).default("all"),
});

export const outstandingInputSchema = z.object({
  type: z.enum(["receivable", "payable", "both"]).default("receivable"),
  asOfDate: z.string().datetime().optional(),
});

export const registerInputSchema = z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  partyId: z.string().uuid().optional(),
});

export const taxSummaryInputSchema = z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  type: z.enum(["sales", "purchases", "both"]).default("both"),
});

export const cashFlowForecastInputSchema = z.object({
  businessId: z.string().uuid().optional(),
});

export const collectionEfficiencyInputSchema = z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
});

export const itemSalesInputSchema = z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  category: z.string().optional(),
  itemType: z.enum(["product", "service"]).optional(),
  sortBy: z.enum(["revenue", "quantity", "invoices", "margin"]).default("revenue"),
  compareToPrevious: z.boolean().default(false),
});

export const stockSummaryInputSchema = z.object({
  category: z.string().optional(),
  // Limit to one stock group and the groups under it.
  stockGroupId: z.string().uuid().optional(),
  showZeroStock: z.boolean().default(false),
});

export const partyStatementInputSchema = z.object({
  partyId: z.string().uuid(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export const paymentSummaryInputSchema = z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  type: z.enum(["received", "made", "both"]).default("both"),
  bankAccountId: z.string().uuid().optional(),
});

// ── Recurring Invoices ────────────────────────────────────────

export const recurringFrequencies = ["weekly", "biweekly", "monthly", "quarterly", "half_yearly", "yearly", "custom"] as const;
export type RecurringFrequency = (typeof recurringFrequencies)[number];

export const recurringTemplateStatuses = ["active", "paused", "completed", "expired"] as const;
export type RecurringTemplateStatus = (typeof recurringTemplateStatuses)[number];

export const recurringLineItemSchema = z.object({
  itemId: z.string().uuid().optional(),
  // Mirrors invoiceLineItemSchema — itemName is the required snapshot and
  // description is the optional free-text notes field.
  itemName: z.string().min(1).max(200),
  description: z.string().max(500).optional().nullable(),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/).refine((v) => parseFloat(v) > 0, { message: "Quantity must be greater than 0" }),
  unitPrice: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/),
  taxPercent: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
  discountPercent: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
  selectedUnit: z.string().nullish(),
  conversionFactor: z.string().nullish(),
  variantId: z.string().uuid().nullish(),
});

export const createRecurringInvoiceSchema = z.object({
  partyId: z.string().uuid(),
  name: z.string().min(1).max(200),
  type: z.enum(invoiceTypes),
  frequency: z.enum(recurringFrequencies),
  customIntervalDays: z.number().int().min(1).max(365).optional(),
  lineItems: z.array(recurringLineItemSchema).min(1),
  notes: z.string().max(2000).optional(),
  termsAndConditions: z.string().max(2000).optional(),
  additionalCharges: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
  charges: z.array(invoiceChargeSchema).optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  maxRuns: z.number().int().min(1).optional(),
}).refine((d) => {
  if (d.frequency === "custom" && !d.customIntervalDays) return false;
  return true;
}, { message: "customIntervalDays is required when frequency is 'custom'", path: ["customIntervalDays"] });

export const updateRecurringInvoiceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  partyId: z.string().uuid().optional(),
  type: z.enum(invoiceTypes).optional(),
  frequency: z.enum(recurringFrequencies).optional(),
  customIntervalDays: z.number().int().min(1).max(365).optional(),
  lineItems: z.array(recurringLineItemSchema).min(1).optional(),
  notes: z.string().max(2000).optional(),
  termsAndConditions: z.string().max(2000).optional(),
  additionalCharges: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).optional(),
  charges: z.array(invoiceChargeSchema).optional(),
  endDate: z.string().datetime().optional(),
  maxRuns: z.number().int().min(1).optional().nullable(),
});

// ── Chart of Accounts ──────────────────────────────────────────

export const accountTypes = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof accountTypes)[number];

export const createAccountSchema = z.object({
  code: z.string().min(1).max(10),
  name: z.string().min(1).max(200),
  accountType: z.enum(accountTypes),
  parentId: z.string().uuid().optional(),
});

export const updateAccountSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
});

// ── Journal Entries ──────────────────────────────────────────

export const journalEntryLineSchema = z.object({
  accountId: z.string().uuid(),
  debit: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
  credit: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
  narration: z.string().max(500).optional(),
});

export const createJournalEntrySchema = z.object({
  entryDate: z.string().datetime(),
  narration: z.string().max(2000).optional(),
  lines: z.array(journalEntryLineSchema).min(2),
}).refine(data => {
  const totalDebit = data.lines.reduce((s, l) => s + parseFloat(l.debit), 0);
  const totalCredit = data.lines.reduce((s, l) => s + parseFloat(l.credit), 0);
  return Math.abs(totalDebit - totalCredit) < 0.01;
}, { message: "Journal entry must be balanced (total debits = total credits)" });

export const updateJournalEntrySchema = z.object({
  id: z.string().uuid(),
  entryDate: z.string().datetime().optional(),
  narration: z.string().max(2000).optional(),
  lines: z.array(journalEntryLineSchema).min(2).optional(),
}).refine(data => {
  if (!data.lines) return true;
  const totalDebit = data.lines.reduce((s, l) => s + parseFloat(l.debit), 0);
  const totalCredit = data.lines.reduce((s, l) => s + parseFloat(l.credit), 0);
  return Math.abs(totalDebit - totalCredit) < 0.01;
}, { message: "Journal entry must be balanced (total debits = total credits)" });

export const voidJournalEntrySchema = z.object({
  id: z.string().uuid(),
});

export const journalEntryTemplateLineSchema = z.object({
  accountId: z.string().uuid(),
  accountCode: z.string(),
  accountName: z.string(),
  debit: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
  credit: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
  narration: z.string().max(500).optional(),
});

export const createJournalEntryTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  narration: z.string().max(2000).optional(),
  lines: z.array(journalEntryTemplateLineSchema).min(2),
});

// ── ITC Tracking ──────────────────────────────────────────────

export const itcBlockReasons = [
  "motor_vehicle", "food_beverage", "personal", "membership",
  "travel_benefits", "works_contract", "construction", "telecom",
  "other",
] as const;

export const itcReversalReasons = [
  "section_16_4_180_days", "rule_42", "rule_43", "section_17_5",
  "invoice_cancelled", "other",
] as const;

export const markItcBlockedSchema = z.object({
  invoiceId: z.string().uuid(),
  blockReason: z.enum(itcBlockReasons),
  notes: z.string().max(500).optional(),
});

export const markItcEligibleSchema = z.object({
  invoiceId: z.string().uuid(),
});

export const recordItcUtilizationSchema = z.object({
  returnPeriod: z.string().regex(/^\d{4}-\d{2}$/), // "2026-04"
  cgstUtilized: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
  sgstUtilized: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
  igstUtilizedAgainstCgst: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
  igstUtilizedAgainstSgst: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
  igstUtilizedAgainstIgst: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).default("0"),
  notes: z.string().max(500).optional(),
});

// ── Bank Reconciliation ──────────────────────────────────────

export const bankReconColumnMappingSchema = z.object({
  date: z.number().int().min(0),
  narration: z.number().int().min(0),
  debit: z.number().int().min(0).optional(),
  credit: z.number().int().min(0).optional(),
  amount: z.number().int().min(0).optional(),
  type: z.number().int().min(0).optional(),
  reference: z.number().int().min(0).optional(),
  balance: z.number().int().min(0).optional(),
  dateFormat: z.string().default("DD/MM/YYYY"),
  skipRows: z.number().int().min(0).default(1),
  amountSignConvention: z.enum(["debit_positive", "credit_positive"]).optional(),
});

export const confirmBankMappingSchema = z.object({
  importId: z.string().uuid(),
  columnMapping: bankReconColumnMappingSchema,
});

export const bankCategorizationRuleSchema = z.object({
  bankAccountId: z.string().uuid().optional(),
  matchField: z.enum(["narration", "reference"]),
  matchType: z.enum(["contains", "starts_with", "exact", "regex"]),
  matchValue: z.string().min(1).max(500),
  action: z.enum(["create_expense", "ignore", "tag_party"]),
  expenseCategory: z.string().max(100).optional(),
  partyId: z.string().uuid().optional(),
  priority: z.number().int().min(0).default(0),
});

// ── E-Invoicing ──────────────────────────────────────────────

export const eInvoiceConfigSchema = z.object({
  gstin: z.string().length(15),
  // GSP client credentials are deployment-level; when omitted the server falls
  // back to its configured environment values.
  clientId: z.string().max(200).optional().or(z.literal("")),
  clientSecret: z.string().max(500).optional().or(z.literal("")),
  username: z.string().min(1).max(100),
  // Blank on a re-save keeps the stored password (the settings form never
  // shows it back); a first save must include it.
  password: z.string().max(200).optional().or(z.literal("")),
  isSandbox: z.boolean().default(true),
  isEnabled: z.boolean().default(false),
  thresholdCrore: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).default("5"),
});

export const eInvoiceCancelReasons = ["1", "2", "3", "4"] as const; // 1=Duplicate, 2=Data entry mistake, 3=Order cancelled, 4=Others

export const cancelEInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  cancelReason: z.enum(eInvoiceCancelReasons),
  cancelRemarks: z.string().max(100).optional(),
});

// ── E-Way Bill ───────────────────────────────────────────────

export const generateEwayBillSchema = z.object({
  invoiceId: z.string().uuid(),
  transporterId: z.string().max(15).optional(),
  transporterName: z.string().max(200).optional(),
  vehicleNumber: z.string().max(20),
  vehicleType: z.enum(["regular", "over_dimensional"]).default("regular"),
  transportMode: z.enum(["road", "rail", "air", "ship"]).default("road"),
  distance: z.number().int().min(1).max(4000),
  fromAddress: z.string().max(500).optional(),
  fromPincode: z.string().length(6).optional(),
  toAddress: z.string().max(500).optional(),
  toPincode: z.string().length(6).optional(),
});

export const cancelEwayBillSchema = z.object({
  ewayBillId: z.string().uuid(),
  cancelReason: z.string().max(250),
});

export const updateEwbVehicleSchema = z.object({
  ewayBillId: z.string().uuid(),
  vehicleNumber: z.string().max(20),
  fromPlace: z.string().max(200).optional(),
  reason: z.enum(["breakdown", "transshipment", "first_time", "others"]).default("others"),
});

// ── HSN Search ────────────────────────────────────────────────

export const hsnSearchSchema = z.object({
  query: z.string().min(1).max(50),
  type: z.enum(["goods", "services"]).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

// ── GSTR-2B Reconciliation ────────────────────────────────────

export const gstr2bUploadSchema = z.object({
  returnPeriod: z.string().regex(/^\d{4}-\d{2}$/),
  content: z.string().min(1).max(50_000_000),
  fileName: z.string().min(1).max(255),
  format: z.enum(["json", "csv"]),
});

export const gstr2bRecordsInputSchema = z.object({
  uploadId: z.string().uuid(),
  matchStatus: z.enum(["matched", "mismatched", "missing_in_books", "pending", "ignored"]).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
});

export const gstr2bSummaryInputSchema = z.object({
  returnPeriod: z.string().regex(/^\d{4}-\d{2}$/),
});

export const gstr2bLinkInvoiceSchema = z.object({
  recordId: z.string().uuid(),
  invoiceId: z.string().uuid(),
});

export const gstr2bIgnoreRecordSchema = z.object({
  recordId: z.string().uuid(),
});

// ── API Keys ───────────────────────────────────────────────────

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().optional(),
});

export const revokeApiKeySchema = z.object({
  id: z.string().uuid(),
});

// ── Dashboard ──────────────────────────────────────────────────

export type DashboardSummary = {
  totalSales: string;
  totalPurchases: string;
  totalExpenses: string;
  receivable: string;
  payable: string;
  cashInHand: string;
  recentInvoices: Array<{
    id: string;
    invoiceNumber: string;
    partyName: string;
    totalAmount: string;
    status: string;
    invoiceDate: string;
  }>;
};

// ── System ────────────────────────────────────────────────────

export const maintenanceStatusSchema = z.object({
  enabled: z.boolean(),
  message: z.string(),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
});

export type MaintenanceStatus = z.infer<typeof maintenanceStatusSchema>;
