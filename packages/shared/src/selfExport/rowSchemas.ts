import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

const uuid = z.string().uuid();
const uuidNullable = z.string().uuid().nullable();
// Validate ISO-8601 datetime string and transform to Date object.
// The transform is required because Drizzle's PgTimestamp.mapToDriverValue
// calls value.toISOString() — it expects a Date, not a string.
const isoDatetime = z.string().datetime().transform((s) => new Date(s));
const isoDatetimeNullable = z
  .string()
  .datetime()
  .transform((s) => new Date(s))
  .nullable();

/** NUMERIC(15,2) — up to 2 decimal places. */
const money2 = z.string().regex(/^-?\d+(\.\d{1,2})?$/);
const money2Nullable = money2.nullable();

/** NUMERIC(15,3) — up to 3 decimal places (quantities, stock). */
const money3 = z.string().regex(/^-?\d+(\.\d{1,3})?$/);
const money3Nullable = money3.nullable();

/** NUMERIC(5,2) — percentage fields (taxPercent, discountPercent). */
const pct52 = z.string().regex(/^-?\d+(\.\d{1,2})?$/);

/** NUMERIC(10,4) — conversion factor. */
const factor104 = z.string().regex(/^-?\d+(\.\d{1,4})?$/);
const factor104Nullable = factor104.nullable();

/** NUMERIC(3,2) — match confidence (0.00–1.00). */
const conf32 = z.string().regex(/^-?\d+(\.\d{1,2})?$/).nullable();

/** NUMERIC(5,2) — threshold fields. */
const thresh52 = z.string().regex(/^-?\d+(\.\d{1,2})?$/);

/**
 * bytea envelope: bytes-in-JSON via `{ __type: "bytes", base64: "..." }`.
 * Transforms to a Node Buffer so Drizzle's pg driver binds it directly as
 * a bytea parameter on insert. `.nullable()` on the wrapper makes the
 * column optional while still running the transform when a value exists.
 */
const byteaEnvelope = z
  .object({ __type: z.literal("bytes"), base64: z.string() })
  .transform((v) => Buffer.from(v.base64, "base64"));
const byteaEnvelopeNullable = byteaEnvelope.nullable();

// ── Enum literals mirroring pgEnum definitions ────────────────────────────────

const partyType = z.enum(["customer", "supplier"]);
const invoiceType = z.enum(["sale", "purchase"]);
const invoiceStatus = z.enum(["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled", "adjusted"]);
const paymentMode = z.enum(["cash", "bank", "upi", "cheque", "other", "credit_card", "debit_card", "net_banking", "wallet"]);
const unit = z.enum(["pcs", "kg", "g", "l", "ml", "m", "cm", "ft", "in", "box", "dozen", "pair", "set", "pkt", "bun", "pouch", "jar", "btl", "bag", "ton", "pack", "pet", "person", "other"]);
const itemType = z.enum(["product", "service"]);
const itemMode = z.enum(["simple", "alt_units", "variants"]);
const documentType = z.enum(["invoice", "quotation", "credit_note", "debit_note", "delivery_challan", "proforma", "sales_return", "purchase_return", "purchase_order", "sales_order", "goods_receipt_note"]);
const bankAccountType = z.enum(["savings", "current", "cash", "upi", "credit_card", "payment_gateway"]);
const bankTransactionType = z.enum(["deposit", "withdrawal", "transfer"]);
const gstRegistrationType = z.enum(["regular", "composition", "unregistered"]);
const recurringFrequency = z.enum(["weekly", "biweekly", "monthly", "quarterly", "half_yearly", "yearly", "custom"]);
const recurringTemplateStatus = z.enum(["active", "paused", "completed", "expired"]);
const recurringRunStatus = z.enum(["success", "failed", "skipped_limit"]);
const accountType = z.enum(["asset", "liability", "equity", "income", "expense"]);
const shipmentStatus = z.enum(["pending", "shipped", "in_transit", "delivered", "returned"]);
const storeOrderStatus = z.enum(["pending", "confirmed", "preparing", "ready", "delivered", "cancelled"]);
const bankStatementImportStatus = z.enum(["pending", "mapped", "processing", "review", "completed"]);
const bankStatementMatchStatus = z.enum(["auto_matched", "manual_matched", "unmatched", "created", "ignored"]);
const itcStatus = z.enum(["available", "utilized", "reversed", "reclaimed", "blocked"]);
const ewayBillStatus = z.enum(["generated", "active", "cancelled", "expired"]);

// ── Row schemas ───────────────────────────────────────────────────────────────

export const businessRowSchema = z.object({
  id: uuid,
  createdByUserId: uuid,
  name: z.string(),
  legalName: z.string().nullable(),
  gstRegistrationType: gstRegistrationType,
  gstin: z.string().nullable(),
  pan: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  stateCode: z.string().nullable(),
  pincode: z.string().nullable(),
  logoUrl: z.string().nullable(),
  // Logo bytes round-trip through the bytea envelope. Missing on imports
  // from older exports (pre-logo-support) — `.nullable()` + `.optional()`
  // keeps backwards compatibility.
  logoData: byteaEnvelopeNullable.optional(),
  logoMimeType: z.string().nullable().optional(),
  logoWidth: z.number().int().nullable().optional(),
  logoHeight: z.number().int().nullable().optional(),
  logoUpdatedAt: isoDatetimeNullable.optional(),
  invoicePrefix: z.string(),
  nextInvoiceNumber: z.number().int(),
  paymentPrefix: z.string(),
  nextPaymentNumber: z.number().int(),
  quotationPrefix: z.string(),
  nextQuotationNumber: z.number().int(),
  creditNotePrefix: z.string(),
  nextCreditNoteNumber: z.number().int(),
  debitNotePrefix: z.string(),
  nextDebitNoteNumber: z.number().int(),
  salesReturnPrefix: z.string(),
  nextSalesReturnNumber: z.number().int(),
  purchaseReturnPrefix: z.string(),
  nextPurchaseReturnNumber: z.number().int(),
  deliveryChallanPrefix: z.string(),
  nextDeliveryChallanNumber: z.number().int(),
  // Added with purchase/sales orders and GRNs; older exports lack them.
  purchaseOrderPrefix: z.string().optional(),
  nextPurchaseOrderNumber: z.number().int().optional(),
  salesOrderPrefix: z.string().optional(),
  nextSalesOrderNumber: z.number().int().optional(),
  goodsReceiptNotePrefix: z.string().optional(),
  nextGoodsReceiptNoteNumber: z.number().int().optional(),
  proformaPrefix: z.string(),
  nextProformaNumber: z.number().int(),
  financialYearStart: z.number().int(),
  currency: z.string(),
  annualTurnover: money2Nullable,
  storeEnabled: z.boolean(),
  storeSlug: z.string().nullable(),
  storeTagline: z.string().nullable(),
  storeAccentColor: z.string().nullable(),
  storeMinOrderAmount: money2Nullable,
  storeDeliveryNote: z.string().nullable(),
  storeWhatsappNumber: z.string().nullable(),
  storeAllowNegativeStock: z.boolean(),
  customShippingMethods: z.unknown().nullable(),
  // carrierCredentials is redacted — exported as null
  carrierCredentials: z.null(),
  nextStoreOrderNumber: z.number().int(),
  storeOrderPrefix: z.string(),
  // Added with the store policy pages; older exports lack them.
  storeReturnWindowDays: z.number().int().optional(),
  storePolicies: z.unknown().nullable().optional(),
  // Added with payment reminders; older exports lack it.
  paymentReminderSettings: z.unknown().nullable().optional(),
  // Added with online payments at store checkout; older exports lack them.
  storeOnlinePaymentsEnabled: z.boolean().optional(),
  storeCodEnabled: z.boolean().optional(),
  // Added with the store delivery charge; older exports lack them.
  storeDeliveryFee: money2.optional(),
  storeFreeDeliveryAbove: money2Nullable.optional(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const chartOfAccountsRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  code: z.string(),
  name: z.string(),
  accountType: accountType,
  parentId: uuidNullable,
  isSystem: z.boolean(),
  isActive: z.boolean(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const partyRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  type: partyType,
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  gstin: z.string().nullable(),
  pan: z.string().nullable(),
  billingAddress: z.string().nullable(),
  shippingAddress: z.string().nullable(),
  // Optional so backups made before extra shipping addresses still import.
  additionalShippingAddresses: z
    .array(z.object({
      label: z.string().optional(),
      address: z.string(),
      city: z.string().optional(),
      state: z.string().optional(),
      stateCode: z.string().optional(),
      pincode: z.string().optional(),
    }))
    .nullable()
    .optional(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  stateCode: z.string().nullable(),
  pincode: z.string().nullable(),
  openingBalance: money2,
  category: z.string().nullable(),
  creditPeriodDays: z.number().int().nullable(),
  creditLimit: money2Nullable,
  contactPersonName: z.string().nullable(),
  contactPersonDob: isoDatetimeNullable,
  bankAccountNumber: z.string().nullable(),
  bankIfsc: z.string().nullable(),
  bankName: z.string().nullable(),
  // Optional so backups made before these were exported still import.
  constitution: z.string().nullable().optional(),
  tdsSection: z.string().nullable().optional(),
  // Added with payment reminders; older backups lack it.
  doNotRemind: z.boolean().optional(),
  source: z.string().nullable(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const bankAccountRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  accountName: z.string(),
  accountNumber: z.string().nullable(),
  ifsc: z.string().nullable(),
  bankName: z.string().nullable(),
  accountType: bankAccountType,
  openingBalance: money2,
  currentBalance: money2,
  isDefault: z.boolean(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const bankStatementTemplateRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  bankSlug: z.string(),
  bankDisplayName: z.string(),
  version: z.number().int(),
  label: z.string().nullable(),
  isSeeded: z.boolean(),
  forkedFromId: uuidNullable,
  columnMapping: z.unknown(),
  preprocessRules: z.unknown().nullable(),
  detectionRules: z.unknown().nullable(),
  fileFormat: z.string(),
  isActive: z.boolean(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const paymentGatewayConfigRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  bankAccountId: uuid,
  settlementAccountId: uuid,
  chargeConfig: z.unknown(),
  expenseCategory: z.string(),
  autoSettle: z.boolean(),
  isActive: z.boolean(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const eInvoiceConfigRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  gstin: z.string(),
  clientId: z.string(),
  // Redacted — exported as null
  clientSecret: z.null(),
  username: z.string(),
  // Redacted — exported as null
  password: z.null(),
  // Redacted — exported as null
  authToken: z.null(),
  tokenExpiresAt: isoDatetimeNullable,
  isSandbox: z.boolean(),
  isEnabled: z.boolean(),
  thresholdCrore: thresh52,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const stockGroupRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  name: z.string(),
  parentId: uuidNullable,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const itemRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  name: z.string(),
  hsn: z.string().nullable(),
  // TCS section for specified goods. Optional so older backups still import.
  tcsSection: z.string().nullable().optional(),
  sku: z.string().nullable(),
  unit: unit,
  itemMode: itemMode,
  unitVariants: z.unknown().nullable(),
  variantAttributes: z.unknown().nullable(),
  salePrice: money2Nullable,
  purchasePrice: money2Nullable,
  taxPercent: pct52,
  stockQuantity: money3,
  lowStockAlert: money3Nullable,
  description: z.string().nullable(),
  itemType: itemType,
  category: z.string().nullable(),
  // Absent in archives exported before stock groups existed.
  stockGroupId: uuidNullable.optional(),
  taxInclusive: z.boolean(),
  // Absent in archives exported before batch tracking existed.
  trackBatches: z.boolean().optional(),
  trackExpiry: z.boolean().optional(),
  source: z.string().nullable(),
  storeEnabled: z.boolean(),
  storePrice: money2Nullable,
  storeSortOrder: z.number().int(),
  storeCategory: z.string().nullable(),
  storeDescription: z.string().nullable(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
  deletedAt: isoDatetimeNullable,
});

export const itemVariantRowSchema = z.object({
  id: uuid,
  itemId: uuid,
  attributeValues: z.unknown(),
  sku: z.string().nullable(),
  salePrice: money2Nullable,
  purchasePrice: money2Nullable,
  stockQuantity: money3,
  lowStockAlert: money3Nullable,
  storeEnabled: z.boolean(),
  storePrice: money2Nullable,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
  deletedAt: isoDatetimeNullable,
});

export const itemBatchRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  itemId: uuid,
  variantId: uuidNullable,
  batchNumber: z.string(),
  mfgDate: z.string().nullable(),
  expiryDate: z.string().nullable(),
  mrp: money2Nullable,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const salesTargetRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  userId: uuid,
  targetType: z.string(),
  targetValue: money2,
  itemId: uuidNullable,
  periodType: z.string(),
  periodStart: isoDatetime,
  periodEnd: isoDatetime,
  notes: z.string().nullable(),
  createdByUserId: uuidNullable,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const invoiceRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  partyId: uuid,
  type: invoiceType,
  status: invoiceStatus,
  documentType: documentType,
  invoiceNumber: z.string(),
  invoiceDate: isoDatetime,
  dueDate: isoDatetimeNullable,
  subtotal: money2,
  taxAmount: money2,
  discountAmount: money2,
  charges: z.unknown().nullable(),
  additionalCharges: money2,
  roundOff: money2,
  totalAmount: money2,
  amountPaid: money2,
  notes: z.string().nullable(),
  termsAndConditions: z.string().nullable(),
  referenceDocumentId: uuidNullable,
  createdByUserId: uuidNullable,
  createdByName: z.string().nullable(),
  deliveryMethod: z.string().nullable(),
  isReverseCharge: z.boolean(),
  // TDS on a purchase bill. Optional so backups made before TDS still import.
  tdsMode: z.enum(["auto", "none", "manual"]).optional(),
  tdsSection: z.string().nullable().optional(),
  tdsAmount: money2.optional(),
  // TCS collected on a sale (included in totalAmount). Optional so older backups still import.
  tcsMode: z.enum(["auto", "none"]).optional(),
  tcsAmount: money2.optional(),
  source: z.string().nullable(),
  irn: z.string().nullable(),
  irnAckNumber: z.string().nullable(),
  irnAckDate: isoDatetimeNullable,
  signedQrCode: z.string().nullable(),
  signedInvoice: z.unknown().nullable(),
  eInvoiceStatus: z.string().nullable(),
  eInvoiceError: z.string().nullable(),
  eInvoiceRetryCount: z.number().int().nullable(),
  eInvoiceCancelReason: z.string().nullable(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
  deletedAt: isoDatetimeNullable,
});

export const invoiceItemRowSchema = z.object({
  id: uuid,
  invoiceId: uuid,
  itemId: uuidNullable,
  itemName: z.string(),
  description: z.string().nullable(),
  quantity: money3,
  unitPrice: money2,
  taxPercent: pct52,
  taxAmount: money2,
  discountPercent: pct52,
  totalAmount: money2,
  sortOrder: z.number().int(),
  selectedUnit: z.string().nullable(),
  conversionFactor: factor104Nullable,
  variantId: uuidNullable,
  // Added with free quantities and GRN rejections; archives from before
  // them have neither.
  freeQuantity: money3.default("0"),
  rejectedQuantity: money3.default("0"),
  rejectionReason: z.string().nullable().default(null),
  // Absent in archives exported before batch tracking existed.
  batchId: uuidNullable.optional(),
});

export const paymentRowSchema = z.object({
  id: uuid,
  paymentNumber: z.string().nullable(),
  businessId: uuid,
  invoiceId: uuidNullable,
  partyId: uuid,
  amount: money2,
  discount: money2,
  // Tax withheld from the payment. Optional so backups made before TDS still import.
  tdsAmount: money2.optional(),
  tdsSection: z.string().nullable().optional(),
  mode: paymentMode,
  referenceNumber: z.string().nullable(),
  paymentDate: isoDatetime,
  notes: z.string().nullable(),
  bankAccountId: uuidNullable,
  createdByUserId: uuidNullable,
  createdByName: z.string().nullable(),
  source: z.string().nullable(),
  createdAt: isoDatetime,
  deletedAt: isoDatetimeNullable,
});

export const paymentAllocationRowSchema = z.object({
  id: uuid,
  paymentId: uuid,
  invoiceId: uuid,
  amount: money2,
  createdAt: isoDatetime,
});

export const bankTransactionRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  bankAccountId: uuid,
  type: bankTransactionType,
  amount: money2,
  description: z.string().nullable(),
  referenceType: z.string().nullable(),
  referenceId: uuidNullable,
  paymentId: uuidNullable,
  transactionDate: isoDatetime,
  createdAt: isoDatetime,
});

export const expenseRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  category: z.string(),
  description: z.string().nullable(),
  amount: money2,
  mode: paymentMode,
  expenseDate: isoDatetime,
  referenceNumber: z.string().nullable(),
  bankAccountId: uuidNullable,
  // TDS on an expense. Optional so backups made before it still import.
  partyId: uuidNullable.optional(),
  tdsMode: z.enum(["none", "auto", "manual"]).optional(),
  tdsSection: z.string().nullable().optional(),
  tdsAmount: money2.optional(),
  createdByUserId: uuidNullable,
  createdByName: z.string().nullable(),
  createdAt: isoDatetime,
  deletedAt: isoDatetimeNullable,
});

export const stockAdjustmentRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  itemId: uuid,
  variantId: uuidNullable,
  quantity: money3,
  previousStock: money3,
  newStock: money3,
  reason: z.string().nullable(),
  adjustmentDate: isoDatetime,
  createdByUserId: uuidNullable,
  createdByName: z.string().nullable(),
  createdAt: isoDatetime,
});

export const journalEntryTemplateRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  name: z.string(),
  narration: z.string().nullable(),
  lines: z.unknown(),
  createdByUserId: uuidNullable,
  createdAt: isoDatetime,
});

export const journalEntryRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  entryNumber: z.string(),
  entryDate: isoDatetime,
  narration: z.string().nullable(),
  source: z.string(),
  isVoided: z.boolean(),
  voidedByEntryId: uuidNullable,
  reversesEntryId: uuidNullable,
  createdByUserId: uuidNullable,
  createdByName: z.string().nullable(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const journalEntryLineRowSchema = z.object({
  id: uuid,
  journalEntryId: uuid,
  accountId: uuid,
  debit: money2,
  credit: money2,
  narration: z.string().nullable(),
});

export const itcLedgerEntryRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  invoiceId: uuidNullable,
  returnPeriod: z.string(),
  status: itcStatus,
  cgst: money2,
  sgst: money2,
  igst: money2,
  cess: money2,
  isReverseCharge: z.boolean(),
  blockReason: z.string().nullable(),
  reversalReason: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const itcUtilizationRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  returnPeriod: z.string(),
  cgstUtilized: money2,
  sgstUtilized: money2,
  igstUtilizedAgainstCgst: money2,
  igstUtilizedAgainstSgst: money2,
  igstUtilizedAgainstIgst: money2,
  notes: z.string().nullable(),
  createdByUserId: uuidNullable,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const recurringInvoiceTemplateRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  partyId: uuid,
  name: z.string(),
  type: invoiceType,
  frequency: recurringFrequency,
  customIntervalDays: z.number().int().nullable(),
  lineItems: z.unknown(),
  notes: z.string().nullable(),
  termsAndConditions: z.string().nullable(),
  additionalCharges: money2,
  charges: z.unknown().nullable(),
  status: recurringTemplateStatus,
  startDate: isoDatetime,
  endDate: isoDatetimeNullable,
  nextRunDate: isoDatetime,
  lastRunDate: isoDatetimeNullable,
  totalRuns: z.number().int(),
  maxRuns: z.number().int().nullable(),
  createdByUserId: uuidNullable,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const recurringInvoiceRunRowSchema = z.object({
  id: uuid,
  templateId: uuid,
  businessId: uuid,
  invoiceId: uuidNullable,
  status: recurringRunStatus,
  errorMessage: z.string().nullable(),
  executedAt: isoDatetime,
});

export const bankStatementImportRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  bankAccountId: uuid,
  fileName: z.string(),
  status: bankStatementImportStatus,
  templateId: uuidNullable,
  templateVersion: z.number().int().nullable(),
  columnMapping: z.unknown().nullable(),
  totalLines: z.number().int(),
  matchedLines: z.number().int(),
  unmatchedLines: z.number().int(),
  statementStartDate: isoDatetimeNullable,
  statementEndDate: isoDatetimeNullable,
  closingBalance: money2Nullable,
  createdByUserId: uuidNullable,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const bankStatementLineRowSchema = z.object({
  id: uuid,
  importId: uuid,
  businessId: uuid,
  lineNumber: z.number().int(),
  transactionDate: isoDatetime,
  narration: z.string().nullable(),
  debit: money2,
  credit: money2,
  balance: money2Nullable,
  referenceNumber: z.string().nullable(),
  rawData: z.unknown().nullable(),
  matchStatus: bankStatementMatchStatus,
  matchConfidence: conf32,
  matchedPaymentId: uuidNullable,
  matchedExpenseId: uuidNullable,
  matchedBankTransactionId: uuidNullable,
  autoCategory: z.string().nullable(),
  createdAt: isoDatetime,
});

export const bankCategorizationRuleRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  bankAccountId: uuidNullable,
  matchField: z.string(),
  matchType: z.string(),
  matchValue: z.string(),
  action: z.string(),
  expenseCategory: z.string().nullable(),
  partyId: uuidNullable,
  priority: z.number().int(),
  isActive: z.boolean(),
  hitCount: z.number().int(),
  createdAt: isoDatetime,
});

export const shipmentRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  invoiceId: uuidNullable,
  partyId: uuidNullable,
  carrier: z.string().nullable(),
  mode: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  trackingUrl: z.string().nullable(),
  cost: money2,
  weight: money3Nullable,
  shippingAddress: z.string().nullable(),
  shippingCity: z.string().nullable(),
  shippingPincode: z.string().nullable(),
  carrierOrderId: z.string().nullable(),
  labelUrl: z.string().nullable(),
  manifestId: z.string().nullable(),
  carrierMeta: z.unknown().nullable(),
  status: shipmentStatus,
  shipmentDate: isoDatetimeNullable,
  estimatedDelivery: isoDatetimeNullable,
  actualDelivery: isoDatetimeNullable,
  notes: z.string().nullable(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const shipmentEventRowSchema = z.object({
  id: uuid,
  shipmentId: uuid,
  status: z.string(),
  statusDetail: z.string().nullable(),
  location: z.string().nullable(),
  source: z.string().nullable(),
  carrierStatus: z.string().nullable(),
  eventTime: isoDatetime,
  createdAt: isoDatetime,
});

export const storeOrderRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  invoiceId: uuidNullable,
  orderNumber: z.string(),
  status: storeOrderStatus,
  customerName: z.string(),
  customerPhone: z.string(),
  customerEmail: z.string().nullable(),
  deliveryAddress: z.string().nullable(),
  deliveryCity: z.string().nullable(),
  deliveryPincode: z.string().nullable(),
  deliveryNotes: z.string().nullable(),
  totalAmount: money2,
  itemCount: z.number().int(),
  source: z.string(),
  confirmedAt: isoDatetimeNullable,
  cancelledAt: isoDatetimeNullable,
  cancellationReason: z.string().nullable(),
  // Added with online payments at store checkout; older exports lack them.
  paymentMethod: z.string().optional(),
  paymentStatus: z.string().optional(),
  paidAt: isoDatetimeNullable.optional(),
  refundedAmount: money2.optional(),
  paymentFailedEmailedAt: isoDatetimeNullable.optional(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const storeOrderRefundRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  storeOrderId: uuid,
  razorpayPaymentId: z.string(),
  razorpayRefundId: z.string().nullable(),
  amountPaise: z.number().int(),
  idempotencyKey: z.string(),
  status: z.string(),
  reason: z.string().nullable(),
  creditNoteId: uuidNullable,
  createdByUserId: uuidNullable,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const ewayBillRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  invoiceId: uuidNullable,
  ewbNumber: z.string().nullable(),
  ewbDate: isoDatetimeNullable,
  validUpto: isoDatetimeNullable,
  status: ewayBillStatus,
  transporterId: z.string().nullable(),
  transporterName: z.string().nullable(),
  vehicleNumber: z.string().nullable(),
  vehicleType: z.string().nullable(),
  transportMode: z.string().nullable(),
  distance: z.number().int().nullable(),
  fromAddress: z.string().nullable(),
  fromPincode: z.string().nullable(),
  fromState: z.string().nullable(),
  toAddress: z.string().nullable(),
  toPincode: z.string().nullable(),
  toState: z.string().nullable(),
  cancelReason: z.string().nullable(),
  apiResponse: z.unknown().nullable(),
  createdByUserId: uuidNullable,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const ewayBillVehicleUpdateRowSchema = z.object({
  id: uuid,
  ewayBillId: uuid,
  vehicleNumber: z.string(),
  fromPlace: z.string().nullable(),
  reason: z.string().nullable(),
  updatedAt: isoDatetime,
});

export const auditLogRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  userId: uuid,
  action: z.string(),
  entityType: z.string(),
  entityId: uuidNullable,
  metadata: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: isoDatetime,
});

export const gstr2bUploadRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  returnPeriod: z.string(),
  fileName: z.string(),
  uploadedAt: isoDatetime,
  totalRecords: z.number().int(),
  matchedRecords: z.number().int(),
  unmatchedRecords: z.number().int(),
  newRecords: z.number().int(),
  createdByUserId: uuidNullable,
});

export const gstr2bRecordRowSchema = z.object({
  id: uuid,
  uploadId: uuid,
  businessId: uuid,
  supplierGstin: z.string(),
  supplierName: z.string().nullable(),
  invoiceNumber: z.string(),
  invoiceDate: isoDatetimeNullable,
  invoiceValue: money2,
  taxableValue: money2,
  cgst: money2,
  sgst: money2,
  igst: money2,
  cess: money2,
  itcAvailable: z.string().nullable(),
  reason: z.string().nullable(),
  sourceType: z.string().nullable(),
  matchStatus: z.string(),
  matchedInvoiceId: uuidNullable,
  mismatchReasons: z.unknown().nullable(),
  createdAt: isoDatetime,
});

// ── Income-tax TDS ────────────────────────────────────────────────────────────

export const tdsSectionSettingRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  financialYear: z.string(),
  sectionCode: z.string(),
  rate: money3Nullable,
  individualRate: money3Nullable,
  rateWithoutPan: money3Nullable,
  singleThreshold: money2Nullable,
  aggregateThreshold: money2Nullable,
  isActive: z.boolean(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const compositionSettingRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  financialYear: z.string(),
  category: z.enum(["manufacturer_trader", "restaurant", "other_service"]),
  rate: money3Nullable,
  gstr4DueDate: z.string().nullable(),
  interestRate: money3Nullable,
  lateFeePerDay: money2Nullable,
  lateFeeCap: money2Nullable,
  lateFeeNilPerDay: money2Nullable,
  lateFeeNilCap: money2Nullable,
  cmp08DueDay: z.number().int().nullable(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const taxChallanRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  kind: z.enum(["tds", "tcs"]),
  financialYear: z.string(),
  quarter: z.number().int(),
  challanNumber: z.string(),
  bsrCode: z.string(),
  depositedOn: isoDatetime,
  amount: money2,
  interest: money2,
  notes: z.string().nullable(),
  createdByUserId: uuidNullable,
  createdAt: isoDatetime,
});

export const periodLockRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  kind: z.enum(["books", "gst"]),
  lockedThrough: z.string().nullable(),
  returnPeriod: z.string().nullable(),
  note: z.string().nullable(),
  lockedByUserId: uuidNullable,
  lockedByName: z.string().nullable(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const financialYearCloseRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  financialYear: z.string(),
  closedAt: isoDatetime,
  closedByUserId: uuidNullable,
  closedByName: z.string().nullable(),
  note: z.string().nullable(),
  snapshot: z.unknown(),
});

export const taxDeductionRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  kind: z.enum(["tds", "tcs"]),
  direction: z.enum(["payable", "receivable"]),
  partyId: uuid,
  paymentId: uuidNullable,
  invoiceId: uuidNullable,
  expenseId: uuidNullable.optional(),
  sectionCode: z.string(),
  financialYear: z.string(),
  quarter: z.number().int(),
  baseAmount: money2,
  rate: money3,
  amount: money2,
  hasPan: z.boolean(),
  deductedOn: isoDatetime,
  challanId: uuidNullable,
  createdAt: isoDatetime,
});

export const tds26asEntryRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  importBatchId: uuid,
  financialYear: z.string(),
  quarter: z.number().int(),
  deductorTan: z.string(),
  deductorName: z.string().nullable(),
  section: z.string(),
  txnDate: isoDatetime,
  amountPaid: money2,
  taxDeducted: money2,
  taxDeposited: money2Nullable,
  partyId: uuidNullable,
  status: z.string(),
  createdAt: isoDatetime,
});

// ── Payroll (add-on) ──────────────────────────────────────────────────────────
// Added with Payroll Phase 1. Every column of these tables is new, so an older
// export simply has no rows for them. Identity and bank numbers (pan, aadhaar,
// uan, esicNumber, bankAccountNumber, bankIfsc) are optional columns: they are
// in the file only because the owner exports the whole business, and the
// import accepts files without them.

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateStringNullable = dateString.nullable();
const numericString = z.string().regex(/^-?\d+(\.\d{1,4})?$/);

export const payrollSettingsRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  defaultWeeklyOffDays: z.array(z.number().int()),
  standardHoursPerDay: numericString,
  overtimeMultiplier: numericString,
  leaveYearStartMonth: z.number().int(),
  // Statutory registrations (Phase 2): optional so a Phase 1 export still imports.
  pfRegistered: z.boolean().optional(),
  pfEstablishmentCode: z.string().nullable().optional(),
  esiRegistered: z.boolean().optional(),
  esiCode: z.string().nullable().optional(),
  ptStates: z.array(z.string()).optional(),
  lwfState: z.string().nullable().optional(),
  tdsEnabled: z.boolean().optional(),
  updatedAt: isoDatetime,
});

export const payrollStatutorySettingRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  financialYear: z.number().int(),
  rates: z.unknown(),
  verifiedNote: z.string().nullable(),
  verifiedOn: dateStringNullable,
  updatedByUserId: uuidNullable,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const employeeTaxDeclarationRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  employeeId: uuid,
  financialYear: z.number().int(),
  amounts: z.unknown(),
  updatedByUserId: uuidNullable,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const payrollStatutoryPaymentRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  runId: uuid,
  kind: z.string(),
  amount: money2,
  paidOn: dateString,
  challanNumber: z.string().nullable(),
  challanDate: dateStringNullable,
  reference: z.string().nullable(),
  bankAccountId: uuidNullable,
  journalEntryId: uuidNullable,
  createdByUserId: uuidNullable,
  createdAt: isoDatetime,
});

const nameRow = {
  id: uuid,
  businessId: uuid,
  name: z.string(),
  isActive: z.boolean(),
  createdAt: isoDatetime,
};
export const payrollDepartmentRowSchema = z.object(nameRow);
export const payrollDesignationRowSchema = z.object(nameRow);

export const payrollShiftRowSchema = z.object({
  ...nameRow,
  startTime: z.string(),
  endTime: z.string(),
  weeklyOffDays: z.array(z.number().int()),
  standardHours: numericString,
});

export const employeeRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  employeeCode: z.string(),
  name: z.string(),
  dateOfBirth: dateStringNullable,
  gender: z.string().nullable(),
  fatherOrSpouseName: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  photoDataUrl: z.string().nullable(),
  // Sensitive identity and bank numbers: optional so a file without them still imports.
  pan: z.string().nullable().optional(),
  aadhaar: z.string().nullable().optional(),
  uan: z.string().nullable().optional(),
  esicNumber: z.string().nullable().optional(),
  dateOfJoining: dateString,
  departmentId: uuidNullable,
  designationId: uuidNullable,
  branch: z.string().nullable(),
  workState: z.string().nullable(),
  managerId: uuidNullable,
  shiftId: uuidNullable,
  employmentType: z.string(),
  taxRegime: z.string(),
  bankAccountNumber: z.string().nullable().optional(),
  bankIfsc: z.string().nullable().optional(),
  bankAccountName: z.string().nullable(),
  bankName: z.string().nullable(),
  status: z.string(),
  lastWorkingDay: dateStringNullable,
  exitReason: z.string().nullable(),
  exitNote: z.string().nullable(),
  fnfNote: z.string().nullable(),
  fnfPayrollRunId: uuidNullable,
  // Statutory settings (Phase 2): optional so a Phase 1 export still imports.
  pfApplicable: z.boolean().optional(),
  pfExcluded: z.boolean().optional(),
  epsEligible: z.boolean().optional(),
  pfOnActualWages: z.boolean().optional(),
  vpfPercent: numericString.optional(),
  internationalWorker: z.boolean().optional(),
  pfJoinDate: dateStringNullable.optional(),
  esiApplicable: z.boolean().optional(),
  createdByUserId: uuidNullable,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const salaryComponentRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  code: z.string(),
  name: z.string(),
  type: z.string(),
  category: z.string(),
  prorate: z.boolean(),
  isWage: z.boolean(),
  statutoryKind: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const salaryTemplateRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  name: z.string(),
  description: z.string().nullable(),
  sampleAnnualCtc: money2,
  isActive: z.boolean(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const salaryTemplateLineRowSchema = z.object({
  id: uuid,
  templateId: uuid,
  componentId: uuid,
  calcType: z.string(),
  value: money2,
  sortOrder: z.number().int(),
});

export const employeeSalaryAssignmentRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  employeeId: uuid,
  templateId: uuidNullable,
  annualCtc: money2,
  monthlyCtc: money2,
  effectiveFrom: dateString,
  breakdown: z.unknown(),
  createdByUserId: uuidNullable,
  createdAt: isoDatetime,
});

export const attendanceRecordRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  employeeId: uuid,
  date: dateString,
  status: z.string(),
  leaveTypeId: uuidNullable,
  checkIn: z.string().nullable(),
  checkOut: z.string().nullable(),
  overtimeHours: numericString,
  note: z.string().nullable(),
  source: z.string(),
  markedByUserId: uuidNullable,
  updatedAt: isoDatetime,
});

export const payrollHolidayRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  date: dateString,
  name: z.string(),
  scope: z.string(),
  stateCode: z.string().nullable(),
  branch: z.string().nullable(),
  createdAt: isoDatetime,
});

export const leaveTypeRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  code: z.string(),
  name: z.string(),
  isPaid: z.boolean(),
  accrualType: z.string(),
  accrualDays: numericString,
  carryForward: z.boolean(),
  carryForwardMax: numericString,
  encashable: z.boolean(),
  isActive: z.boolean(),
  createdAt: isoDatetime,
});

export const leaveLedgerRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  employeeId: uuid,
  leaveTypeId: uuid,
  leaveYear: z.number().int(),
  entryDate: dateString,
  kind: z.string(),
  days: numericString,
  periodKey: z.string().nullable(),
  applicationId: uuidNullable,
  note: z.string().nullable(),
  createdByUserId: uuidNullable,
  createdAt: isoDatetime,
});

export const leaveApplicationRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  employeeId: uuid,
  leaveTypeId: uuid,
  fromDate: dateString,
  toDate: dateString,
  halfDayStart: z.boolean(),
  halfDayEnd: z.boolean(),
  days: numericString,
  paidDays: numericString,
  lopDays: numericString,
  reason: z.string().nullable(),
  status: z.string(),
  decidedByUserId: uuidNullable,
  decidedByName: z.string().nullable(),
  decidedAt: isoDatetimeNullable,
  decisionNote: z.string().nullable(),
  createdByUserId: uuidNullable,
  createdAt: isoDatetime,
});

export const leaveEncashmentRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  employeeId: uuid,
  leaveTypeId: uuid,
  days: numericString,
  amount: money2,
  note: z.string().nullable(),
  payrollRunId: uuidNullable,
  createdByUserId: uuidNullable,
  createdAt: isoDatetime,
});

export const payrollRunRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  month: z.string(),
  status: z.string(),
  daysInMonth: z.number().int(),
  employeeCount: z.number().int(),
  grossTotal: money2,
  deductionsTotal: money2,
  employerTotal: money2,
  netTotal: money2,
  warnings: z.unknown(),
  statutory: z.unknown().optional(),
  notes: z.string().nullable(),
  attendanceLockedAt: isoDatetimeNullable,
  attendanceLockedByUserId: uuidNullable,
  calculatedAt: isoDatetimeNullable,
  calculatedByUserId: uuidNullable,
  calculatedByName: z.string().nullable(),
  submittedAt: isoDatetimeNullable,
  submittedByUserId: uuidNullable,
  approvedAt: isoDatetimeNullable,
  approvedByUserId: uuidNullable,
  approvedByName: z.string().nullable(),
  postedAt: isoDatetimeNullable,
  postedByUserId: uuidNullable,
  accrualJournalEntryId: uuidNullable,
  paidAt: isoDatetimeNullable,
  paidOn: dateStringNullable,
  paidByUserId: uuidNullable,
  paidFromBankAccountId: uuidNullable,
  paidReference: z.string().nullable(),
  paymentJournalEntryId: uuidNullable,
  createdByUserId: uuidNullable,
  createdByName: z.string().nullable(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export const payrollRunLineRowSchema = z.object({
  id: uuid,
  runId: uuid,
  businessId: uuid,
  employeeId: uuid,
  employeeCode: z.string(),
  employeeName: z.string(),
  department: z.string().nullable(),
  designation: z.string().nullable(),
  daysInMonth: z.number().int(),
  employedDays: z.number().int(),
  paidDays: numericString,
  lopDays: numericString,
  overtimeHours: numericString,
  components: z.unknown(),
  grossEarnings: money2,
  totalDeductions: money2,
  employerContributions: money2,
  netPay: money2,
  warnings: z.unknown(),
  statutory: z.unknown().optional(),
  isFinalSettlement: z.boolean(),
  // Frozen at approval for the bank file (sensitive): optional.
  bankAccountNumber: z.string().nullable().optional(),
  bankIfsc: z.string().nullable().optional(),
  bankAccountName: z.string().nullable().optional(),
  createdAt: isoDatetime,
});

export const payrollRunAdjustmentRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  runId: uuid,
  employeeId: uuid,
  name: z.string(),
  type: z.string(),
  amount: money2,
  note: z.string().nullable(),
  createdByUserId: uuidNullable,
  createdAt: isoDatetime,
});

export const payslipRowSchema = z.object({
  id: uuid,
  businessId: uuid,
  runId: uuid,
  lineId: uuid,
  employeeId: uuid,
  month: z.string(),
  number: z.string(),
  snapshot: z.unknown(),
  emailedAt: isoDatetimeNullable,
  emailedTo: z.string().nullable(),
  createdAt: isoDatetime,
});

// ── Registry map ──────────────────────────────────────────────────────────────

export const ROW_SCHEMAS: Record<string, z.ZodTypeAny> = {
  businesses: businessRowSchema,
  chart_of_accounts: chartOfAccountsRowSchema,
  parties: partyRowSchema,
  bank_accounts: bankAccountRowSchema,
  bank_statement_templates: bankStatementTemplateRowSchema,
  payment_gateway_configs: paymentGatewayConfigRowSchema,
  e_invoice_configs: eInvoiceConfigRowSchema,
  stock_groups: stockGroupRowSchema,
  items: itemRowSchema,
  item_variants: itemVariantRowSchema,
  item_batches: itemBatchRowSchema,
  sales_targets: salesTargetRowSchema,
  invoices: invoiceRowSchema,
  invoice_items: invoiceItemRowSchema,
  payments: paymentRowSchema,
  payment_allocations: paymentAllocationRowSchema,
  tds_section_settings: tdsSectionSettingRowSchema,
  composition_settings: compositionSettingRowSchema,
  tax_challans: taxChallanRowSchema,
  tax_deductions: taxDeductionRowSchema,
  tds_26as_entries: tds26asEntryRowSchema,
  period_locks: periodLockRowSchema,
  financial_year_closes: financialYearCloseRowSchema,
  bank_transactions: bankTransactionRowSchema,
  expenses: expenseRowSchema,
  stock_adjustments: stockAdjustmentRowSchema,
  journal_entry_templates: journalEntryTemplateRowSchema,
  journal_entries: journalEntryRowSchema,
  journal_entry_lines: journalEntryLineRowSchema,
  itc_ledger_entries: itcLedgerEntryRowSchema,
  itc_utilizations: itcUtilizationRowSchema,
  recurring_invoice_templates: recurringInvoiceTemplateRowSchema,
  recurring_invoice_runs: recurringInvoiceRunRowSchema,
  bank_statement_imports: bankStatementImportRowSchema,
  bank_statement_lines: bankStatementLineRowSchema,
  bank_categorization_rules: bankCategorizationRuleRowSchema,
  shipments: shipmentRowSchema,
  shipment_events: shipmentEventRowSchema,
  store_orders: storeOrderRowSchema,
  store_order_refunds: storeOrderRefundRowSchema,
  eway_bills: ewayBillRowSchema,
  eway_bill_vehicle_updates: ewayBillVehicleUpdateRowSchema,
  audit_log: auditLogRowSchema,
  gstr2b_uploads: gstr2bUploadRowSchema,
  gstr2b_records: gstr2bRecordRowSchema,
  payroll_settings: payrollSettingsRowSchema,
  payroll_statutory_settings: payrollStatutorySettingRowSchema,
  payroll_departments: payrollDepartmentRowSchema,
  payroll_designations: payrollDesignationRowSchema,
  payroll_shifts: payrollShiftRowSchema,
  employees: employeeRowSchema,
  employee_tax_declarations: employeeTaxDeclarationRowSchema,
  salary_components: salaryComponentRowSchema,
  salary_templates: salaryTemplateRowSchema,
  salary_template_lines: salaryTemplateLineRowSchema,
  employee_salary_assignments: employeeSalaryAssignmentRowSchema,
  attendance_records: attendanceRecordRowSchema,
  payroll_holidays: payrollHolidayRowSchema,
  leave_types: leaveTypeRowSchema,
  leave_ledger: leaveLedgerRowSchema,
  leave_applications: leaveApplicationRowSchema,
  leave_encashments: leaveEncashmentRowSchema,
  payroll_runs: payrollRunRowSchema,
  payroll_run_lines: payrollRunLineRowSchema,
  payroll_statutory_payments: payrollStatutoryPaymentRowSchema,
  payroll_run_adjustments: payrollRunAdjustmentRowSchema,
  payslips: payslipRowSchema,
};
