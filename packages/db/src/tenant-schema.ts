import {
  pgTable,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
  uuid,
  pgEnum,
  index,
  uniqueIndex,
  jsonb,
  customType,
  date,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// bytea for binary blobs (e.g., business logo image bytes). Drizzle doesn't
// ship a first-class bytea helper, so we declare one. Postgres returns bytea
// as Buffer via node-postgres, and Drizzle passes it through unchanged.
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

// ── Enums ──────────────────────────────────────────────────────

export const partyTypeEnum = pgEnum("party_type", ["customer", "supplier"]);
export const invoiceTypeEnum = pgEnum("invoice_type", ["sale", "purchase"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled", "adjusted"]);
export const paymentModeEnum = pgEnum("payment_mode", ["cash", "bank", "upi", "cheque", "other", "credit_card", "debit_card", "net_banking", "wallet"]);
export const unitEnum = pgEnum("unit", ["pcs", "kg", "g", "l", "ml", "m", "cm", "ft", "in", "box", "dozen", "pair", "set", "pkt", "bun", "pouch", "jar", "btl", "bag", "ton", "pack", "pet", "person", "other"]);
export const itemTypeEnum = pgEnum("item_type", ["product", "service"]);
export const itemModeEnum = pgEnum("item_mode", ["simple", "alt_units", "variants"]);
export const documentTypeEnum = pgEnum("document_type", ["invoice", "quotation", "credit_note", "debit_note", "delivery_challan", "proforma", "sales_return", "purchase_return", "purchase_order", "sales_order", "goods_receipt_note"]);
export const bankAccountTypeEnum = pgEnum("bank_account_type", ["savings", "current", "cash", "upi", "credit_card", "payment_gateway"]);
export const bankTransactionTypeEnum = pgEnum("bank_transaction_type", ["deposit", "withdrawal", "transfer"]);
export const gstRegistrationTypeEnum = pgEnum("gst_registration_type", ["regular", "composition", "unregistered"]);
export const recurringFrequencyEnum = pgEnum("recurring_frequency", ["weekly", "biweekly", "monthly", "quarterly", "half_yearly", "yearly", "custom"]);
export const recurringTemplateStatusEnum = pgEnum("recurring_template_status", ["active", "paused", "completed", "expired"]);
export const recurringRunStatusEnum = pgEnum("recurring_run_status", ["success", "failed", "skipped_limit"]);
export const accountTypeEnum = pgEnum("account_type", ["asset", "liability", "equity", "income", "expense"]);

// ── Business ───────────────────────────────────────────────────

export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  // No FK to users — plain UUID, users live in control schema (different DB in cloud mode)
  createdByUserId: uuid("created_by_user_id").notNull(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  gstRegistrationType: gstRegistrationTypeEnum("gst_registration_type").default("unregistered").notNull(),
  gstin: text("gstin"),
  pan: text("pan"),
  businessType: text("business_type")
    .default("proprietorship")
    .notNull(),
  tan: text("tan"),
  deductorType: text("deductor_type"),
  responsiblePersonName: text("responsible_person_name"),
  responsiblePersonPan: text("responsible_person_pan"),
  responsiblePersonDesignation: text("responsible_person_designation"),
  cin: text("cin"),
  llpin: text("llpin"),
  udyamNumber: text("udyam_number"),
  iecCode: text("iec_code"),
  lutArn: text("lut_arn"),
  eInvoiceEnabled: boolean("e_invoice_enabled")
    .default(false)
    .notNull(),
  eWayBillEnabled: boolean("e_way_bill_enabled")
    .default(false)
    .notNull(),
  assesseeOfOtherTerritory: boolean("assessee_of_other_territory")
    .default(false)
    .notNull(),
  gstReturnPeriodicity: text("gst_return_periodicity")
    .default("monthly")
    .notNull(),
  eWayBillThreshold: numeric("e_way_bill_threshold", {
    precision: 15,
    scale: 2,
  }),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  addressLine1: text("address_line_1"),
  addressLine2: text("address_line_2"),
  landmark: text("landmark"),
  countryOfOperations: text("country_of_operations"),
  city: text("city"),
  state: text("state"),
  stateCode: text("state_code"), // 2-digit GST state code (01-38) for inter/intra-state detection
  pincode: text("pincode"),
  logoUrl: text("logo_url"),
  // Business logo stored as raw image bytes. PNG or JPEG only (magic-byte
  // validated on upload). Lives in the tenant DB so it rides along with
  // pg_dump, pg_basebackup, and the NDJSON self-export.
  logoData: bytea("logo_data"),
  logoMimeType: text("logo_mime_type"),
  logoWidth: integer("logo_width"),
  logoHeight: integer("logo_height"),
  logoUpdatedAt: timestamp("logo_updated_at", { withTimezone: true }),
  // Authorised-signatory image, stored exactly like the logo (PNG/JPEG only,
  // magic-byte checked on upload). Rendered above the signature line on
  // invoices and other documents.
  signatureData: bytea("signature_data"),
  signatureMimeType: text("signature_mime_type"),
  signatureWidth: integer("signature_width"),
  signatureHeight: integer("signature_height"),
  signatureUpdatedAt: timestamp("signature_updated_at", { withTimezone: true }),
  invoicePrefix: text("invoice_prefix").default("INV").notNull(),
  nextInvoiceNumber: integer("next_invoice_number").default(1).notNull(),
  paymentPrefix: text("payment_prefix").default("PAY").notNull(),
  nextPaymentNumber: integer("next_payment_number").default(1).notNull(),
  quotationPrefix: text("quotation_prefix").default("QTN").notNull(),
  nextQuotationNumber: integer("next_quotation_number").default(1).notNull(),
  creditNotePrefix: text("credit_note_prefix").default("CN").notNull(),
  nextCreditNoteNumber: integer("next_credit_note_number").default(1).notNull(),
  debitNotePrefix: text("debit_note_prefix").default("DN").notNull(),
  nextDebitNoteNumber: integer("next_debit_note_number").default(1).notNull(),
  salesReturnPrefix: text("sales_return_prefix").default("SR").notNull(),
  nextSalesReturnNumber: integer("next_sales_return_number").default(1).notNull(),
  purchaseReturnPrefix: text("purchase_return_prefix").default("PR").notNull(),
  nextPurchaseReturnNumber: integer("next_purchase_return_number").default(1).notNull(),
  deliveryChallanPrefix: text("delivery_challan_prefix").default("DC").notNull(),
  nextDeliveryChallanNumber: integer("next_delivery_challan_number").default(1).notNull(),
  purchaseOrderPrefix: text("purchase_order_prefix").default("PO").notNull(),
  nextPurchaseOrderNumber: integer("next_purchase_order_number").default(1).notNull(),
  salesOrderPrefix: text("sales_order_prefix").default("SO").notNull(),
  nextSalesOrderNumber: integer("next_sales_order_number").default(1).notNull(),
  goodsReceiptNotePrefix: text("goods_receipt_note_prefix").default("GRN").notNull(),
  nextGoodsReceiptNoteNumber: integer("next_goods_receipt_note_number").default(1).notNull(),
  // Counter behind auto-generated internal barcodes (see generateInternalBarcode).
  // Follows the same allocate-then-increment pattern as the document numbers
  // above so two concurrent purchases cannot mint the same code.
  nextBarcodeNumber: integer("next_barcode_number").default(1).notNull(),
  // Turn auto-generation off for businesses that print supplier barcodes only.
  autoGenerateBarcodes: boolean("auto_generate_barcodes").default(true).notNull(),
  // Barcode setup. `barcodesEnabled` gates every barcode feature (fields,
  // scanning, labels, physical stock). Type and mode decide what codes the
  // business creates and whether an item can carry more than one; both are
  // locked once `barcodeSetupLockedAt` is set, because every printed label
  // and every code on the shelf follows them.
  barcodesEnabled: boolean("barcodes_enabled").default(true).notNull(),
  barcodeType: text("barcode_type").default("ean13").notNull(), // ean13 | code128 | qr
  barcodeMode: text("barcode_mode").default("single").notNull(), // single | multi
  barcodeSetupLockedAt: timestamp("barcode_setup_locked_at", { withTimezone: true }),
  barcodeSetupLockedBy: text("barcode_setup_locked_by"),
  proformaPrefix: text("proforma_prefix").default("PI").notNull(),
  nextProformaNumber: integer("next_proforma_number").default(1).notNull(),
  financialYearStart: integer("financial_year_start_month").default(4).notNull(), // April
  financialYearStartDate: date("financial_year_start_date", {
    mode: "string",
  }),
  currency: text("currency").default("INR").notNull(),
  annualTurnover: numeric("annual_turnover", { precision: 15, scale: 2 }), // For HSN digit enforcement & e-invoicing threshold
  // ── Online Store settings ──
  storeEnabled: boolean("store_enabled").default(false).notNull(),
  storeSlug: text("store_slug"),
  storeTagline: text("store_tagline"),
  storeAccentColor: text("store_accent_color"),
  storeMinOrderAmount: numeric("store_min_order_amount", { precision: 15, scale: 2 }),
  storeDeliveryNote: text("store_delivery_note"),
  // Delivery charge at checkout: a flat fee in rupees (before GST; 0 = free delivery or pickup only)
  // and an optional order subtotal at or above which it is free. Worked out on the server when an
  // order is placed and put on the order's invoice as an additional charge.
  storeDeliveryFee: numeric("store_delivery_fee", { precision: 15, scale: 2 }).default("0").notNull(),
  storeFreeDeliveryAbove: numeric("store_free_delivery_above", { precision: 15, scale: 2 }),
  storeWhatsappNumber: text("store_whatsapp_number"),
  storeAllowNegativeStock: boolean("store_allow_negative_stock").default(false).notNull(),
  // Checkout payment choices. Online payments need the business's own Razorpay
  // connection (razorpay_connections); Cash on Delivery stays on until the
  // owner switches it off, so stores that never set this up behave as before.
  storeOnlinePaymentsEnabled: boolean("store_online_payments_enabled").default(false).notNull(),
  storeCodEnabled: boolean("store_cod_enabled").default(true).notNull(),
  // Custom shipping/delivery methods configured by the business (in addition to built-in ones)
  customShippingMethods: jsonb("custom_shipping_methods").$type<Array<{ id: string; label: string; hasTracking: boolean }>>(),
  // Carrier API credentials (encrypted at rest) — keyed by carrier slug
  carrierCredentials: jsonb("carrier_credentials").$type<Record<string, { apiKey?: string; apiSecret?: string; accountId?: string; enabled: boolean }>>(),
  nextStoreOrderNumber: integer("next_store_order_number").default(1).notNull(),
  storeOrderPrefix: text("store_order_prefix").default("ORD").notNull(),
  // Store policy pages. Return window feeds the Refund policy template; the
  // policies map holds only pages the owner has edited (kind -> markdown), so
  // untouched pages keep following the default template and business details.
  storeReturnWindowDays: integer("store_return_window_days").default(7).notNull(),
  storePolicies: jsonb("store_policies").$type<Partial<Record<"terms" | "refund" | "shipping" | "contact" | "privacy", { content: string; updatedAt: string }>>>(),
  // Payment reminder settings (see @fintranzact/shared payment-reminders.ts).
  // Null = the defaults, which have reminders switched off.
  paymentReminderSettings: jsonb("payment_reminder_settings").$type<Record<string, unknown>>(),
  // Point-of-Sale mode. When enabled: a /pos fullscreen register route is
  // reachable and the "Switch to POS" entry button appears on invoice
  // create. Off by default; toggle lives on Settings → POS.
  posEnabled: boolean("pos_enabled").default(false).notNull(),
  // Document defaults applied at invoice/quote creation time. Editable per
  // business under Settings → Documents.
  defaultRoundOff: boolean("default_round_off").default(true).notNull(),
  defaultTermsAndConditions: text("default_terms_and_conditions"),
  // Printed invoice design (see INVOICE_TEMPLATES in @fintranzact/shared).
  // "classic" is the original A4 layout, so nothing changes until chosen.
  invoiceTemplate: text("invoice_template").default("classic").notNull(),
  // Thermal receipt roll width in mm: 58 or 80.
  thermalWidth: integer("thermal_width").default(80).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("businesses_owner_idx").on(t.createdByUserId),
  uniqueIndex("businesses_store_slug_idx").on(t.storeSlug),
]);

// ── Business Members ──────────────────────────────────────────
// Controls which tenant users can access which business.
// userId is a plain UUID because users live in the control DB.

export const businessMemberRoleEnum = pgEnum("business_member_role", [
  "admin",
  "member",
]);

export const businessMembers = pgTable("business_members", {
  id: uuid("id").primaryKey().defaultRandom(),

  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),

  // No FK to users — users live in the control DB.
  userId: uuid("user_id").notNull(),

  role: businessMemberRoleEnum("role").default("member").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (t) => [
  uniqueIndex("business_members_business_user_idx").on(
    t.businessId,
    t.userId,
  ),
  index("business_members_user_idx").on(t.userId),
]);

// ── Inventory Settings ─────────────────────────────────────────

export const inventorySettings = pgTable("inventory_settings", {
  id: uuid("id").primaryKey().defaultRandom(),

  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),

  salesWarehouseId: uuid("sales_warehouse_id")
    .references(() => warehouses.id, { onDelete: "set null" }),

  purchaseWarehouseId: uuid("purchase_warehouse_id")
    .references(() => warehouses.id, { onDelete: "set null" }),

  salesReturnWarehouseId: uuid("sales_return_warehouse_id")
    .references(() => warehouses.id, { onDelete: "set null" }),

  purchaseReturnWarehouseId: uuid("purchase_return_warehouse_id")
    .references(() => warehouses.id, { onDelete: "set null" }),

  productionWarehouseId: uuid("production_warehouse_id")
    .references(() => warehouses.id, { onDelete: "set null" }),

  stockAdjustmentWarehouseId: uuid("stock_adjustment_warehouse_id")
    .references(() => warehouses.id, { onDelete: "set null" }),

  // What happens when a document would take a warehouse below zero:
  // "allow" silently, "warn" (the entry form flags it, saving still works) or
  // "block" (the server refuses to save).
  negativeStockPolicy: text("negative_stock_policy").default("warn").notNull(),

  // How closing stock is valued in the stock summary, P&L and balance sheet:
  // "weighted_average" (average cost of purchases, Tally's default) or "fifo"
  // (the latest purchases are the ones still on the shelf).
  valuationMethod: text("valuation_method").default("weighted_average").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (t) => [
  uniqueIndex("inventory_settings_business_idx").on(t.businessId),
  index("inventory_settings_sales_wh_idx").on(t.salesWarehouseId),
  index("inventory_settings_purchase_wh_idx").on(t.purchaseWarehouseId),
]);

// ── Warehouse Permissions ──────────────────────────────────────

export const warehousePermissions = pgTable("warehouse_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),

  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),

  businessMemberId: uuid("business_member_id")
    .notNull()
    .references(() => businessMembers.id, { onDelete: "cascade" }),

  warehouseId: uuid("warehouse_id")
    .notNull()
    .references(() => warehouses.id, { onDelete: "cascade" }),

  canView: boolean("can_view").default(true).notNull(),
  canReceive: boolean("can_receive").default(false).notNull(),
  canIssue: boolean("can_issue").default(false).notNull(),
  canTransfer: boolean("can_transfer").default(false).notNull(),
  canAdjust: boolean("can_adjust").default(false).notNull(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (t) => [
  uniqueIndex("warehouse_permissions_member_wh_idx").on(
    t.businessMemberId,
    t.warehouseId,
  ),
  index("warehouse_permissions_business_idx").on(t.businessId),
  index("warehouse_permissions_member_idx").on(t.businessMemberId),
  index("warehouse_permissions_warehouse_idx").on(t.warehouseId),
]);

// ── Parties (Customers / Suppliers) ────────────────────────────

export const parties = pgTable("parties", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  type: partyTypeEnum("type").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  gstin: text("gstin"),
  pan: text("pan"),
  billingAddress: text("billing_address"),
  shippingAddress: text("shipping_address"),
  // Extra delivery locations beyond shippingAddress (e.g. branches, godowns).
  additionalShippingAddresses: jsonb("additional_shipping_addresses").$type<Array<{
    label?: string;
    address: string;
    city?: string;
    state?: string;
    stateCode?: string;
    pincode?: string;
  }>>(),
  city: text("city"),
  state: text("state"),
  stateCode: text("state_code"), // 2-digit GST state code for inter/intra-state detection
  pincode: text("pincode"),
  openingBalance: numeric("opening_balance", { precision: 15, scale: 2 }).default("0").notNull(),
  category: text("category"),
  creditPeriodDays: integer("credit_period_days"),
  creditLimit: numeric("credit_limit", { precision: 15, scale: 2 }),
  contactPersonName: text("contact_person_name"),
  contactPersonDob: timestamp("contact_person_dob", { withTimezone: true }),
  bankAccountNumber: text("bank_account_number"),
  bankIfsc: text("bank_ifsc"),
  bankName: text("bank_name"),
  // GST registration details — filled from a GSTIN lookup where available.
  legalName: text("legal_name"), // name as registered for GST
  tradeName: text("trade_name"), // name the party does business under
  gstRegistrationType: text("gst_registration_type"), // regular | composition | unregistered | sez | overseas | uin
  constitution: text("constitution"), // proprietorship | partnership | llp | company | huf | trust | government | other
  gstinStatus: text("gstin_status"), // active | cancelled | suspended | inactive (from the last lookup)
  gstinVerifiedAt: timestamp("gstin_verified_at", { withTimezone: true }),
  // MSME (Udyam) — drives the 45-day payment rule for micro/small suppliers.
  // Customer asked not to be reminded: no automatic or manual payment reminders.
  doNotRemind: boolean("do_not_remind").default(false).notNull(),
  isMsme: boolean("is_msme").default(false).notNull(),
  udyamNumber: text("udyam_number"),
  msmeCategory: text("msme_category"), // micro | small | medium
  // TDS applicable on payments to this party (see @fintranzact/shared tds.ts).
  tdsSection: text("tds_section"),
  // Price level (Retail, Wholesale, Dealer...) sales to this party are priced at.
  // Null = the business's default level, if it has one.
  priceLevelId: uuid("price_level_id").references(() => priceLevels.id, { onDelete: "set null" }),
  source: text("source"), // null = manual, "mybillbook", "tally", etc.
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("parties_business_idx").on(t.businessId),
  index("parties_type_idx").on(t.businessId, t.type),
  index("parties_name_idx").on(t.businessId, t.name),
]);

// ── Premises ───────────────────────────────────────────────────

export const premises = pgTable("premises", {
  id: uuid("id").primaryKey().defaultRandom(),

  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),

  name: text("name").notNull(),
  code: text("code").notNull(),

  address: text("address"),
  state: text("state"),
  city: text("city"),

  status: text("status").default("active").notNull(),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  }).defaultNow().notNull(),

  updatedAt: timestamp("updated_at", {
    withTimezone: true,
  }).defaultNow().notNull(),
}, (t) => [
  index("premises_business_idx").on(t.businessId),
  uniqueIndex("premises_business_code_idx").on(t.businessId, t.code),
]);


// ── Warehouses ─────────────────────────────────────────────────

export const warehouses = pgTable("warehouses", {
  id: uuid("id").primaryKey().defaultRandom(),

  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),

  premiseId: uuid("premise_id")
    .notNull()
    .references(() => premises.id, { onDelete: "restrict" }),

  name: text("name").notNull(),
  code: text("code").notNull(),

  warehouseType: text("warehouse_type").notNull(),

  address: text("address"),

  status: text("status").default("active").notNull(),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  }).defaultNow().notNull(),

  updatedAt: timestamp("updated_at", {
    withTimezone: true,
  }).defaultNow().notNull(),
}, (t) => [
  index("warehouses_business_idx").on(t.businessId),
  index("warehouses_premise_idx").on(t.premiseId),
  uniqueIndex("warehouses_business_code_idx").on(t.businessId, t.code),
]);


// ── Warehouse Locations ────────────────────────────────────────

export const warehouseLocations = pgTable("warehouse_locations", {
  id: uuid("id").primaryKey().defaultRandom(),

  warehouseId: uuid("warehouse_id")
    .notNull()
    .references(() => warehouses.id, { onDelete: "cascade" }),

  parentId: uuid("parent_id"),

  locationType: text("location_type").notNull(),

  name: text("name").notNull(),
  code: text("code").notNull(),

  status: text("status").default("active").notNull(),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  }).defaultNow().notNull(),

  updatedAt: timestamp("updated_at", {
    withTimezone: true,
  }).defaultNow().notNull(),
}, (t) => [
  index("warehouse_locations_warehouse_idx").on(t.warehouseId),
  index("warehouse_locations_parent_idx").on(t.parentId),
  uniqueIndex("warehouse_locations_code_idx").on(
    t.warehouseId,
    t.code,
  ),
]);

// ── Stock Groups ───────────────────────────────────────────────
// Tally-style stock groups: a business-scoped tree that items hang off.
// Replaces the free-text `items.category`. That column stays and is kept
// equal to the group's name so older readers (CLI, mobile, store) still work.

export const stockGroups = pgTable("stock_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Nesting. Restrict: the API refuses to delete a group that still has
  // children, so a group never points at a missing parent.
  parentId: uuid("parent_id").references((): AnyPgColumn => stockGroups.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("stock_groups_business_name_idx").on(t.businessId, t.name),
  index("stock_groups_parent_idx").on(t.parentId),
]);

// ── Items / Products ───────────────────────────────────────────

export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  hsn: text("hsn"),
  // TCS section (s.206C) for specified goods such as scrap; sales of this item carry TCS.
  tcsSection: text("tcs_section"),
  sku: text("sku"),
  // Scannable product code (EAN-13 / UPC-A / Code 128). Kept separate from
  // `sku`: an SKU is an internal catalogue code chosen by the business, while
  // a barcode is what a scanner actually reads off the package. POS matched
  // on SKU as a stand-in before this column existed.
  barcode: text("barcode"),
  unit: unitEnum("unit").default("pcs").notNull(),
  itemMode: itemModeEnum("item_mode").default("simple").notNull(),
  unitVariants: jsonb("unit_variants").$type<Array<{
    unit: string;
    conversionFactor: number;
    salePrice: string;
    purchasePrice?: string;
  }>>(),
  variantAttributes: jsonb("variant_attributes").$type<string[]>(), // dimension names e.g. ["Size", "Color"]
  salePrice: numeric("sale_price", { precision: 15, scale: 2 }),
  purchasePrice: numeric("purchase_price", { precision: 15, scale: 2 }),
  // Maximum retail price printed on the pack. Selling above it is flagged.
  mrp: numeric("mrp", { precision: 15, scale: 2 }),
  taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }).default("0").notNull(),
  stockQuantity: numeric("stock_quantity", { precision: 15, scale: 3 }).default("0").notNull(),
  lowStockAlert: numeric("low_stock_alert", { precision: 15, scale: 3 }),
  description: text("description"),
  itemType: itemTypeEnum("item_type").default("product").notNull(),
  category: text("category"),
  // Stock group. When set, `category` mirrors the group's name.
  stockGroupId: uuid("stock_group_id").references(() => stockGroups.id, { onDelete: "set null" }),
  taxInclusive: boolean("tax_inclusive").default(false).notNull(),
  // Batch / lot tracking. Off by default: an item that doesn't track batches
  // moves stock exactly as before. When on, stock is held per batch
  // (item_batches) and every movement names the batch it came from or went to.
  trackBatches: boolean("track_batches").default(false).notNull(),
  // Only meaningful with trackBatches: new batches need an expiry date, and
  // sales pick the batch that expires first (FEFO) and skip expired ones.
  trackExpiry: boolean("track_expiry").default(false).notNull(),
  source: text("source"),
  // ── Online Store fields ──
  storeEnabled: boolean("store_enabled").default(false).notNull(),
  storePrice: numeric("store_price", { precision: 15, scale: 2 }),
  storeSortOrder: integer("store_sort_order").default(0).notNull(),
  storeCategory: text("store_category"),
  storeDescription: text("store_description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  // Soft delete — historical invoice line items must still resolve item
  // master data for audit/reporting, so deletions are logical rather than
  // physical. Every active read filters on deletedAt IS NULL; historical
  // joins (e.g. rendering a legacy invoice) intentionally include rows
  // where deletedAt IS NOT NULL. See partial index below for query planner
  // support on the active-read hot path.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("items_business_idx").on(t.businessId),
  index("items_name_idx").on(t.businessId, t.name),
  index("items_sku_idx").on(t.businessId, t.sku),
  // Scans are exact-match lookups on the hot path, and a barcode must resolve
  // to exactly one item within a business. Partial so the many items without
  // a barcode don't all collide on NULL.
  uniqueIndex("items_barcode_idx")
    .on(t.businessId, t.barcode)
    .where(sql`${t.barcode} IS NOT NULL AND ${t.deletedAt} IS NULL`),
  index("items_store_idx").on(t.businessId, t.storeEnabled),
  index("items_stock_group_idx").on(t.stockGroupId),
  // Partial index that mirrors the active-read path (`items.list`, catalog,
  // store, dashboards). The query planner picks this up for any WHERE that
  // includes `business_id` AND `deleted_at IS NULL`, keeping active-item
  // queries off the full table once soft deletes accumulate.
  index("items_active_idx").on(t.businessId, t.name).where(sql`deleted_at IS NULL`),
]);

// ── Item Variants (for items with itemMode = "variants") ─────

export const itemVariants = pgTable("item_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  attributeValues: jsonb("attribute_values").$type<Record<string, string>>().notNull(), // e.g. { "Size": "M", "Color": "Red" }
  sku: text("sku"),
  // Each variant scans as its own product — a red medium tee and a blue large
  // tee carry different barcodes even though they share an item.
  barcode: text("barcode"),
  salePrice: numeric("sale_price", { precision: 15, scale: 2 }),
  purchasePrice: numeric("purchase_price", { precision: 15, scale: 2 }),
  mrp: numeric("mrp", { precision: 15, scale: 2 }),
  stockQuantity: numeric("stock_quantity", { precision: 15, scale: 3 }).default("0").notNull(),
  lowStockAlert: numeric("low_stock_alert", { precision: 15, scale: 3 }),
  storeEnabled: boolean("store_enabled").default(false).notNull(),
  storePrice: numeric("store_price", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  // Soft delete — variants are deleted logically for the same reason as
  // items: historical invoice line items may reference a variantId that
  // was later removed from the catalog. The parent items.onDelete cascade
  // is left in place (physical parent delete still cleans up physically),
  // but both sides switched to soft-delete first so cascade rarely fires.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("item_variants_item_idx").on(t.itemId),
  index("item_variants_sku_idx").on(t.sku),
  // Scan lookups hit this directly. Not unique here: item_variants has no
  // business_id to scope on, so cross-business uniqueness is enforced in the
  // API alongside the items check rather than by a constraint.
  index("item_variants_barcode_idx").on(t.barcode),
  // Partial index for the active-variant read path (variant lookups in
  // item detail pages, stock/reporting joins). Mirrors items_active_idx.
  index("item_variants_active_idx").on(t.itemId).where(sql`deleted_at IS NULL`),
]);

// ── Item batches (batch / lot numbers with expiry) ─────────────
// The batch master for items that track batches. How much of a batch is
// where is never stored: it is the sum of the stock movements that name the
// batch, per warehouse — the same ledger that drives every other stock figure.

export const itemBatches = pgTable("item_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  // Set for a batch of one variant of a variant item.
  variantId: uuid("variant_id").references(() => itemVariants.id, { onDelete: "cascade" }),
  batchNumber: text("batch_number").notNull(),
  mfgDate: date("mfg_date"),
  expiryDate: date("expiry_date"),
  // MRP printed on this batch's packs, when it differs from the item's.
  mrp: numeric("mrp", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  // A batch number names one batch per item (or per variant).
  uniqueIndex("item_batches_item_number_idx")
    .on(t.businessId, t.itemId, t.batchNumber)
    .where(sql`${t.variantId} IS NULL`),
  uniqueIndex("item_batches_variant_number_idx")
    .on(t.businessId, t.itemId, t.variantId, t.batchNumber)
    .where(sql`${t.variantId} IS NOT NULL`),
  index("item_batches_item_idx").on(t.itemId),
  index("item_batches_expiry_idx").on(t.businessId, t.expiryDate),
]);

// ── Extra item barcodes (businesses on "many barcodes per item") ──
// The item's / variant's own `barcode` column stays the primary code — the one
// printed on labels. These are the other codes that also scan to the item: a
// supplier's code, an old code, or a box / carton code that stands for
// `packQty` pieces in one scan.

export const itemBarcodes = pgTable("item_barcodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").references(() => itemVariants.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  packQty: numeric("pack_qty", { precision: 15, scale: 3 }).default("1").notNull(),
  label: text("label"), // e.g. "Box of 12"
  source: text("source").default("manual").notNull(), // supplier | generated | manual | old
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("item_barcodes_code_idx").on(t.businessId, t.code),
  index("item_barcodes_item_idx").on(t.itemId),
]);

// ── Price levels / price lists ─────────────────────────────────
// Named selling-price levels (Tally "Price Levels"): Retail, Wholesale,
// Dealer... A party is priced at its level, or at the business's default
// level; an item with no entry on that level sells at its own sale price.

export const priceLevels = pgTable("price_levels", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").default(false).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("price_levels_name_idx").on(t.businessId, t.name),
  // At most one default level per business.
  uniqueIndex("price_levels_default_idx").on(t.businessId).where(sql`is_default`),
]);

// One price on one level for an item (optionally one variant, or one
// alternate unit), from a quantity (slab) and from a date. The entries of a
// level/item/variant/unit that share an effective date form one price list
// revision; the latest revision on or before the document date applies.
// An entry sets a rate, a discount off the item's sale price, or both.
export const priceListEntries = pgTable("price_list_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  priceLevelId: uuid("price_level_id").notNull().references(() => priceLevels.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  // Null = every variant of the item.
  variantId: uuid("variant_id").references(() => itemVariants.id, { onDelete: "cascade" }),
  // Null = the item's base unit; otherwise one of its alternate units.
  unit: text("unit"),
  // Slab: applies from this quantity up (in the entry's unit).
  minQuantity: numeric("min_quantity", { precision: 15, scale: 3 }).default("0").notNull(),
  price: numeric("price", { precision: 15, scale: 2 }),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }),
  // Null = always.
  effectiveFrom: date("effective_from"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("price_list_entries_level_item_idx").on(t.priceLevelId, t.itemId),
  index("price_list_entries_item_idx").on(t.itemId),
  index("price_list_entries_business_idx").on(t.businessId),
]);

// ── Invoices ───────────────────────────────────────────────────

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  partyId: uuid("party_id").notNull().references(() => parties.id, { onDelete: "restrict" }),
  type: invoiceTypeEnum("type").notNull(),
  status: invoiceStatusEnum("status").default("draft").notNull(),
  documentType: documentTypeEnum("document_type").default("invoice").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  // Purchase documents: the supplier's own number for the bill (what the
  // supplier reports in GSTR-1, so what GSTR-2B shows). Our invoiceNumber is
  // the business's internal sequence and never appears in the 2B.
  supplierInvoiceNumber: text("supplier_invoice_number"),
  invoiceDate: timestamp("invoice_date", { withTimezone: true }).defaultNow().notNull(),
  dueDate: timestamp("due_date", { withTimezone: true }),
  subtotal: numeric("subtotal", { precision: 15, scale: 2 }).default("0").notNull(),
  taxAmount: numeric("tax_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  discountAmount: numeric("discount_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  charges: jsonb("charges").$type<Array<{ label: string; amount: string; shipmentId?: string }>>(),
  additionalCharges: numeric("additional_charges", { precision: 15, scale: 2 }).default("0").notNull(),
  roundOff: numeric("round_off", { precision: 15, scale: 2 }).default("0").notNull(),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  amountPaid: numeric("amount_paid", { precision: 15, scale: 2 }).default("0").notNull(),
  notes: text("notes"),
  termsAndConditions: text("terms_and_conditions"),
  referenceDocumentId: uuid("reference_document_id"),
  // How this document's stock effect is recorded:
  //   "tracked" — through stock_movements (warehouse-aware; net may be zero
  //               while the document is cancelled)
  //   "none"    — never moves stock (e.g. an invoice billed against a
  //               delivery challan that already moved it)
  //   "legacy"  — created before stock movements existed; its effect was
  //               applied straight to item totals from its line items
  stockMode: text("stock_mode").default("legacy").notNull(),
  // Where the goods physically came in (purchase) or went out (sale). Null
  // means the business's default warehouse for that operation.
  warehouseId: uuid("warehouse_id").references(() => warehouses.id, { onDelete: "set null" }),
  // Orders, GRNs and delivery challans track what is still pending against
  // them (ordered minus what later documents took up). Set when the user
  // short-closes one: nothing more is expected, whatever is still pending.
  closedAt: timestamp("closed_at", { withTimezone: true }),
  // No FK to users — plain UUID, users live in control schema (different DB in cloud mode)
  createdByUserId: uuid("created_by_user_id"),
  createdByName: text("created_by_name"), // denormalized for display + imports
  deliveryMethod: text("delivery_method").default("self_pickup"), // self_pickup, hand_delivery, courier, bus, transport, post
  isReverseCharge: boolean("is_reverse_charge").default(false).notNull(),
  // TDS we deduct from a supplier on a purchase bill (worked out on the bill,
  // when it is credited). `tds_mode`: auto (worked out from the party's section
  // and the yearly limits), none (no TDS on this bill) or manual (the amount
  // entered). The tax is settled against the bill by a system payment
  // (payments.source = 'tds') so balances and statuses need no special case.
  tdsMode: text("tds_mode").default("auto").notNull(),
  tdsSection: text("tds_section"),
  tdsAmount: numeric("tds_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  // TCS (s.206C) collected from the customer on a sale, included in `total_amount`.
  // `tcs_mode`: auto (from the items' TCS sections) or none. The tax rows are in tax_deductions.
  tcsMode: text("tcs_mode").default("auto").notNull(),
  tcsAmount: numeric("tcs_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  source: text("source"),
  // E-Invoicing (IRP) fields
  irn: text("irn"),
  irnAckNumber: text("irn_ack_number"),
  irnAckDate: timestamp("irn_ack_date", { withTimezone: true }),
  signedQrCode: text("signed_qr_code"),
  signedInvoice: jsonb("signed_invoice"),
  eInvoiceStatus: text("e_invoice_status"),  // null | "pending" | "generated" | "cancelled" | "failed"
  eInvoiceError: text("e_invoice_error"),
  eInvoiceRetryCount: integer("e_invoice_retry_count").default(0),
  eInvoiceCancelReason: text("e_invoice_cancel_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("invoices_business_idx").on(t.businessId),
  index("invoices_party_idx").on(t.partyId),
  index("invoices_status_idx").on(t.businessId, t.status),
  index("invoices_date_idx").on(t.businessId, t.invoiceDate),
  uniqueIndex("invoices_number_idx").on(t.businessId, t.invoiceNumber),
  index("invoices_doc_type_idx").on(t.businessId, t.documentType),
  index("invoices_party_date_idx").on(t.businessId, t.partyId, t.invoiceDate),
  index("invoices_ref_doc_idx").on(t.referenceDocumentId),
  index("invoices_einvoice_status_idx").on(t.businessId, t.eInvoiceStatus),
  // Partial indexes for active records — nearly every query filters deletedAt IS NULL
  index("invoices_active_idx").on(t.businessId, t.invoiceDate).where(sql`deleted_at IS NULL`),
  index("invoices_active_type_idx").on(t.businessId, t.type, t.documentType, t.invoiceDate).where(sql`deleted_at IS NULL`),
]);

// ── Invoice Line Items ─────────────────────────────────────────

export const invoiceItems = pgTable("invoice_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
  // Snapshot of the item name at billing time. Required — frozen at create.
  // Preserves the name the customer was billed for even if the item is later renamed.
  itemName: text("item_name").notNull(),
  // Optional free-text line notes (e.g. "Keep separate from order #42").
  // Not populated by imports — only set when the user types something.
  description: text("description"),
  quantity: numeric("quantity", { precision: 15, scale: 3 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 15, scale: 2 }).notNull(),
  taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }).default("0").notNull(),
  taxAmount: numeric("tax_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).default("0").notNull(),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  selectedUnit: text("selected_unit"), // which unit was used (null = base unit)
  conversionFactor: numeric("conversion_factor", { precision: 10, scale: 4 }).default("1"), // how many base units per selected unit
  variantId: uuid("variant_id").references(() => itemVariants.id, { onDelete: "set null" }),
  // Free goods on the line ("10 + 1"), in the line's unit. They move stock
  // with the billed quantity but carry no price, so they add nothing to the
  // taxable value or the totals.
  freeQuantity: numeric("free_quantity", { precision: 15, scale: 3 }).default("0").notNull(),
  // Goods receipt notes only: received but rejected at inspection, in the
  // line's unit. `quantity` is what was accepted; rejected goods never enter
  // stock and stay pending on the purchase order.
  rejectedQuantity: numeric("rejected_quantity", { precision: 15, scale: 3 }).default("0").notNull(),
  rejectionReason: text("rejection_reason"),
  // The batch this line brought in or took out (items that track batches).
  batchId: uuid("batch_id").references(() => itemBatches.id, { onDelete: "set null" }),
}, (t) => [
  index("invoice_items_invoice_idx").on(t.invoiceId),
  index("invoice_items_batch_idx").on(t.batchId),
  index("invoice_items_item_idx").on(t.itemId),
  index("invoice_items_variant_idx").on(t.variantId),
]);

// ── Payments ───────────────────────────────────────────────────

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentNumber: text("payment_number"),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  partyId: uuid("party_id").notNull().references(() => parties.id, { onDelete: "restrict" }),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  discount: numeric("discount", { precision: 15, scale: 2 }).default("0").notNull(),
  // Income tax withheld from this payment (we deduct it from a supplier, or a
  // customer deducts it from us). `amount` is the gross that settles the
  // invoices; the bank moves `amount - tds_amount`.
  tdsAmount: numeric("tds_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  tdsSection: text("tds_section"),
  mode: paymentModeEnum("mode").notNull(),
  referenceNumber: text("reference_number"),
  paymentDate: timestamp("payment_date", { withTimezone: true }).defaultNow().notNull(),
  notes: text("notes"),
  bankAccountId: uuid("bank_account_id"),
  createdByUserId: uuid("created_by_user_id"),
  createdByName: text("created_by_name"),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("payments_business_idx").on(t.businessId),
  index("payments_invoice_idx").on(t.invoiceId),
  index("payments_party_idx").on(t.partyId),
  index("payments_date_idx").on(t.businessId, t.paymentDate),
  index("payments_party_date_idx").on(t.businessId, t.partyId, t.paymentDate),
  index("payments_active_idx").on(t.businessId, t.paymentDate).where(sql`deleted_at IS NULL`),
]);

// ── Payment Allocations (M:N link between payments and invoices) ──

export const paymentAllocations = pgTable("payment_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("payment_alloc_payment_idx").on(t.paymentId),
  index("payment_alloc_invoice_idx").on(t.invoiceId),
]);

// ── Period locks and year-end close ────────────────────────────
// A locked period cannot take new entries, edits or deletions. Two kinds:
//   books — everything dated on or before `locked_through` (one row per business),
//           set when a year is closed or by hand;
//   gst   — one row per return month ("2026-08") whose GST return is filed.
// Locking is for owners, admins and accountants; unlocking is owner-only and
// recorded in the audit log with a reason.
export const periodLocks = pgTable("period_locks", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  // books: the last Indian calendar day that is locked.
  lockedThrough: date("locked_through"),
  // gst: the return month, "YYYY-MM".
  returnPeriod: text("return_period"),
  note: text("note"),
  lockedByUserId: uuid("locked_by_user_id"),
  lockedByName: text("locked_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("period_locks_books_idx").on(t.businessId).where(sql`${t.kind} = 'books'`),
  uniqueIndex("period_locks_gst_idx").on(t.businessId, t.returnPeriod).where(sql`${t.kind} = 'gst'`),
]);

// One row per closed financial year: the closing balances carried into the next
// year (ledger accounts, stock, what customers owe and we owe), frozen at close.
export const financialYearCloses = pgTable("financial_year_closes", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  // "2025-26" (the business's own financial year).
  financialYear: text("financial_year").notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }).defaultNow().notNull(),
  closedByUserId: uuid("closed_by_user_id"),
  closedByName: text("closed_by_name"),
  note: text("note"),
  snapshot: jsonb("snapshot").notNull(),
}, (t) => [
  uniqueIndex("financial_year_closes_year_idx").on(t.businessId, t.financialYear),
]);

// ── Income-tax TDS / TCS ───────────────────────────────────────
// Rates and thresholds change most Budgets, so the defaults live in code
// (@fintranzact/shared tds.ts) and a business only stores what it overrides
// for a financial year. Null columns mean "use the default".

export const tdsSectionSettings = pgTable("tds_section_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  // "2026-27" — always April to March.
  financialYear: text("financial_year").notNull(),
  sectionCode: text("section_code").notNull(),
  rate: numeric("rate", { precision: 6, scale: 3 }),
  individualRate: numeric("individual_rate", { precision: 6, scale: 3 }),
  rateWithoutPan: numeric("rate_without_pan", { precision: 6, scale: 3 }),
  singleThreshold: numeric("single_threshold", { precision: 15, scale: 2 }),
  aggregateThreshold: numeric("aggregate_threshold", { precision: 15, scale: 2 }),
  // Turn a section off for the year (a business that never deducts it).
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("tds_section_settings_year_code_idx").on(t.businessId, t.financialYear, t.sectionCode),
]);

// GST composition scheme: the category a composition dealer is taxed under for
// a financial year (manufacturer_trader / restaurant / other_service) and, when
// the Government changes it, the rate to use instead of the code default
// (@fintranzact/shared composition.ts). Null rate = use the category default.
export const compositionSettings = pgTable("composition_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  // "2026-27" — always April to March.
  financialYear: text("financial_year").notNull(),
  category: text("category").notNull(),
  rate: numeric("rate", { precision: 6, scale: 3 }),
  // Per-year overrides of the built-in compliance defaults (shared composition.ts
  // COMPOSITION_DEFAULTS). Null = follow the default for that year.
  gstr4DueDate: date("gstr4_due_date"),
  interestRate: numeric("interest_rate", { precision: 6, scale: 3 }),
  lateFeePerDay: numeric("late_fee_per_day", { precision: 12, scale: 2 }),
  lateFeeCap: numeric("late_fee_cap", { precision: 12, scale: 2 }),
  lateFeeNilPerDay: numeric("late_fee_nil_per_day", { precision: 12, scale: 2 }),
  lateFeeNilCap: numeric("late_fee_nil_cap", { precision: 12, scale: 2 }),
  cmp08DueDay: integer("cmp08_due_day"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("composition_settings_year_idx").on(t.businessId, t.financialYear),
]);

// Tax deposited with the government. One challan can cover many deductions.
export const taxChallans = pgTable("tax_challans", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  // "tds" (tax deducted) or "tcs" (tax collected).
  kind: text("kind").notNull(),
  financialYear: text("financial_year").notNull(),
  quarter: integer("quarter").notNull(),
  // ITNS 281 challan serial number and the 7-digit BSR code of the bank branch.
  challanNumber: text("challan_number").notNull(),
  bsrCode: text("bsr_code").notNull(),
  depositedOn: timestamp("deposited_on", { withTimezone: true }).notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  interest: numeric("interest", { precision: 15, scale: 2 }).default("0").notNull(),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("tax_challans_cin_idx").on(t.businessId, t.kind, t.bsrCode, t.challanNumber, t.depositedOn),
  index("tax_challans_period_idx").on(t.businessId, t.kind, t.financialYear, t.quarter),
]);

// One row per amount of TDS/TCS deducted or collected.
//   payable    — we withheld it from a supplier (TDS) or collected it from a
//                customer (TCS); it is owed to the government.
//   receivable — a customer withheld it from what they paid us; it is a credit
//                we claim against our own tax.
export const taxDeductions = pgTable("tax_deductions", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  direction: text("direction").notNull(),
  partyId: uuid("party_id").notNull().references(() => parties.id, { onDelete: "restrict" }),
  paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  // TDS withheld on an expense entry (rent, professional fees…) points here.
  expenseId: uuid("expense_id").references(() => expenses.id, { onDelete: "cascade" }),
  sectionCode: text("section_code").notNull(),
  financialYear: text("financial_year").notNull(),
  quarter: integer("quarter").notNull(),
  // The amount the tax was worked out on, the percent used, and the tax.
  baseAmount: numeric("base_amount", { precision: 15, scale: 2 }).notNull(),
  rate: numeric("rate", { precision: 6, scale: 3 }).notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  hasPan: boolean("has_pan").default(true).notNull(),
  deductedOn: timestamp("deducted_on", { withTimezone: true }).notNull(),
  // Set once the tax is deposited (payable) — links to the challan.
  challanId: uuid("challan_id").references(() => taxChallans.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("tax_deductions_period_idx").on(t.businessId, t.kind, t.direction, t.financialYear, t.quarter),
  index("tax_deductions_party_year_idx").on(t.businessId, t.partyId, t.financialYear, t.sectionCode),
  index("tax_deductions_payment_idx").on(t.paymentId),
  index("tax_deductions_expense_idx").on(t.expenseId),
  index("tax_deductions_challan_idx").on(t.challanId),
]);

// History of payment reminders sent (or prepared) for an invoice. One row per
// (invoice, channel, slot_key): the scheduler claims a slot by inserting its
// row BEFORE sending, so a restart or a second instance never sends it twice.
//   channel  - email | sms | whatsapp
//   kind     - before_due | on_due | after_due | manual
//   slot_key - "before", "due", "after_<n>" for the schedule; "manual:<uuid>" for a hand-sent one
//   trigger  - auto (scheduler) | manual (a person pressed Send)
//   status   - sending | sent | failed | link_opened (WhatsApp link handed over)
//   recipient - masked address, never the full email or number
export const paymentReminders = pgTable("payment_reminders", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  kind: text("kind").notNull(),
  slotKey: text("slot_key").notNull(),
  trigger: text("trigger").notNull(),
  status: text("status").notNull(),
  recipient: text("recipient"),
  error: text("error"),
  // No FK to users (control schema); null for the scheduler.
  sentByUserId: uuid("sent_by_user_id"),
  sentByName: text("sent_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("payment_reminders_slot_idx").on(t.invoiceId, t.channel, t.slotKey),
  index("payment_reminders_invoice_idx").on(t.businessId, t.invoiceId, t.createdAt),
]);

// Which TDS/TCS due-date reminder emails have gone out, so the scheduler sends
// each one once. item_key names the item (e.g. "deposit:tds:2026-27:2026-09");
// day_offset is 7 (within a week of the due date), 0 (due today) or -1 (overdue).
export const tdsReminderLog = pgTable("tds_reminder_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  itemKey: text("item_key").notNull(),
  dayOffset: integer("day_offset").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("tds_reminder_log_item_idx").on(t.businessId, t.itemKey, t.dayOffset),
]);

// Rows imported from a Form 26AS / AIS TDS export: what customers report as
// deducted from us. Whether a row agrees with our books is worked out live
// (tds.reconciliation26as); only the manual outcome is stored.
//   party_id — the customer this deductor is, set by a manual link (or carried
//              over from an earlier import with the same TAN); null = match by name.
//   status   — "pending" (reconcile live) or "ignored" (left out of the sums).
// Importing a financial year again replaces that year's rows.
export const tds26asEntries = pgTable("tds_26as_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  importBatchId: uuid("import_batch_id").notNull(),
  financialYear: text("financial_year").notNull(),
  quarter: integer("quarter").notNull(),
  deductorTan: text("deductor_tan").notNull(),
  deductorName: text("deductor_name"),
  // As printed in the file ("194C", "194J(b)"…).
  section: text("section").notNull(),
  txnDate: timestamp("txn_date", { withTimezone: true }).notNull(),
  amountPaid: numeric("amount_paid", { precision: 15, scale: 2 }).default("0").notNull(),
  taxDeducted: numeric("tax_deducted", { precision: 15, scale: 2 }).notNull(),
  // Null when the file has no deposited column.
  taxDeposited: numeric("tax_deposited", { precision: 15, scale: 2 }),
  partyId: uuid("party_id").references(() => parties.id, { onDelete: "set null" }),
  status: text("status").default("pending").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("tds_26as_entries_year_idx").on(t.businessId, t.financialYear, t.quarter),
  index("tds_26as_entries_tan_idx").on(t.businessId, t.deductorTan),
]);

// ── Expenses ───────────────────────────────────────────────────

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  description: text("description"),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  mode: paymentModeEnum("mode").notNull(),
  expenseDate: timestamp("expense_date", { withTimezone: true }).defaultNow().notNull(),
  referenceNumber: text("reference_number"),
  bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
  // Payee (landlord, consultant…) — set when TDS is withheld from the payment.
  partyId: uuid("party_id").references(() => parties.id, { onDelete: "set null" }),
  // "none" (no TDS) or "auto" / "manual" when TDS is deducted. The expense
  // amount is gross; the bank moves amount - tds_amount.
  tdsMode: text("tds_mode").default("none").notNull(),
  tdsSection: text("tds_section"),
  tdsAmount: numeric("tds_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  createdByUserId: uuid("created_by_user_id"),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("expenses_business_idx").on(t.businessId),
  index("expenses_date_idx").on(t.businessId, t.expenseDate),
  index("expenses_category_idx").on(t.businessId, t.category),
  index("expenses_active_idx").on(t.businessId, t.expenseDate).where(sql`deleted_at IS NULL`),
]);

// ── Bank Accounts ──────────────────────────────────────────────

export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  accountName: text("account_name").notNull(),
  accountNumber: text("account_number"),
  ifsc: text("ifsc"),
  bankName: text("bank_name"),
  accountType: bankAccountTypeEnum("account_type").default("savings").notNull(),
  openingBalance: numeric("opening_balance", { precision: 15, scale: 2 }).default("0").notNull(),
  currentBalance: numeric("current_balance", { precision: 15, scale: 2 }).default("0").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("bank_accounts_business_idx").on(t.businessId),
]);

// ── Bank Transactions ───────────────────────────────────────────

export const bankTransactions = pgTable("bank_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id, { onDelete: "cascade" }),
  type: bankTransactionTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  description: text("description"),
  referenceType: text("reference_type"),
  referenceId: uuid("reference_id"),
  paymentId: uuid("payment_id"), // links gateway charge/settlement txns to originating payment
  transactionDate: timestamp("transaction_date", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("bank_txn_business_idx").on(t.businessId),
  index("bank_txn_account_idx").on(t.bankAccountId),
  index("bank_txn_date_idx").on(t.bankAccountId, t.transactionDate),
  index("bank_txn_ref_idx").on(t.referenceType, t.referenceId),
  index("bank_txn_payment_idx").on(t.paymentId),
]);

// ── Payment Gateway Configs ───────────────────────────────────

export const paymentGatewayConfigs = pgTable("payment_gateway_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id, { onDelete: "cascade" }),
  settlementAccountId: uuid("settlement_account_id").notNull().references(() => bankAccounts.id, { onDelete: "restrict" }),
  chargeConfig: jsonb("charge_config").notNull().$type<{
    credit_card?: { type: "percentage" | "flat"; value: string };
    debit_card?: { type: "percentage" | "flat"; value: string };
    upi?: { type: "percentage" | "flat"; value: string };
    net_banking?: { type: "percentage" | "flat"; value: string };
    wallet?: { type: "percentage" | "flat"; value: string };
    default?: { type: "percentage" | "flat"; value: string };
  }>(),
  expenseCategory: text("expense_category").default("Payment Gateway Charges").notNull(),
  autoSettle: boolean("auto_settle").default(true).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("pg_config_account_idx").on(t.bankAccountId),
  index("pg_config_business_idx").on(t.businessId),
]);

export const paymentGatewayConfigsRelations = relations(paymentGatewayConfigs, ({ one }) => ({
  business: one(businesses, { fields: [paymentGatewayConfigs.businessId], references: [businesses.id] }),
  bankAccount: one(bankAccounts, { fields: [paymentGatewayConfigs.bankAccountId], references: [bankAccounts.id] }),
  settlementAccount: one(bankAccounts, { fields: [paymentGatewayConfigs.settlementAccountId], references: [bankAccounts.id] }),
}));

// ── Online payments (the business's own Razorpay account) ─────
// Each business pastes ITS OWN Razorpay API keys; customer money goes straight
// to that account. Key id, key secret and webhook secret are encrypted at rest
// (field encryption, ENCRYPTION_KEY) and never returned to a client. The
// webhook URL carries "<tenantId>.<random token>": the token is stored hashed
// (lookup) and encrypted (so the owner can see the URL again).

export const razorpayConnections = pgTable("razorpay_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  keyIdEncrypted: text("key_id_encrypted").notNull(),
  keySecretEncrypted: text("key_secret_encrypted").notNull(),
  webhookSecretEncrypted: text("webhook_secret_encrypted"),
  /** Masked key id for display, e.g. "rzp_live_••••AbCd". Safe to return. */
  keyIdMasked: text("key_id_masked").notNull(),
  /** "test" or "live", from the key id prefix. */
  mode: text("mode").notNull(),
  webhookTokenHash: text("webhook_token_hash").notNull(),
  webhookTokenEncrypted: text("webhook_token_encrypted").notNull(),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  lastTestOk: boolean("last_test_ok"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("razorpay_conn_business_idx").on(t.businessId),
  uniqueIndex("razorpay_conn_token_idx").on(t.webhookTokenHash),
]);

// A Razorpay payment link created for an invoice's balance due. At most one
// active (created / partially_paid) link per invoice.
export const invoicePaymentLinks = pgTable("invoice_payment_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  razorpayLinkId: text("razorpay_link_id").notNull(),
  shortUrl: text("short_url").notNull(),
  amountPaise: integer("amount_paise").notNull(),
  /** created | partially_paid | paid | cancelled | expired */
  status: text("status").default("created").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("inv_pay_link_rzp_idx").on(t.businessId, t.razorpayLinkId),
  index("inv_pay_link_invoice_idx").on(t.invoiceId),
  uniqueIndex("inv_pay_link_active_idx").on(t.invoiceId).where(sql`status IN ('created', 'partially_paid')`),
]);

// One row per Razorpay payment recorded against an invoice: the dedupe key
// (a redelivered webhook never records twice) and the gateway's own figures.
export const razorpayPayments = pgTable("razorpay_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  razorpayPaymentId: text("razorpay_payment_id").notNull(),
  paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  razorpayLinkId: text("razorpay_link_id"),
  amountPaise: integer("amount_paise").notNull(),
  feePaise: integer("fee_paise"),
  taxPaise: integer("tax_paise"),
  method: text("method"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("rzp_payments_unique_idx").on(t.businessId, t.razorpayPaymentId),
]);

// ── Stock Adjustments ─────────────────────────────────────────

export const stockAdjustments = pgTable("stock_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").references(() => itemVariants.id, { onDelete: "cascade" }),
  // +ve = stock added, -ve = stock removed
  quantity: numeric("quantity", { precision: 15, scale: 3 }).notNull(),
  previousStock: numeric("previous_stock", { precision: 15, scale: 3 }).notNull(),
  newStock: numeric("new_stock", { precision: 15, scale: 3 }).notNull(),
  reason: text("reason"), // e.g. "Damaged goods", "Physical count correction", "Opening stock"
  adjustmentDate: timestamp("adjustment_date", { withTimezone: true }).defaultNow().notNull(),
  createdByUserId: uuid("created_by_user_id"),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("stock_adj_business_idx").on(t.businessId),
  index("stock_adj_item_idx").on(t.itemId),
  index("stock_adj_variant_idx").on(t.variantId),
  index("stock_adj_date_idx").on(t.businessId, t.adjustmentDate),
]);

// ── Physical stock counts (barcode scans) ─────────────────────
// One row per finished scan session. `lines` is the report as it stood when
// the count ended (books vs scanned per item), so a saved report still reads
// the same after stock moves on. `posted` means its differences were applied
// as stock adjustments.

export const physicalStockCounts = pgTable("physical_stock_counts", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id, { onDelete: "cascade" }),
  status: text("status").default("saved").notNull(), // saved | posted
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
  scanCount: integer("scan_count").default(0).notNull(),
  note: text("note"),
  lines: jsonb("lines").$type<Array<{
    itemId: string;
    variantId: string | null;
    name: string;
    books: string;
    scanned: string;
    unitCost: string | null;
  }>>().notNull(),
  unknownCodes: jsonb("unknown_codes").$type<Array<{ code: string; count: number }>>().notNull(),
  notCounted: jsonb("not_counted").$type<Array<{ itemId: string; variantId: string | null; name: string; books: string }>>().notNull(),
  adjustedCount: integer("adjusted_count").default(0).notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id"),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("physical_counts_business_idx").on(t.businessId, t.createdAt),
]);

// ── Bill of materials ─────────────────────────────────────────
// What it takes to make an item (Tally's BOM): components per `outputQuantity`
// of the finished item, plus any by-products or scrap it gives off.
// Quantities are in each item's base unit.

export const boms = pgTable("boms", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").references(() => itemVariants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  outputQuantity: numeric("output_quantity", { precision: 15, scale: 3 }).default("1").notNull(),
  // The BOM the manufacture form picks first for this item.
  isDefault: boolean("is_default").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("boms_business_idx").on(t.businessId),
  index("boms_item_idx").on(t.businessId, t.itemId),
]);

export const bomComponents = pgTable("bom_components", {
  id: uuid("id").primaryKey().defaultRandom(),
  bomId: uuid("bom_id").notNull().references(() => boms.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").references(() => itemVariants.id, { onDelete: "cascade" }),
  // Needed per the BOM's output quantity, before wastage.
  quantity: numeric("quantity", { precision: 15, scale: 3 }).notNull(),
  unit: text("unit"),
  // Extra consumed on top of `quantity`, e.g. 5 = 5% more.
  wastagePercent: numeric("wastage_percent", { precision: 6, scale: 2 }).default("0").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
}, (t) => [
  index("bom_components_bom_idx").on(t.bomId),
  index("bom_components_item_idx").on(t.itemId),
]);

export const bomByProducts = pgTable("bom_by_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  bomId: uuid("bom_id").notNull().references(() => boms.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").references(() => itemVariants.id, { onDelete: "cascade" }),
  // Given off per the BOM's output quantity.
  quantity: numeric("quantity", { precision: 15, scale: 3 }).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
}, (t) => [
  index("bom_by_products_bom_idx").on(t.bomId),
]);

// ── Manufacturing journal ─────────────────────────────────────
// One production run: components leave the source warehouse, the finished
// item (and any by-products) arrive in the destination warehouse. The stock
// itself moves through stock_movements (reference MANUFACTURING); this is the
// voucher and its costing. Cancelling reverses the movements.

export const manufacturingJournals = pgTable("manufacturing_journals", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  journalNumber: text("journal_number").notNull(),
  journalDate: timestamp("journal_date", { withTimezone: true }).notNull(),
  bomId: uuid("bom_id").references(() => boms.id, { onDelete: "set null" }),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").references(() => itemVariants.id, { onDelete: "cascade" }),
  quantity: numeric("quantity", { precision: 15, scale: 3 }).notNull(),
  sourceWarehouseId: uuid("source_warehouse_id").notNull().references(() => warehouses.id, { onDelete: "cascade" }),
  destinationWarehouseId: uuid("destination_warehouse_id").notNull().references(() => warehouses.id, { onDelete: "cascade" }),
  componentsCost: numeric("components_cost", { precision: 15, scale: 2 }).default("0").notNull(),
  additionalCosts: jsonb("additional_costs").$type<Array<{ label: string; amount: string }>>().default([]).notNull(),
  additionalCostTotal: numeric("additional_cost_total", { precision: 15, scale: 2 }).default("0").notNull(),
  // Cost of the finished quantity: components + additional costs.
  totalCost: numeric("total_cost", { precision: 15, scale: 2 }).default("0").notNull(),
  unitCost: numeric("unit_cost", { precision: 15, scale: 4 }).default("0").notNull(),
  notes: text("notes"),
  status: text("status").default("posted").notNull(), // posted | cancelled
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledByUserId: uuid("cancelled_by_user_id"),
  createdByUserId: uuid("created_by_user_id"),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("manufacturing_journals_number_idx").on(t.businessId, t.journalNumber),
  index("manufacturing_journals_date_idx").on(t.businessId, t.journalDate),
  index("manufacturing_journals_item_idx").on(t.itemId),
]);

export const manufacturingJournalLines = pgTable("manufacturing_journal_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  journalId: uuid("journal_id").notNull().references(() => manufacturingJournals.id, { onDelete: "cascade" }),
  kind: text("kind").default("component").notNull(), // component | by_product
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").references(() => itemVariants.id, { onDelete: "cascade" }),
  // What the BOM called for at this production quantity (null without a BOM line).
  standardQuantity: numeric("standard_quantity", { precision: 15, scale: 3 }),
  // What was actually consumed (components) or given off (by-products).
  quantity: numeric("quantity", { precision: 15, scale: 3 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 15, scale: 4 }).default("0").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).default("0").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
}, (t) => [
  index("manufacturing_journal_lines_journal_idx").on(t.journalId),
]);

// ── Stock Balances ────────────────────────────────────────────
// Current stock state per business, warehouse, location and item/variant.
// This table stores the latest inventory balance, not the movement history.

export const stockBalances = pgTable("stock_balances", {
  id: uuid("id").primaryKey().defaultRandom(),

  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),

  warehouseId: uuid("warehouse_id")
    .notNull()
    .references(() => warehouses.id, { onDelete: "cascade" }),

  locationId: uuid("location_id")
    .references(() => warehouseLocations.id, { onDelete: "set null" }),

  itemId: uuid("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),

  // Null when the item is a simple item.
  // Set when the item uses variants.
  variantId: uuid("variant_id")
    .references(() => itemVariants.id, { onDelete: "cascade" }),

  // Physical quantity currently held at this warehouse/location.
  quantity: numeric("quantity", {
    precision: 15,
    scale: 3,
  }).default("0").notNull(),

  // Quantity reserved for orders/documents but not yet consumed.
  reservedQuantity: numeric("reserved_quantity", {
    precision: 15,
    scale: 3,
  }).default("0").notNull(),

  // Quantity physically present but marked damaged.
  damagedQuantity: numeric("damaged_quantity", {
    precision: 15,
    scale: 3,
  }).default("0").notNull(),

  // Quantity physically present but blocked from normal use.
  blockedQuantity: numeric("blocked_quantity", {
    precision: 15,
    scale: 3,
  }).default("0").notNull(),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  }).defaultNow().notNull(),

  updatedAt: timestamp("updated_at", {
    withTimezone: true,
  }).defaultNow().notNull(),
}, (t) => [
  index("stock_balances_business_idx").on(t.businessId),
  index("stock_balances_warehouse_idx").on(t.warehouseId),
  index("stock_balances_location_idx").on(t.locationId),
  index("stock_balances_item_idx").on(t.itemId),
  index("stock_balances_variant_idx").on(t.variantId),

  // Simple item balance: no location, no variant.
  uniqueIndex("stock_balances_base_unique_idx")
    .on(
      t.businessId,
      t.warehouseId,
      t.itemId,
    )
    .where(sql`${t.locationId} is null and ${t.variantId} is null`),

  // Location-specific balance for a simple item.
  uniqueIndex("stock_balances_location_unique_idx")
    .on(
      t.businessId,
      t.warehouseId,
      t.locationId,
      t.itemId,
    )
    .where(sql`${t.locationId} is not null and ${t.variantId} is null`),

  // Variant balance without a specific location.
  uniqueIndex("stock_balances_variant_unique_idx")
    .on(
      t.businessId,
      t.warehouseId,
      t.itemId,
      t.variantId,
    )
    .where(sql`${t.locationId} is null and ${t.variantId} is not null`),

  // Variant balance at a specific location.
  uniqueIndex("stock_balances_location_variant_unique_idx")
    .on(
      t.businessId,
      t.warehouseId,
      t.locationId,
      t.itemId,
      t.variantId,
    )
    .where(
      sql`${t.locationId} is not null and ${t.variantId} is not null`,
    ),
]);

export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").primaryKey().defaultRandom(),

  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),

  warehouseId: uuid("warehouse_id")
    .notNull()
    .references(() => warehouses.id, { onDelete: "cascade" }),

  sourceWarehouseId: uuid("source_warehouse_id")
    .references(() => warehouses.id, { onDelete: "set null" }),

  destinationWarehouseId: uuid("destination_warehouse_id")
    .references(() => warehouses.id, { onDelete: "set null" }),

  locationId: uuid("location_id")
    .references(() => warehouseLocations.id, { onDelete: "set null" }),

  itemId: uuid("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),

  variantId: uuid("variant_id")
    .references(() => itemVariants.id, { onDelete: "cascade" }),

  // Set for items that track batches: the batch this stock belongs to.
  batchId: uuid("batch_id")
    .references(() => itemBatches.id, { onDelete: "set null" }),

  serialId: uuid("serial_id"),

  referenceType: text("reference_type").notNull(),

  referenceId: uuid("reference_id"),

  movementType: text("movement_type").notNull(),

  quantity: numeric("quantity", {
    precision: 15,
    scale: 3,
  }).notNull(),

  unitCost: numeric("unit_cost", {
    precision: 15,
    scale: 2,
  }),

  movementDate: timestamp("movement_date", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),

  actorUserId: uuid("actor_user_id"),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
}, (t) => [
  index("stock_movements_business_idx").on(t.businessId),
  index("stock_movements_warehouse_idx").on(t.warehouseId),
  index("stock_movements_source_warehouse_idx").on(t.sourceWarehouseId),
  index("stock_movements_destination_warehouse_idx").on(t.destinationWarehouseId),
  index("stock_movements_location_idx").on(t.locationId),
  index("stock_movements_item_idx").on(t.itemId),
  index("stock_movements_variant_idx").on(t.variantId),
  index("stock_movements_batch_idx").on(t.batchId),
  index("stock_movements_serial_idx").on(t.serialId),
  index("stock_movements_reference_idx").on(
    t.referenceType,
    t.referenceId,
  ),
  index("stock_movements_date_idx").on(t.movementDate),
]);

// ── Sales Targets ─────────────────────────────────────────────

export const salesTargets = pgTable("sales_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(), // the seller this target is for — no FK (users live in control schema)

  // Target type — what metric to track
  targetType: text("target_type").notNull(), // "order_count" | "order_value" | "item_quantity"

  // Target value
  targetValue: numeric("target_value", { precision: 15, scale: 2 }).notNull(), // e.g., 50 orders, ₹500000, 1000 units

  // Optional: specific item the target applies to (null = all items)
  itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),

  // Period
  periodType: text("period_type").notNull(), // "daily" | "weekly" | "monthly" | "quarterly" | "custom"
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),

  // Metadata
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("sales_targets_business_idx").on(t.businessId),
  index("sales_targets_user_idx").on(t.businessId, t.userId),
  index("sales_targets_period_idx").on(t.businessId, t.periodStart, t.periodEnd),
]);

// ── Audit Log ──────────────────────────────────────────────────

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  // No FK to users — plain UUID, users live in control schema (different DB in cloud mode)
  userId: uuid("user_id").notNull(),
  action: text("action").notNull(), // e.g., "invoice.create", "payment.delete"
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  metadata: text("metadata"), // JSON string of changes
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("audit_log_business_idx").on(t.businessId),
  index("audit_log_entity_idx").on(t.entityType, t.entityId),
  index("audit_log_date_idx").on(t.businessId, t.createdAt),
]);

// ── Shipments ─────────────────────────────────────────────────

export const shipmentStatusEnum = pgEnum("shipment_status", [
  "pending", "shipped", "in_transit", "delivered", "returned",
]);

export const shipments = pgTable("shipments", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  partyId: uuid("party_id").references(() => parties.id, { onDelete: "set null" }),
  // Shipping details
  carrier: text("carrier"),                     // e.g. "Delhivery", "BlueDart", "Self", "Transport"
  mode: text("mode"),                           // e.g. "courier", "transport", "hand_delivery", "post"
  trackingNumber: text("tracking_number"),
  trackingUrl: text("tracking_url"),
  // Costs & weight
  cost: numeric("cost", { precision: 15, scale: 2 }).default("0").notNull(),
  weight: numeric("weight", { precision: 10, scale: 3 }),  // in kg
  // Addresses
  shippingAddress: text("shipping_address"),
  shippingCity: text("shipping_city"),
  shippingPincode: text("shipping_pincode"),
  // Carrier API integration (future-proofing)
  carrierOrderId: text("carrier_order_id"),    // carrier's internal order/AWB ID
  labelUrl: text("label_url"),                  // shipping label PDF URL from carrier
  manifestId: text("manifest_id"),              // carrier manifest/pickup ID
  carrierMeta: jsonb("carrier_meta"),           // carrier-specific data (weight slabs, dimensions, COD, etc.)
  // Status & dates
  status: shipmentStatusEnum("status").default("pending").notNull(),
  shipmentDate: timestamp("shipment_date", { withTimezone: true }),
  estimatedDelivery: timestamp("estimated_delivery", { withTimezone: true }),
  actualDelivery: timestamp("actual_delivery", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("shipments_business_idx").on(t.businessId),
  index("shipments_invoice_idx").on(t.invoiceId),
  index("shipments_party_idx").on(t.partyId),
  index("shipments_status_idx").on(t.businessId, t.status),
  index("shipments_date_idx").on(t.businessId, t.shipmentDate),
  index("shipments_carrier_order_idx").on(t.carrierOrderId),
]);

// Shipment status timeline — each event is a scan/status update from carrier or manual
export const shipmentEvents = pgTable("shipment_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
  status: text("status").notNull(),               // our status or carrier-specific status string
  statusDetail: text("status_detail"),             // human-readable detail (e.g. "Package arrived at Mumbai hub")
  location: text("location"),                      // scan location from carrier
  source: text("source").default("manual"),        // "manual" | "webhook" | "api_poll"
  carrierStatus: text("carrier_status"),           // raw carrier status code before mapping
  eventTime: timestamp("event_time", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("shipment_events_shipment_idx").on(t.shipmentId),
  index("shipment_events_time_idx").on(t.shipmentId, t.eventTime),
]);

// ── Store Orders ───────────────────────────────────────────────

export const storeOrderStatusEnum = pgEnum("store_order_status", [
  "pending", "confirmed", "preparing", "ready", "delivered", "cancelled",
]);

export const storeOrders = pgTable("store_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  orderNumber: text("order_number").notNull(),
  status: storeOrderStatusEnum("status").default("pending").notNull(),
  // Customer info (not a party — anonymous store customer)
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerEmail: text("customer_email"),
  deliveryAddress: text("delivery_address"),
  deliveryCity: text("delivery_city"),
  deliveryPincode: text("delivery_pincode"),
  deliveryNotes: text("delivery_notes"),
  // Totals (denormalized from invoice for quick display)
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  itemCount: integer("item_count").default(0).notNull(),
  source: text("source").default("online_store").notNull(), // extensible: "whatsapp", "shopify"
  // Lifecycle timestamps
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
  // How the shopper chose to pay, and where the money stands: unpaid | paid |
  // partially_refunded | refunded. Cash on Delivery orders stay unpaid here
  // (the owner records that cash on the invoice); only Razorpay moves it.
  paymentMethod: text("payment_method").default("cod").notNull(),
  paymentStatus: text("payment_status").default("unpaid").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  refundedAmount: numeric("refunded_amount", { precision: 15, scale: 2 }).default("0").notNull(),
  // When the shopper was last emailed that a payment failed (so a redelivered
  // webhook or a second failed attempt does not send the same email again).
  paymentFailedEmailedAt: timestamp("payment_failed_emailed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("store_orders_business_idx").on(t.businessId),
  index("store_orders_status_idx").on(t.businessId, t.status),
  index("store_orders_date_idx").on(t.businessId, t.createdAt),
  index("store_orders_phone_idx").on(t.businessId, t.customerPhone),
  uniqueIndex("store_orders_number_idx").on(t.businessId, t.orderNumber),
  index("store_orders_invoice_idx").on(t.invoiceId),
]);

// A refund of a paid online store order, made through the business's own
// Razorpay account. The client-supplied idempotency key (unique per business)
// makes a retried request return the first result instead of refunding twice;
// the row is written "pending" before Razorpay is called.
export const storeOrderRefunds = pgTable("store_order_refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  storeOrderId: uuid("store_order_id").notNull().references(() => storeOrders.id, { onDelete: "cascade" }),
  razorpayPaymentId: text("razorpay_payment_id").notNull(),
  razorpayRefundId: text("razorpay_refund_id"),
  amountPaise: integer("amount_paise").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  /** pending | processed | failed */
  status: text("status").default("pending").notNull(),
  reason: text("reason"),
  /** The credit note (partial refund) or sales return (full refund on a cancelled order) that books it. */
  creditNoteId: uuid("credit_note_id").references(() => invoices.id, { onDelete: "set null" }),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("store_order_refunds_key_idx").on(t.businessId, t.idempotencyKey),
  index("store_order_refunds_order_idx").on(t.storeOrderId),
]);

// ── Recurring Invoice Templates ────────────────────────────────

export const recurringInvoiceTemplates = pgTable("recurring_invoice_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  partyId: uuid("party_id").notNull().references(() => parties.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  type: invoiceTypeEnum("type").notNull(),
  frequency: recurringFrequencyEnum("frequency").notNull(),
  customIntervalDays: integer("custom_interval_days"), // only when frequency = 'custom'
  lineItems: jsonb("line_items").$type<Array<{
    itemId?: string;
    itemName: string;
    description?: string | null;
    quantity: string;
    unitPrice: string;
    taxPercent: string;
    discountPercent: string;
    selectedUnit?: string | null;
    conversionFactor?: string | null;
    variantId?: string | null;
  }>>().notNull(),
  notes: text("notes"),
  termsAndConditions: text("terms_and_conditions"),
  additionalCharges: numeric("additional_charges", { precision: 15, scale: 2 }).default("0").notNull(),
  charges: jsonb("charges").$type<Array<{ label: string; amount: string }>>(),
  status: recurringTemplateStatusEnum("status").default("active").notNull(),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }),
  nextRunDate: timestamp("next_run_date", { withTimezone: true }).notNull(),
  lastRunDate: timestamp("last_run_date", { withTimezone: true }),
  totalRuns: integer("total_runs").default(0).notNull(),
  maxRuns: integer("max_runs"), // null = unlimited
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("recurring_tpl_business_idx").on(t.businessId),
  index("recurring_tpl_party_idx").on(t.partyId),
  index("recurring_tpl_status_idx").on(t.businessId, t.status),
  index("recurring_tpl_next_run_idx").on(t.status, t.nextRunDate),
]);

// ── Recurring Invoice Runs (execution history) ────────────────

export const recurringInvoiceRuns = pgTable("recurring_invoice_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").notNull().references(() => recurringInvoiceTemplates.id, { onDelete: "cascade" }),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  status: recurringRunStatusEnum("status").notNull(),
  errorMessage: text("error_message"),
  executedAt: timestamp("executed_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("recurring_run_template_idx").on(t.templateId),
  index("recurring_run_business_idx").on(t.businessId),
  index("recurring_run_executed_idx").on(t.businessId, t.executedAt),
]);

// ── Chart of Accounts ──────────────────────────────────────────

export const chartOfAccounts = pgTable("chart_of_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  accountType: accountTypeEnum("account_type").notNull(),
  parentId: uuid("parent_id"),  // self-ref for hierarchy, null = root
  isSystem: boolean("is_system").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("coa_business_idx").on(t.businessId),
  uniqueIndex("coa_business_code_idx").on(t.businessId, t.code),
  index("coa_parent_idx").on(t.parentId),
  index("coa_type_idx").on(t.businessId, t.accountType),
]);

// ── Journal Entries (manual double-entry for CA adjustments) ──

export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  entryNumber: text("entry_number").notNull(),
  entryDate: timestamp("entry_date", { withTimezone: true }).notNull(),
  narration: text("narration"),
  source: text("source").default("manual").notNull(), // "manual" | "system"
  isVoided: boolean("is_voided").default(false).notNull(),
  voidedByEntryId: uuid("voided_by_entry_id"),   // points to the reversing entry
  reversesEntryId: uuid("reverses_entry_id"),     // on the reversal, points to original
  createdByUserId: uuid("created_by_user_id"),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("je_business_idx").on(t.businessId),
  index("je_date_idx").on(t.businessId, t.entryDate),
  uniqueIndex("je_number_idx").on(t.businessId, t.entryNumber),
]);

export const journalEntryLines = pgTable("journal_entry_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  journalEntryId: uuid("journal_entry_id").notNull().references(() => journalEntries.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => chartOfAccounts.id, { onDelete: "restrict" }),
  debit: numeric("debit", { precision: 15, scale: 2 }).default("0").notNull(),
  credit: numeric("credit", { precision: 15, scale: 2 }).default("0").notNull(),
  narration: text("narration"),
}, (t) => [
  index("jel_entry_idx").on(t.journalEntryId),
  index("jel_account_idx").on(t.accountId),
]);

// ── Journal Entry Templates ──────────────────────────────────

export const journalEntryTemplates = pgTable("journal_entry_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  narration: text("narration"),
  lines: jsonb("lines").$type<Array<{
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: string;
    credit: string;
    narration?: string;
  }>>().notNull(),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("jet_business_idx").on(t.businessId),
]);

// ── ITC (Input Tax Credit) Tracking ─────────────────────────

export const itcStatusEnum = pgEnum("itc_status", [
  "available",    // ITC available for utilization
  "utilized",     // ITC utilized against output liability
  "reversed",     // ITC reversed (180-day rule, ineligibility, etc.)
  "reclaimed",    // ITC re-availed after reversal
  "blocked",      // Blocked under Section 17(5)
]);

export const itcLedgerEntries = pgTable("itc_ledger_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  returnPeriod: text("return_period").notNull(),  // "2026-04" format
  status: itcStatusEnum("status").notNull(),
  cgst: numeric("cgst", { precision: 15, scale: 2 }).default("0").notNull(),
  sgst: numeric("sgst", { precision: 15, scale: 2 }).default("0").notNull(),
  igst: numeric("igst", { precision: 15, scale: 2 }).default("0").notNull(),
  cess: numeric("cess", { precision: 15, scale: 2 }).default("0").notNull(),
  isReverseCharge: boolean("is_reverse_charge").default(false).notNull(),
  blockReason: text("block_reason"),   // "motor_vehicle", "food_beverage", "personal", "membership", etc.
  reversalReason: text("reversal_reason"),  // "section_16_4_180_days", "rule_42", "rule_43", "section_17_5"
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("itc_business_idx").on(t.businessId),
  index("itc_invoice_idx").on(t.invoiceId),
  index("itc_period_idx").on(t.businessId, t.returnPeriod),
  index("itc_status_idx").on(t.businessId, t.status),
]);

export const itcUtilizations = pgTable("itc_utilizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  returnPeriod: text("return_period").notNull(),  // "2026-04"
  cgstUtilized: numeric("cgst_utilized", { precision: 15, scale: 2 }).default("0").notNull(),
  sgstUtilized: numeric("sgst_utilized", { precision: 15, scale: 2 }).default("0").notNull(),
  igstUtilizedAgainstCgst: numeric("igst_utilized_against_cgst", { precision: 15, scale: 2 }).default("0").notNull(),
  igstUtilizedAgainstSgst: numeric("igst_utilized_against_sgst", { precision: 15, scale: 2 }).default("0").notNull(),
  igstUtilizedAgainstIgst: numeric("igst_utilized_against_igst", { precision: 15, scale: 2 }).default("0").notNull(),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("itc_util_business_idx").on(t.businessId),
  uniqueIndex("itc_util_period_idx").on(t.businessId, t.returnPeriod),
]);

// ── Bank Statement Templates ─────────────────────────────────

export const bankStatementTemplates = pgTable("bank_statement_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  bankSlug: text("bank_slug").notNull(),
  bankDisplayName: text("bank_display_name").notNull(),
  version: integer("version").default(1).notNull(),
  label: text("label"),
  isSeeded: boolean("is_seeded").default(false).notNull(),
  forkedFromId: uuid("forked_from_id"),
  columnMapping: jsonb("column_mapping").$type<{
    date: number;
    narration: number;
    debit?: number;
    credit?: number;
    amount?: number;
    type?: number;
    reference?: number;
    balance?: number;
    dateFormat: string;
    skipRows: number;
    amountSignConvention?: "debit_positive" | "credit_positive";
  }>().notNull(),
  preprocessRules: jsonb("preprocess_rules").$type<{
    extraHeaderRows?: number;
    skipRowPatterns?: string[];
    amountParsingMode?: "standard" | "dr_cr_suffix" | "parentheses_negative" | "signed";
    skipSubtotalRows?: boolean;
    encoding?: string;
  }>(),
  detectionRules: jsonb("detection_rules").$type<{
    headerPatterns?: string[];
    columnCount?: { min: number; max: number };
    firstRowPatterns?: string[];
    ifscPrefix?: string;
  }>(),
  fileFormat: text("file_format").default("csv").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("bst_business_idx").on(t.businessId),
  index("bst_bank_slug_idx").on(t.businessId, t.bankSlug),
  uniqueIndex("bst_business_bank_version_idx").on(t.businessId, t.bankSlug, t.version, t.fileFormat),
]);

// ── Bank Statement Reconciliation ────────────────────────────

export const bankStatementImportStatusEnum = pgEnum("bank_statement_import_status", [
  "pending", "mapped", "processing", "review", "completed",
]);

export const bankStatementMatchStatusEnum = pgEnum("bank_statement_match_status", [
  "auto_matched", "manual_matched", "unmatched", "created", "ignored",
]);

export const bankStatementImports = pgTable("bank_statement_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  status: bankStatementImportStatusEnum("status").default("pending").notNull(),
  templateId: uuid("template_id").references(() => bankStatementTemplates.id, { onDelete: "set null" }),
  templateVersion: integer("template_version"),
  columnMapping: jsonb("column_mapping").$type<{
    date: number;
    narration: number;
    debit?: number;
    credit?: number;
    amount?: number;
    type?: number;
    reference?: number;
    balance?: number;
    dateFormat: string;
    skipRows: number;
    amountSignConvention?: "debit_positive" | "credit_positive";
  }>(),
  totalLines: integer("total_lines").default(0).notNull(),
  matchedLines: integer("matched_lines").default(0).notNull(),
  unmatchedLines: integer("unmatched_lines").default(0).notNull(),
  statementStartDate: timestamp("statement_start_date", { withTimezone: true }),
  statementEndDate: timestamp("statement_end_date", { withTimezone: true }),
  closingBalance: numeric("closing_balance", { precision: 15, scale: 2 }),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("bsi_business_idx").on(t.businessId),
  index("bsi_bank_account_idx").on(t.bankAccountId),
]);

export const bankStatementLines = pgTable("bank_statement_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  importId: uuid("import_id").notNull().references(() => bankStatementImports.id, { onDelete: "cascade" }),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  lineNumber: integer("line_number").notNull(),
  transactionDate: timestamp("transaction_date", { withTimezone: true }).notNull(),
  narration: text("narration"),
  debit: numeric("debit", { precision: 15, scale: 2 }).default("0").notNull(),
  credit: numeric("credit", { precision: 15, scale: 2 }).default("0").notNull(),
  balance: numeric("balance", { precision: 15, scale: 2 }),
  referenceNumber: text("reference_number"),
  rawData: jsonb("raw_data"),
  matchStatus: bankStatementMatchStatusEnum("match_status").default("unmatched").notNull(),
  matchConfidence: numeric("match_confidence", { precision: 3, scale: 2 }),
  matchedPaymentId: uuid("matched_payment_id"),
  matchedExpenseId: uuid("matched_expense_id"),
  matchedBankTransactionId: uuid("matched_bank_transaction_id"),
  autoCategory: text("auto_category"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("bsl_import_idx").on(t.importId),
  index("bsl_business_idx").on(t.businessId),
  index("bsl_date_idx").on(t.businessId, t.transactionDate),
  index("bsl_status_idx").on(t.importId, t.matchStatus),
  index("bsl_dedup_idx").on(t.businessId, t.transactionDate, t.debit, t.credit, t.referenceNumber),
]);

export const bankCategorizationRules = pgTable("bank_categorization_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id, { onDelete: "cascade" }),
  matchField: text("match_field").notNull(),       // "narration" | "reference"
  matchType: text("match_type").notNull(),          // "contains" | "starts_with" | "exact" | "regex"
  matchValue: text("match_value").notNull(),
  action: text("action").notNull(),                 // "create_expense" | "ignore" | "tag_party"
  expenseCategory: text("expense_category"),
  partyId: uuid("party_id"),
  priority: integer("priority").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  hitCount: integer("hit_count").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("bcr_business_idx").on(t.businessId),
]);

// ── E-Invoice Configuration ─────────────────────────────────

export const eInvoiceConfigs = pgTable("e_invoice_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  gstin: text("gstin").notNull(),
  // GSP credentials are deployment-level (env fallback), so they are optional
  // here; username/password are the per-business taxpayer API credentials.
  clientId: text("client_id"),
  clientSecret: text("client_secret"),
  username: text("username").notNull(),
  password: text("password").notNull(),
  authToken: text("auth_token"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  isSandbox: boolean("is_sandbox").default(true).notNull(),
  isEnabled: boolean("is_enabled").default(false).notNull(),
  thresholdCrore: numeric("threshold_crore", { precision: 5, scale: 2 }).default("5").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("einv_config_business_idx").on(t.businessId),
]);

// ── E-Way Bill ──────────────────────────────────────────────

export const ewayBillStatusEnum = pgEnum("eway_bill_status", [
  "generated", "active", "cancelled", "expired",
]);

export const ewayBillConfigs = pgTable("eway_bill_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  gstin: text("gstin").notNull(),
  // Deployment-level GSP credentials fall back to NIC_EWB_CLIENT_ID /
  // NIC_EWB_CLIENT_SECRET when null.
  clientId: text("client_id"),
  clientSecret: text("client_secret"),
  username: text("username").notNull(),
  password: text("password").notNull(),
  authToken: text("auth_token"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  isSandbox: boolean("is_sandbox").default(true).notNull(),
  isEnabled: boolean("is_enabled").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("ewb_config_business_idx").on(t.businessId),
]);

export const ewayBills = pgTable("eway_bills", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  ewbNumber: text("ewb_number"),
  ewbDate: timestamp("ewb_date", { withTimezone: true }),
  validUpto: timestamp("valid_upto", { withTimezone: true }),
  status: ewayBillStatusEnum("status").default("generated").notNull(),
  transporterId: text("transporter_id"),
  transporterName: text("transporter_name"),
  vehicleNumber: text("vehicle_number"),
  vehicleType: text("vehicle_type"),
  transportMode: text("transport_mode"),
  distance: integer("distance"),
  fromAddress: text("from_address"),
  fromPincode: text("from_pincode"),
  fromState: text("from_state"),
  toAddress: text("to_address"),
  toPincode: text("to_pincode"),
  toState: text("to_state"),
  cancelReason: text("cancel_reason"),
  apiResponse: jsonb("api_response"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("ewb_business_idx").on(t.businessId),
  index("ewb_invoice_idx").on(t.invoiceId),
  index("ewb_number_idx").on(t.ewbNumber),
  index("ewb_status_idx").on(t.businessId, t.status),
  index("ewb_validity_idx").on(t.businessId, t.validUpto),
]);

export const ewayBillVehicleUpdates = pgTable("eway_bill_vehicle_updates", {
  id: uuid("id").primaryKey().defaultRandom(),
  ewayBillId: uuid("eway_bill_id").notNull().references(() => ewayBills.id, { onDelete: "cascade" }),
  vehicleNumber: text("vehicle_number").notNull(),
  fromPlace: text("from_place"),
  reason: text("reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("ewb_vehicle_ewb_idx").on(t.ewayBillId),
]);

// ── GSTR-2B Reconciliation ────────────────────────────────────

export const gstr2bUploads = pgTable("gstr2b_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  returnPeriod: text("return_period").notNull(),  // "2026-04"
  fileName: text("file_name").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  totalRecords: integer("total_records").default(0).notNull(),
  matchedRecords: integer("matched_records").default(0).notNull(),
  unmatchedRecords: integer("unmatched_records").default(0).notNull(),
  newRecords: integer("new_records").default(0).notNull(),  // In 2B but not in our books
  createdByUserId: uuid("created_by_user_id"),
}, (t) => [
  index("g2b_business_idx").on(t.businessId),
  index("g2b_period_idx").on(t.businessId, t.returnPeriod),
]);

export const gstr2bRecords = pgTable("gstr2b_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadId: uuid("upload_id").notNull().references(() => gstr2bUploads.id, { onDelete: "cascade" }),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  supplierGstin: text("supplier_gstin").notNull(),
  supplierName: text("supplier_name"),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: timestamp("invoice_date", { withTimezone: true }),
  invoiceValue: numeric("invoice_value", { precision: 15, scale: 2 }).default("0").notNull(),
  taxableValue: numeric("taxable_value", { precision: 15, scale: 2 }).default("0").notNull(),
  cgst: numeric("cgst", { precision: 15, scale: 2 }).default("0").notNull(),
  sgst: numeric("sgst", { precision: 15, scale: 2 }).default("0").notNull(),
  igst: numeric("igst", { precision: 15, scale: 2 }).default("0").notNull(),
  cess: numeric("cess", { precision: 15, scale: 2 }).default("0").notNull(),
  itcAvailable: text("itc_available"),  // "Y" | "N"
  reason: text("reason"),               // Reason if ITC not available
  sourceType: text("source_type"),      // "B2B" | "B2BA" | "CDNR" | "ISD" | etc.
  // Reconciliation
  matchStatus: text("match_status").default("pending").notNull(),  // "matched" | "mismatched" | "missing_in_books" | "pending" | "ignored"
  matchedInvoiceId: uuid("matched_invoice_id"),  // Links to our purchase invoice
  mismatchReasons: jsonb("mismatch_reasons").$type<string[]>(),  // ["amount_difference", "date_difference", etc.]
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("g2br_upload_idx").on(t.uploadId),
  index("g2br_business_idx").on(t.businessId),
  index("g2br_gstin_idx").on(t.businessId, t.supplierGstin),
  index("g2br_match_idx").on(t.uploadId, t.matchStatus),
]);

// ── Relations ──────────────────────────────────────────────────

export const businessesRelations = relations(businesses, ({ one, many }) => ({
  parties: many(parties),
  items: many(items),
  invoices: many(invoices),
  payments: many(payments),
  expenses: many(expenses),
  bankAccounts: many(bankAccounts),
  storeOrders: many(storeOrders),
  salesTargets: many(salesTargets),
  recurringInvoiceTemplates: many(recurringInvoiceTemplates),
  premises: many(premises),
  warehouses: many(warehouses),
  inventorySettings: one(inventorySettings),
  warehousePermissions: many(warehousePermissions),
}));

export const premisesRelations = relations(premises, ({ one, many }) => ({
  business: one(businesses, {
    fields: [premises.businessId],
    references: [businesses.id],
  }),

  warehouses: many(warehouses),
}));

export const warehousesRelations = relations(warehouses, ({ one, many }) => ({
  business: one(businesses, {
    fields: [warehouses.businessId],
    references: [businesses.id],
  }),

  premise: one(premises, {
    fields: [warehouses.premiseId],
    references: [premises.id],
  }),

  locations: many(warehouseLocations),

  warehousePermissions: many(warehousePermissions),
}));

export const warehouseLocationsRelations = relations(
  warehouseLocations,
  ({ one }) => ({
    warehouse: one(warehouses, {
      fields: [warehouseLocations.warehouseId],
      references: [warehouses.id],
    }),
  }),
);

export const partiesRelations = relations(parties, ({ one, many }) => ({
  business: one(businesses, { fields: [parties.businessId], references: [businesses.id] }),
  invoices: many(invoices),
  payments: many(payments),
}));

export const itemsRelations = relations(items, ({ one, many }) => ({
  business: one(businesses, { fields: [items.businessId], references: [businesses.id] }),
  stockGroup: one(stockGroups, { fields: [items.stockGroupId], references: [stockGroups.id] }),
  variants: many(itemVariants),
}));

export const stockGroupsRelations = relations(stockGroups, ({ one, many }) => ({
  business: one(businesses, { fields: [stockGroups.businessId], references: [businesses.id] }),
  parent: one(stockGroups, { fields: [stockGroups.parentId], references: [stockGroups.id], relationName: "stockGroupParent" }),
  children: many(stockGroups, { relationName: "stockGroupParent" }),
  items: many(items),
}));

export const itemVariantsRelations = relations(itemVariants, ({ one }) => ({
  item: one(items, { fields: [itemVariants.itemId], references: [items.id] }),
}));

export const itemBatchesRelations = relations(itemBatches, ({ one }) => ({
  business: one(businesses, { fields: [itemBatches.businessId], references: [businesses.id] }),
  item: one(items, { fields: [itemBatches.itemId], references: [items.id] }),
  variant: one(itemVariants, { fields: [itemBatches.variantId], references: [itemVariants.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  business: one(businesses, { fields: [invoices.businessId], references: [businesses.id] }),
  party: one(parties, { fields: [invoices.partyId], references: [parties.id] }),
  lineItems: many(invoiceItems),
  payments: many(payments),
  referenceDocument: one(invoices, { fields: [invoices.referenceDocumentId], references: [invoices.id], relationName: "referenceDoc" }),
  linkedDocuments: many(invoices, { relationName: "referenceDoc" }),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceItems.invoiceId], references: [invoices.id] }),
  item: one(items, { fields: [invoiceItems.itemId], references: [items.id] }),
  variant: one(itemVariants, { fields: [invoiceItems.variantId], references: [itemVariants.id] }),
  batch: one(itemBatches, { fields: [invoiceItems.batchId], references: [itemBatches.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  business: one(businesses, { fields: [payments.businessId], references: [businesses.id] }),
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
  party: one(parties, { fields: [payments.partyId], references: [parties.id] }),
  bankAccount: one(bankAccounts, { fields: [payments.bankAccountId], references: [bankAccounts.id] }),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  business: one(businesses, { fields: [expenses.businessId], references: [businesses.id] }),
}));

export const bankAccountsRelations = relations(bankAccounts, ({ one, many }) => ({
  business: one(businesses, { fields: [bankAccounts.businessId], references: [businesses.id] }),
  transactions: many(bankTransactions),
}));

export const bankTransactionsRelations = relations(bankTransactions, ({ one }) => ({
  business: one(businesses, { fields: [bankTransactions.businessId], references: [businesses.id] }),
  bankAccount: one(bankAccounts, { fields: [bankTransactions.bankAccountId], references: [bankAccounts.id] }),
}));

export const storeOrdersRelations = relations(storeOrders, ({ one }) => ({
  business: one(businesses, { fields: [storeOrders.businessId], references: [businesses.id] }),
  invoice: one(invoices, { fields: [storeOrders.invoiceId], references: [invoices.id] }),
}));

export const stockAdjustmentsRelations = relations(stockAdjustments, ({ one }) => ({
  business: one(businesses, { fields: [stockAdjustments.businessId], references: [businesses.id] }),
  item: one(items, { fields: [stockAdjustments.itemId], references: [items.id] }),
  variant: one(itemVariants, { fields: [stockAdjustments.variantId], references: [itemVariants.id] }),
}));

export const shipmentsRelations = relations(shipments, ({ one, many }) => ({
  business: one(businesses, { fields: [shipments.businessId], references: [businesses.id] }),
  invoice: one(invoices, { fields: [shipments.invoiceId], references: [invoices.id] }),
  party: one(parties, { fields: [shipments.partyId], references: [parties.id] }),
  events: many(shipmentEvents),
}));

export const shipmentEventsRelations = relations(shipmentEvents, ({ one }) => ({
  shipment: one(shipments, { fields: [shipmentEvents.shipmentId], references: [shipments.id] }),
}));

export const salesTargetsRelations = relations(salesTargets, ({ one }) => ({
  business: one(businesses, { fields: [salesTargets.businessId], references: [businesses.id] }),
  item: one(items, { fields: [salesTargets.itemId], references: [items.id] }),
}));

export const recurringInvoiceTemplatesRelations = relations(recurringInvoiceTemplates, ({ one, many }) => ({
  business: one(businesses, { fields: [recurringInvoiceTemplates.businessId], references: [businesses.id] }),
  party: one(parties, { fields: [recurringInvoiceTemplates.partyId], references: [parties.id] }),
  runs: many(recurringInvoiceRuns),
}));

export const recurringInvoiceRunsRelations = relations(recurringInvoiceRuns, ({ one }) => ({
  template: one(recurringInvoiceTemplates, { fields: [recurringInvoiceRuns.templateId], references: [recurringInvoiceTemplates.id] }),
  business: one(businesses, { fields: [recurringInvoiceRuns.businessId], references: [businesses.id] }),
  invoice: one(invoices, { fields: [recurringInvoiceRuns.invoiceId], references: [invoices.id] }),
}));

export const journalEntriesRelations = relations(journalEntries, ({ one, many }) => ({
  business: one(businesses, { fields: [journalEntries.businessId], references: [businesses.id] }),
  lines: many(journalEntryLines),
}));

export const journalEntryLinesRelations = relations(journalEntryLines, ({ one }) => ({
  journalEntry: one(journalEntries, { fields: [journalEntryLines.journalEntryId], references: [journalEntries.id] }),
  account: one(chartOfAccounts, { fields: [journalEntryLines.accountId], references: [chartOfAccounts.id] }),
}));

export const inventorySettingsRelations = relations(
  inventorySettings,
  ({ one }) => ({
    business: one(businesses, {
      fields: [inventorySettings.businessId],
      references: [businesses.id],
    }),
    salesWarehouse: one(warehouses, {
      fields: [inventorySettings.salesWarehouseId],
      references: [warehouses.id],
    }),
    purchaseWarehouse: one(warehouses, {
      fields: [inventorySettings.purchaseWarehouseId],
      references: [warehouses.id],
    }),
    salesReturnWarehouse: one(warehouses, {
      fields: [inventorySettings.salesReturnWarehouseId],
      references: [warehouses.id],
    }),
    purchaseReturnWarehouse: one(warehouses, {
      fields: [inventorySettings.purchaseReturnWarehouseId],
      references: [warehouses.id],
    }),
    productionWarehouse: one(warehouses, {
      fields: [inventorySettings.productionWarehouseId],
      references: [warehouses.id],
    }),
    stockAdjustmentWarehouse: one(warehouses, {
      fields: [inventorySettings.stockAdjustmentWarehouseId],
      references: [warehouses.id],
    }),
  }),
);

export const warehousePermissionsRelations = relations(
  warehousePermissions,
  ({ one }) => ({
    business: one(businesses, {
      fields: [warehousePermissions.businessId],
      references: [businesses.id],
    }),
    businessMember: one(businessMembers, {
      fields: [warehousePermissions.businessMemberId],
      references: [businessMembers.id],
    }),
    warehouse: one(warehouses, {
      fields: [warehousePermissions.warehouseId],
      references: [warehouses.id],
    }),
  }),
);

// ── Payroll (add-on, Phase 1) ──────────────────────────────────────
// Employees, attendance, leave, salary structures and monthly payroll runs.
// Everything is per business. Money is numeric(15,2) rupees like the rest of
// the app; the pure calculation lives in packages/shared (payroll-calc.ts).
// Sensitive identity numbers (PAN, Aadhaar, UAN, ESIC, bank account) are
// plain columns that the API masks in lists and never writes to logs or the
// audit trail. Phase 2 (PF, ESI, PT, TDS) adds statutory components through
// salary_components.statutory_kind and new columns; nothing here needs to be
// migrated for it (docs/architecture/payroll.md).

// One row per business: the payroll defaults.
export const payrollSettings = pgTable("payroll_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  // Weekday numbers, 0 = Sunday. Used for an employee with no shift.
  defaultWeeklyOffDays: jsonb("default_weekly_off_days").$type<number[]>().default([0]).notNull(),
  standardHoursPerDay: numeric("standard_hours_per_day", { precision: 4, scale: 2 }).default("8").notNull(),
  overtimeMultiplier: numeric("overtime_multiplier", { precision: 4, scale: 2 }).default("2").notNull(),
  // 1-12; 4 = April.
  leaveYearStartMonth: integer("leave_year_start_month").default(4).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("payroll_settings_business_idx").on(t.businessId),
]);

export const payrollDepartments = pgTable("payroll_departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("payroll_departments_name_idx").on(t.businessId, t.name),
]);

export const payrollDesignations = pgTable("payroll_designations", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("payroll_designations_name_idx").on(t.businessId, t.name),
]);

// A working pattern: hours and weekly offs.
export const payrollShifts = pgTable("payroll_shifts", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  weeklyOffDays: jsonb("weekly_off_days").$type<number[]>().default([0]).notNull(),
  standardHours: numeric("standard_hours", { precision: 4, scale: 2 }).default("8").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("payroll_shifts_name_idx").on(t.businessId, t.name),
]);

//   status         - active | exited
//   employment_type - permanent | contract | intern
//   tax_regime     - new | old (a record of the choice; TDS itself is Phase 2)
//   exit_*         - set by the exit action; fnf_payroll_run_id links the run
//                    that settled the last month (full and final)
export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  employeeCode: text("employee_code").notNull(),
  name: text("name").notNull(),
  dateOfBirth: date("date_of_birth"),
  gender: text("gender"),
  fatherOrSpouseName: text("father_or_spouse_name"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  // A small profile picture as a data URL (png/jpeg/webp). Only the detail view returns it.
  photoDataUrl: text("photo_data_url"),
  // Sensitive: masked in lists, never logged or audited.
  pan: text("pan"),
  aadhaar: text("aadhaar"),
  uan: text("uan"),
  esicNumber: text("esic_number"),
  dateOfJoining: date("date_of_joining").notNull(),
  departmentId: uuid("department_id").references(() => payrollDepartments.id, { onDelete: "set null" }),
  designationId: uuid("designation_id").references(() => payrollDesignations.id, { onDelete: "set null" }),
  branch: text("branch"),
  workState: text("work_state"),
  managerId: uuid("manager_id").references((): AnyPgColumn => employees.id, { onDelete: "set null" }),
  shiftId: uuid("shift_id").references(() => payrollShifts.id, { onDelete: "set null" }),
  employmentType: text("employment_type").default("permanent").notNull(),
  taxRegime: text("tax_regime").default("new").notNull(),
  // Sensitive: bank details.
  bankAccountNumber: text("bank_account_number"),
  bankIfsc: text("bank_ifsc"),
  bankAccountName: text("bank_account_name"),
  bankName: text("bank_name"),
  status: text("status").default("active").notNull(),
  lastWorkingDay: date("last_working_day"),
  exitReason: text("exit_reason"),
  exitNote: text("exit_note"),
  fnfNote: text("fnf_note"),
  fnfPayrollRunId: uuid("fnf_payroll_run_id"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("employees_code_idx").on(t.businessId, t.employeeCode),
  index("employees_business_status_idx").on(t.businessId, t.status),
  index("employees_department_idx").on(t.departmentId),
]);

//   type     - earning | deduction | employer_contribution
//   category - basic, da, hra, ... (packages/shared payroll-calc.ts)
//   statutory_kind - reserved for Phase 2 (pf_employee, esi_employer, professional_tax,
//                    income_tax_tds ...); null for every Phase 1 component
export const salaryComponents = pgTable("salary_components", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  category: text("category").notNull(),
  prorate: boolean("prorate").default(true).notNull(),
  isWage: boolean("is_wage").default(false).notNull(),
  statutoryKind: text("statutory_kind"),
  sortOrder: integer("sort_order").default(100).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("salary_components_code_idx").on(t.businessId, t.code),
]);

export const salaryTemplates = pgTable("salary_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  sampleAnnualCtc: numeric("sample_annual_ctc", { precision: 15, scale: 2 }).default("0").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("salary_templates_name_idx").on(t.businessId, t.name),
]);

//   calc_type - fixed | percent_of_basic | percent_of_ctc | balance
export const salaryTemplateLines = pgTable("salary_template_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").notNull().references(() => salaryTemplates.id, { onDelete: "cascade" }),
  componentId: uuid("component_id").notNull().references(() => salaryComponents.id),
  calcType: text("calc_type").notNull(),
  value: numeric("value", { precision: 15, scale: 2 }).default("0").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
}, (t) => [
  index("salary_template_lines_template_idx").on(t.templateId),
  uniqueIndex("salary_template_lines_component_idx").on(t.templateId, t.componentId),
]);

// What an employee is paid, effective-dated. `breakdown` is the snapshot of
// the monthly amounts at the time of assignment (components with names,
// categories and amounts), so a later change to a template or component never
// changes what was assigned. The run uses the latest assignment whose
// effective_from is on or before the last day of the month.
export const employeeSalaryAssignments = pgTable("employee_salary_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  templateId: uuid("template_id").references(() => salaryTemplates.id, { onDelete: "set null" }),
  annualCtc: numeric("annual_ctc", { precision: 15, scale: 2 }).notNull(),
  monthlyCtc: numeric("monthly_ctc", { precision: 15, scale: 2 }).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  breakdown: jsonb("breakdown").$type<Array<{
    componentId: string | null;
    code: string;
    name: string;
    type: string;
    category: string;
    isWage: boolean;
    prorate: boolean;
    statutoryKind: string | null;
    calcType: string;
    value: string;
    monthly: string;
  }>>().notNull(),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("employee_salary_assignments_employee_idx").on(t.employeeId, t.effectiveFrom),
  index("employee_salary_assignments_business_idx").on(t.businessId),
]);

//   status - present | absent | half_day | week_off | holiday | leave
//   source - manual | leave (written by an approved leave application)
export const attendanceRecords = pgTable("attendance_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  date: date("date").notNull(),
  status: text("status").notNull(),
  leaveTypeId: uuid("leave_type_id"),
  checkIn: text("check_in"),
  checkOut: text("check_out"),
  overtimeHours: numeric("overtime_hours", { precision: 5, scale: 2 }).default("0").notNull(),
  note: text("note"),
  source: text("source").default("manual").notNull(),
  markedByUserId: uuid("marked_by_user_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("attendance_records_day_idx").on(t.employeeId, t.date),
  index("attendance_records_business_date_idx").on(t.businessId, t.date),
]);

//   scope - national | state | branch
export const payrollHolidays = pgTable("payroll_holidays", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  name: text("name").notNull(),
  scope: text("scope").default("national").notNull(),
  stateCode: text("state_code"),
  branch: text("branch"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("payroll_holidays_business_date_idx").on(t.businessId, t.date),
]);

//   accrual_type - none | annual | monthly ; accrual_days is per year or per month
export const leaveTypes = pgTable("leave_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  isPaid: boolean("is_paid").default(true).notNull(),
  accrualType: text("accrual_type").default("none").notNull(),
  accrualDays: numeric("accrual_days", { precision: 6, scale: 2 }).default("0").notNull(),
  carryForward: boolean("carry_forward").default(false).notNull(),
  carryForwardMax: numeric("carry_forward_max", { precision: 6, scale: 2 }).default("0").notNull(),
  encashable: boolean("encashable").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("leave_types_code_idx").on(t.businessId, t.code),
]);

// A leave balance is the sum of an employee's ledger rows for a leave type
// and leave year. kind: accrual | carry_forward | lapse | taken | cancelled |
// encashment | adjustment. `days` is signed (taken and lapse are negative).
// period_key makes an accrual idempotent ("2026-04" monthly, "2026" annual).
export const leaveLedger = pgTable("leave_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  leaveTypeId: uuid("leave_type_id").notNull().references(() => leaveTypes.id),
  leaveYear: integer("leave_year").notNull(),
  entryDate: date("entry_date").notNull(),
  kind: text("kind").notNull(),
  days: numeric("days", { precision: 6, scale: 2 }).notNull(),
  periodKey: text("period_key"),
  applicationId: uuid("application_id"),
  note: text("note"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("leave_ledger_employee_idx").on(t.employeeId, t.leaveTypeId, t.leaveYear),
  uniqueIndex("leave_ledger_period_idx").on(t.employeeId, t.leaveTypeId, t.kind, t.periodKey).where(sql`${t.periodKey} IS NOT NULL`),
]);

//   status - pending | approved | rejected | cancelled
//   paid_days / lop_days - the split decided at approval: the balance is used first, the rest is loss of pay
export const leaveApplications = pgTable("leave_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  leaveTypeId: uuid("leave_type_id").notNull().references(() => leaveTypes.id),
  fromDate: date("from_date").notNull(),
  toDate: date("to_date").notNull(),
  halfDayStart: boolean("half_day_start").default(false).notNull(),
  halfDayEnd: boolean("half_day_end").default(false).notNull(),
  days: numeric("days", { precision: 6, scale: 2 }).notNull(),
  paidDays: numeric("paid_days", { precision: 6, scale: 2 }).default("0").notNull(),
  lopDays: numeric("lop_days", { precision: 6, scale: 2 }).default("0").notNull(),
  reason: text("reason"),
  status: text("status").default("pending").notNull(),
  decidedByUserId: uuid("decided_by_user_id"),
  decidedByName: text("decided_by_name"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("leave_applications_business_idx").on(t.businessId, t.status),
  index("leave_applications_employee_idx").on(t.employeeId, t.fromDate),
]);

// Leave encashment waiting for payroll: the next run that is calculated adds
// it as an earning; payroll_run_id is set when that run is approved.
export const leaveEncashments = pgTable("leave_encashments", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  leaveTypeId: uuid("leave_type_id").notNull().references(() => leaveTypes.id),
  days: numeric("days", { precision: 6, scale: 2 }).notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  note: text("note"),
  payrollRunId: uuid("payroll_run_id"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("leave_encashments_employee_idx").on(t.employeeId),
  index("leave_encashments_run_idx").on(t.payrollRunId),
]);

//   status - draft | attendance_locked | calculated | pending_approval | approved | posted | paid
// One run per business and month. The two journal ids link the entries posted
// to the books (accrual at posting, payment when marked paid).
export const payrollRuns = pgTable("payroll_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  month: text("month").notNull(),
  status: text("status").default("draft").notNull(),
  daysInMonth: integer("days_in_month").notNull(),
  employeeCount: integer("employee_count").default(0).notNull(),
  grossTotal: numeric("gross_total", { precision: 15, scale: 2 }).default("0").notNull(),
  deductionsTotal: numeric("deductions_total", { precision: 15, scale: 2 }).default("0").notNull(),
  employerTotal: numeric("employer_total", { precision: 15, scale: 2 }).default("0").notNull(),
  netTotal: numeric("net_total", { precision: 15, scale: 2 }).default("0").notNull(),
  warnings: jsonb("warnings").$type<Array<{ code: string; message: string; employeeId?: string }>>().default([]).notNull(),
  notes: text("notes"),
  attendanceLockedAt: timestamp("attendance_locked_at", { withTimezone: true }),
  attendanceLockedByUserId: uuid("attendance_locked_by_user_id"),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }),
  calculatedByUserId: uuid("calculated_by_user_id"),
  calculatedByName: text("calculated_by_name"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  submittedByUserId: uuid("submitted_by_user_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedByUserId: uuid("approved_by_user_id"),
  approvedByName: text("approved_by_name"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  postedByUserId: uuid("posted_by_user_id"),
  accrualJournalEntryId: uuid("accrual_journal_entry_id").references(() => journalEntries.id),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paidOn: date("paid_on"),
  paidByUserId: uuid("paid_by_user_id"),
  paidFromBankAccountId: uuid("paid_from_bank_account_id").references(() => bankAccounts.id),
  paidReference: text("paid_reference"),
  paymentJournalEntryId: uuid("payment_journal_entry_id").references(() => journalEntries.id),
  createdByUserId: uuid("created_by_user_id"),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("payroll_runs_month_idx").on(t.businessId, t.month),
]);

// One row per employee in a run: a frozen result. `components` is the list of
// every component with its full-month and paid amount (paise-exact rupee
// strings), so a payslip can be rebuilt without any other table.
export const payrollRunLines = pgTable("payroll_run_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => payrollRuns.id, { onDelete: "cascade" }),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  employeeCode: text("employee_code").notNull(),
  employeeName: text("employee_name").notNull(),
  department: text("department"),
  designation: text("designation"),
  daysInMonth: integer("days_in_month").notNull(),
  employedDays: integer("employed_days").notNull(),
  paidDays: numeric("paid_days", { precision: 5, scale: 1 }).notNull(),
  lopDays: numeric("lop_days", { precision: 5, scale: 1 }).notNull(),
  overtimeHours: numeric("overtime_hours", { precision: 6, scale: 2 }).default("0").notNull(),
  components: jsonb("components").$type<Array<{
    componentId: string | null;
    code: string;
    name: string;
    type: string;
    category: string;
    isWage: boolean;
    statutoryKind: string | null;
    source: string;
    full: string;
    amount: string;
  }>>().notNull(),
  grossEarnings: numeric("gross_earnings", { precision: 15, scale: 2 }).notNull(),
  totalDeductions: numeric("total_deductions", { precision: 15, scale: 2 }).notNull(),
  employerContributions: numeric("employer_contributions", { precision: 15, scale: 2 }).default("0").notNull(),
  netPay: numeric("net_pay", { precision: 15, scale: 2 }).notNull(),
  warnings: jsonb("warnings").$type<Array<{ code: string; message: string }>>().default([]).notNull(),
  isFinalSettlement: boolean("is_final_settlement").default(false).notNull(),
  // Frozen at approval, for the bank file (sensitive).
  bankAccountNumber: text("bank_account_number"),
  bankIfsc: text("bank_ifsc"),
  bankAccountName: text("bank_account_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("payroll_run_lines_employee_idx").on(t.runId, t.employeeId),
  index("payroll_run_lines_business_idx").on(t.businessId),
]);

// A one-off amount on one employee's line in one run (a manual deduction, an
// advance recovery, an incentive). Kept across recalculation.
export const payrollRunAdjustments = pgTable("payroll_run_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => payrollRuns.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  name: text("name").notNull(),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  note: text("note"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("payroll_run_adjustments_run_idx").on(t.runId, t.employeeId),
]);

// The payslip of one employee for one approved run. `snapshot` holds
// everything the PDF shows (business header, employee details with MASKED
// identity numbers, the earnings and deductions, the net pay in words), taken
// at approval and never changed afterwards. The PDF is drawn from it on demand.
export const payslips = pgTable("payslips", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => payrollRuns.id, { onDelete: "cascade" }),
  lineId: uuid("line_id").notNull().references(() => payrollRunLines.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  month: text("month").notNull(),
  number: text("number").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  emailedAt: timestamp("emailed_at", { withTimezone: true }),
  // Masked address (a***@x.com), never the full one.
  emailedTo: text("emailed_to"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("payslips_run_employee_idx").on(t.runId, t.employeeId),
  index("payslips_business_idx").on(t.businessId),
]);

// ── AI business assistant: conversation history ────────────────────
// One conversation per chat a person opens, private to that person (user_id
// is a plain UUID: users live in the control database). Messages keep the
// text, the VALIDATED answer cards and a summary of the tool calls (name and
// outcome only, never the data a tool returned). Deleted with the business;
// not part of the data export (a chat history is not a book of account).
// See docs/architecture/ai-assistant.md.

export const aiConversations = pgTable("ai_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("ai_conversations_user_idx").on(t.businessId, t.userId, t.updatedAt),
]);

export const aiMessages = pgTable("ai_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  /** user | assistant */
  role: text("role").notNull(),
  content: text("content").notNull(),
  /** Validated cards (shared parseAiCards), or null. */
  cards: jsonb("cards").$type<Array<Record<string, unknown>>>(),
  /** [{ name, status }] of the tools used for an assistant message; no data. */
  toolCalls: jsonb("tool_calls").$type<Array<{ name: string; status: string }>>(),
  model: text("model"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("ai_messages_conversation_idx").on(t.conversationId, t.createdAt),
]);

// ── Business-date column registry ─────────────────────────────────
// The canonical user-entered business date for each document table.
// Date-range filters coming from the UI (pills like "This Month", "This FY"),
// reports, and dashboards must filter on these columns — never on `createdAt`,
// which is a row-insertion timestamp and unrelated to the business event.
//
// When adding a new document table with a user-entered date, register it here
// and prefer the `buildBusinessDateFilter` helper in `@fintranzact/api` over
// hand-written `gte`/`lte` on the column.

export type BusinessDateTable =
  | typeof invoices
  | typeof payments
  | typeof expenses
  | typeof bankTransactions
  | typeof journalEntries;

export function businessDateColumnFor(table: BusinessDateTable) {
  if (table === invoices) return invoices.invoiceDate;
  if (table === payments) return payments.paymentDate;
  if (table === expenses) return expenses.expenseDate;
  if (table === bankTransactions) return bankTransactions.transactionDate;
  if (table === journalEntries) return journalEntries.entryDate;
  // Unreachable when the input is a registered BusinessDateTable. If a caller
  // passes something else, the TS compiler has been bypassed; fail loudly.
  throw new Error(`no business-date column registered for this table`);
}
