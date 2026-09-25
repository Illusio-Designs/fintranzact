import { pgTable, uniqueIndex, index, foreignKey, uuid, text, timestamp, boolean, jsonb, numeric, integer, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const accountType = pgEnum("account_type", ['asset', 'liability', 'equity', 'income', 'expense'])
export const bankAccountType = pgEnum("bank_account_type", ['savings', 'current', 'cash', 'upi', 'credit_card', 'payment_gateway'])
export const bankStatementImportStatus = pgEnum("bank_statement_import_status", ['pending', 'mapped', 'processing', 'review', 'completed'])
export const bankStatementMatchStatus = pgEnum("bank_statement_match_status", ['auto_matched', 'manual_matched', 'unmatched', 'created', 'ignored'])
export const bankTransactionType = pgEnum("bank_transaction_type", ['deposit', 'withdrawal', 'transfer'])
export const businessMemberRole = pgEnum("business_member_role", ['admin', 'member'])
export const documentType = pgEnum("document_type", ['invoice', 'quotation', 'credit_note', 'debit_note', 'delivery_challan', 'proforma', 'sales_return', 'purchase_return'])
export const ewayBillStatus = pgEnum("eway_bill_status", ['generated', 'active', 'cancelled', 'expired'])
export const gstRegistrationType = pgEnum("gst_registration_type", ['regular', 'composition', 'unregistered'])
export const invoiceStatus = pgEnum("invoice_status", ['draft', 'unfulfilled', 'sent', 'paid', 'partial', 'overdue', 'cancelled', 'adjusted'])
export const invoiceType = pgEnum("invoice_type", ['sale', 'purchase'])
export const itcStatus = pgEnum("itc_status", ['available', 'utilized', 'reversed', 'reclaimed', 'blocked'])
export const itemMode = pgEnum("item_mode", ['simple', 'alt_units', 'variants'])
export const itemType = pgEnum("item_type", ['product', 'service'])
export const memberRole = pgEnum("member_role", ['owner', 'admin', 'member', 'viewer', 'superadmin', 'seller_manager', 'seller', 'accountant'])
export const partyType = pgEnum("party_type", ['customer', 'supplier'])
export const paymentMode = pgEnum("payment_mode", ['cash', 'bank', 'upi', 'cheque', 'other', 'credit_card', 'debit_card', 'net_banking', 'wallet'])
export const recurringFrequency = pgEnum("recurring_frequency", ['weekly', 'biweekly', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'custom'])
export const recurringRunStatus = pgEnum("recurring_run_status", ['success', 'failed', 'skipped_limit'])
export const recurringTemplateStatus = pgEnum("recurring_template_status", ['active', 'paused', 'completed', 'expired'])
export const sessionAuthMethod = pgEnum("session_auth_method", ['cookie', 'bearer'])
export const shipmentStatus = pgEnum("shipment_status", ['pending', 'shipped', 'in_transit', 'delivered', 'returned'])
export const storeOrderStatus = pgEnum("store_order_status", ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'])
export const tenantPlan = pgEnum("tenant_plan", ['forever_free', 'free', 'pro', 'business', 'enterprise'])
export const tenantStatus = pgEnum("tenant_status", ['active', 'suspended', 'deleted'])
export const unit = pgEnum("unit", ['pcs', 'kg', 'g', 'l', 'ml', 'm', 'cm', 'ft', 'in', 'box', 'dozen', 'pair', 'set', 'pkt', 'bun', 'pouch', 'jar', 'btl', 'bag', 'ton', 'pack', 'pet', 'person', 'other'])


export const premises = pgTable("premises", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	name: text().notNull(),
	code: text().notNull(),
	address: text(),
	state: text(),
	city: text(),
	status: text().default('active').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("premises_business_code_idx").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.code.asc().nullsLast().op("text_ops")),
	index("premises_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "premises_business_id_businesses_id_fk"
	}).onDelete("cascade"),
]);

export const warehouses = pgTable("warehouses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	premiseId: uuid("premise_id").notNull(),
	name: text().notNull(),
	code: text().notNull(),
	warehouseType: text("warehouse_type").notNull(),
	address: text(),
	status: text().default('active').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("warehouses_business_code_idx").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.code.asc().nullsLast().op("text_ops")),
	index("warehouses_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("warehouses_premise_idx").using("btree", table.premiseId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "warehouses_business_id_businesses_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.premiseId],
		foreignColumns: [premises.id],
		name: "warehouses_premise_id_premises_id_fk"
	}).onDelete("restrict"),
]);

export const warehouseLocations = pgTable("warehouse_locations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	warehouseId: uuid("warehouse_id").notNull(),
	parentId: uuid("parent_id"),
	locationType: text("location_type").notNull(),
	name: text().notNull(),
	code: text().notNull(),
	status: text().default('active').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("warehouse_locations_code_idx").using("btree", table.warehouseId.asc().nullsLast().op("text_ops"), table.code.asc().nullsLast().op("text_ops")),
	index("warehouse_locations_parent_idx").using("btree", table.parentId.asc().nullsLast().op("uuid_ops")),
	index("warehouse_locations_warehouse_idx").using("btree", table.warehouseId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.warehouseId],
		foreignColumns: [warehouses.id],
		name: "warehouse_locations_warehouse_id_warehouses_id_fk"
	}).onDelete("cascade"),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: text().notNull(),
	name: text(),
	referralCode: text("referral_code"),
	passwordHash: text("password_hash"),
	emailVerified: boolean("email_verified").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("users_email_idx").using("btree", table.email.asc().nullsLast().op("text_ops")),
]);

export const tenants = pgTable("tenants", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	slug: text().notNull(),
	dbName: text("db_name"),
	dbHost: text("db_host"),
	dbPort: text("db_port"),
	dbUser: text("db_user"),
	dbPassword: text("db_password"),
	plan: tenantPlan().default('free').notNull(),
	status: tenantStatus().default('active').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("tenants_slug_idx").using("btree", table.slug.asc().nullsLast().op("text_ops")),
]);

export const magicLinkTokens = pgTable("magic_link_tokens", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: text().notNull(),
	tokenHash: text("token_hash").notNull(),
	userId: uuid("user_id"),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	usedAt: timestamp("used_at", { withTimezone: true, mode: 'string' }),
	ipAddress: text("ip_address"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("magic_link_tokens_email_idx").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("magic_link_tokens_hash_idx").using("btree", table.tokenHash.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "magic_link_tokens_user_id_users_id_fk"
	}).onDelete("cascade"),
]);

export const tenantMembers = pgTable("tenant_members", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	tenantId: uuid("tenant_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: memberRole().default('member').notNull(),
	invitedBy: uuid("invited_by"),
	acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("tenant_members_unique_idx").using("btree", table.tenantId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("tenant_members_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.tenantId],
		foreignColumns: [tenants.id],
		name: "tenant_members_tenant_id_tenants_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "tenant_members_user_id_users_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.invitedBy],
		foreignColumns: [users.id],
		name: "tenant_members_invited_by_users_id_fk"
	}).onDelete("set null"),
]);

export const apiKeys = pgTable("api_keys", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	tenantId: uuid("tenant_id").notNull(),
	keyHash: text("key_hash").notNull(),
	keyPrefix: text("key_prefix").notNull(),
	name: text().notNull(),
	lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: 'string' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("api_keys_hash_idx").using("btree", table.keyHash.asc().nullsLast().op("text_ops")),
	index("api_keys_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "api_keys_user_id_users_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.tenantId],
		foreignColumns: [tenants.id],
		name: "api_keys_tenant_id_tenants_id_fk"
	}).onDelete("cascade"),
]);

export const systemConfig = pgTable("system_config", {
	key: text().primaryKey().notNull(),
	value: jsonb().default({}).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const invitations = pgTable("invitations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	tenantId: uuid("tenant_id").notNull(),
	email: text().notNull(),
	role: memberRole().default('member').notNull(),
	token: text().notNull(),
	invitedBy: uuid("invited_by"),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("invitations_email_idx").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("invitations_tenant_idx").using("btree", table.tenantId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("invitations_token_idx").using("btree", table.token.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.tenantId],
		foreignColumns: [tenants.id],
		name: "invitations_tenant_id_tenants_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.invitedBy],
		foreignColumns: [users.id],
		name: "invitations_invited_by_users_id_fk"
	}).onDelete("set null"),
]);

export const auditLog = pgTable("audit_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	userId: uuid("user_id").notNull(),
	action: text().notNull(),
	entityType: text("entity_type").notNull(),
	entityId: uuid("entity_id"),
	metadata: text(),
	ipAddress: text("ip_address"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("audit_log_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("audit_log_date_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("audit_log_entity_idx").using("btree", table.entityType.asc().nullsLast().op("text_ops"), table.entityId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "audit_log_business_id_businesses_id_fk"
	}).onDelete("cascade"),
]);

export const bankAccounts = pgTable("bank_accounts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	accountName: text("account_name").notNull(),
	accountNumber: text("account_number"),
	ifsc: text(),
	bankName: text("bank_name"),
	accountType: bankAccountType("account_type").default('savings').notNull(),
	openingBalance: numeric("opening_balance", { precision: 15, scale: 2 }).default('0').notNull(),
	currentBalance: numeric("current_balance", { precision: 15, scale: 2 }).default('0').notNull(),
	isDefault: boolean("is_default").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("bank_accounts_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "bank_accounts_business_id_businesses_id_fk"
	}).onDelete("cascade"),
]);

export const sessions = pgTable("sessions", {
	id: text().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	tenantId: uuid("tenant_id"),
	authMethod: sessionAuthMethod("auth_method").default('cookie').notNull(),
	maxExpiresAt: timestamp("max_expires_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("sessions_tenant_idx").using("btree", table.tenantId.asc().nullsLast().op("uuid_ops")),
	index("sessions_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "sessions_user_id_users_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.tenantId],
		foreignColumns: [tenants.id],
		name: "sessions_tenant_id_tenants_id_fk"
	}).onDelete("cascade"),
]);

export const bankStatementTemplates = pgTable("bank_statement_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	bankSlug: text("bank_slug").notNull(),
	bankDisplayName: text("bank_display_name").notNull(),
	version: integer().default(1).notNull(),
	label: text(),
	isSeeded: boolean("is_seeded").default(false).notNull(),
	forkedFromId: uuid("forked_from_id"),
	columnMapping: jsonb("column_mapping").notNull(),
	preprocessRules: jsonb("preprocess_rules"),
	detectionRules: jsonb("detection_rules"),
	fileFormat: text("file_format").default('csv').notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("bst_bank_slug_idx").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.bankSlug.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("bst_business_bank_version_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.bankSlug.asc().nullsLast().op("uuid_ops"), table.version.asc().nullsLast().op("int4_ops"), table.fileFormat.asc().nullsLast().op("uuid_ops")),
	index("bst_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "bank_statement_templates_business_id_businesses_id_fk"
	}).onDelete("cascade"),
]);

export const bankTransactions = pgTable("bank_transactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	bankAccountId: uuid("bank_account_id").notNull(),
	type: bankTransactionType().notNull(),
	amount: numeric({ precision: 15, scale: 2 }).notNull(),
	description: text(),
	referenceType: text("reference_type"),
	referenceId: uuid("reference_id"),
	paymentId: uuid("payment_id"),
	transactionDate: timestamp("transaction_date", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("bank_txn_account_idx").using("btree", table.bankAccountId.asc().nullsLast().op("uuid_ops")),
	index("bank_txn_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("bank_txn_date_idx").using("btree", table.bankAccountId.asc().nullsLast().op("uuid_ops"), table.transactionDate.asc().nullsLast().op("uuid_ops")),
	index("bank_txn_payment_idx").using("btree", table.paymentId.asc().nullsLast().op("uuid_ops")),
	index("bank_txn_ref_idx").using("btree", table.referenceType.asc().nullsLast().op("text_ops"), table.referenceId.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "bank_transactions_business_id_businesses_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.bankAccountId],
		foreignColumns: [bankAccounts.id],
		name: "bank_transactions_bank_account_id_bank_accounts_id_fk"
	}).onDelete("cascade"),
]);

export const bankStatementLines = pgTable("bank_statement_lines", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	importId: uuid("import_id").notNull(),
	businessId: uuid("business_id").notNull(),
	lineNumber: integer("line_number").notNull(),
	transactionDate: timestamp("transaction_date", { withTimezone: true, mode: 'string' }).notNull(),
	narration: text(),
	debit: numeric({ precision: 15, scale: 2 }).default('0').notNull(),
	credit: numeric({ precision: 15, scale: 2 }).default('0').notNull(),
	balance: numeric({ precision: 15, scale: 2 }),
	referenceNumber: text("reference_number"),
	rawData: jsonb("raw_data"),
	matchStatus: bankStatementMatchStatus("match_status").default('unmatched').notNull(),
	matchConfidence: numeric("match_confidence", { precision: 3, scale: 2 }),
	matchedPaymentId: uuid("matched_payment_id"),
	matchedExpenseId: uuid("matched_expense_id"),
	matchedBankTransactionId: uuid("matched_bank_transaction_id"),
	autoCategory: text("auto_category"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("bsl_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("bsl_date_idx").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.transactionDate.asc().nullsLast().op("uuid_ops")),
	index("bsl_dedup_idx").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.transactionDate.asc().nullsLast().op("uuid_ops"), table.debit.asc().nullsLast().op("numeric_ops"), table.credit.asc().nullsLast().op("uuid_ops"), table.referenceNumber.asc().nullsLast().op("uuid_ops")),
	index("bsl_import_idx").using("btree", table.importId.asc().nullsLast().op("uuid_ops")),
	index("bsl_status_idx").using("btree", table.importId.asc().nullsLast().op("enum_ops"), table.matchStatus.asc().nullsLast().op("enum_ops")),
	foreignKey({
		columns: [table.importId],
		foreignColumns: [bankStatementImports.id],
		name: "bank_statement_lines_import_id_bank_statement_imports_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "bank_statement_lines_business_id_businesses_id_fk"
	}).onDelete("cascade"),
]);

export const businessMembers = pgTable("business_members", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: businessMemberRole().default('member').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("business_members_business_user_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	index("business_members_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "business_members_business_id_businesses_id_fk"
	}).onDelete("cascade"),
]);

export const bankCategorizationRules = pgTable("bank_categorization_rules", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	bankAccountId: uuid("bank_account_id"),
	matchField: text("match_field").notNull(),
	matchType: text("match_type").notNull(),
	matchValue: text("match_value").notNull(),
	action: text().notNull(),
	expenseCategory: text("expense_category"),
	partyId: uuid("party_id"),
	priority: integer().default(0).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	hitCount: integer("hit_count").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("bcr_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "bank_categorization_rules_business_id_businesses_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.bankAccountId],
		foreignColumns: [bankAccounts.id],
		name: "bank_categorization_rules_bank_account_id_bank_accounts_id_fk"
	}).onDelete("cascade"),
]);

export const eInvoiceConfigs = pgTable("e_invoice_configs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	gstin: text().notNull(),
	clientId: text("client_id").notNull(),
	clientSecret: text("client_secret").notNull(),
	username: text().notNull(),
	password: text().notNull(),
	authToken: text("auth_token"),
	tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true, mode: 'string' }),
	isSandbox: boolean("is_sandbox").default(true).notNull(),
	isEnabled: boolean("is_enabled").default(false).notNull(),
	thresholdCrore: numeric("threshold_crore", { precision: 5, scale: 2 }).default('5').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("einv_config_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "e_invoice_configs_business_id_businesses_id_fk"
	}).onDelete("cascade"),
]);

export const ewayBills = pgTable("eway_bills", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	invoiceId: uuid("invoice_id"),
	ewbNumber: text("ewb_number"),
	ewbDate: timestamp("ewb_date", { withTimezone: true, mode: 'string' }),
	validUpto: timestamp("valid_upto", { withTimezone: true, mode: 'string' }),
	status: ewayBillStatus().default('generated').notNull(),
	transporterId: text("transporter_id"),
	transporterName: text("transporter_name"),
	vehicleNumber: text("vehicle_number"),
	vehicleType: text("vehicle_type"),
	transportMode: text("transport_mode"),
	distance: integer(),
	fromAddress: text("from_address"),
	fromPincode: text("from_pincode"),
	fromState: text("from_state"),
	toAddress: text("to_address"),
	toPincode: text("to_pincode"),
	toState: text("to_state"),
	cancelReason: text("cancel_reason"),
	apiResponse: jsonb("api_response"),
	createdByUserId: uuid("created_by_user_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ewb_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("ewb_invoice_idx").using("btree", table.invoiceId.asc().nullsLast().op("uuid_ops")),
	index("ewb_number_idx").using("btree", table.ewbNumber.asc().nullsLast().op("text_ops")),
	index("ewb_status_idx").using("btree", table.businessId.asc().nullsLast().op("enum_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	index("ewb_validity_idx").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.validUpto.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "eway_bills_business_id_businesses_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.invoiceId],
		foreignColumns: [invoices.id],
		name: "eway_bills_invoice_id_invoices_id_fk"
	}).onDelete("set null"),
]);

export const expenses = pgTable("expenses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	category: text().notNull(),
	description: text(),
	amount: numeric({ precision: 15, scale: 2 }).notNull(),
	mode: paymentMode().notNull(),
	expenseDate: timestamp("expense_date", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	referenceNumber: text("reference_number"),
	bankAccountId: uuid("bank_account_id"),
	createdByUserId: uuid("created_by_user_id"),
	createdByName: text("created_by_name"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("expenses_active_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.expenseDate.asc().nullsLast().op("uuid_ops")).where(sql`(deleted_at IS NULL)`),
	index("expenses_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("expenses_category_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.category.asc().nullsLast().op("text_ops")),
	index("expenses_date_idx").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.expenseDate.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "expenses_business_id_businesses_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.bankAccountId],
		foreignColumns: [bankAccounts.id],
		name: "expenses_bank_account_id_bank_accounts_id_fk"
	}),
]);

export const businesses = pgTable("businesses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	createdByUserId: uuid("created_by_user_id").notNull(),
	name: text().notNull(),
	legalName: text("legal_name"),
	gstRegistrationType: gstRegistrationType("gst_registration_type").default('unregistered').notNull(),
	gstin: text(),
	pan: text(),
	phone: text(),
	email: text(),
	address: text(),
	city: text(),
	state: text(),
	stateCode: text("state_code"),
	pincode: text(),
	logoUrl: text("logo_url"),
	// TODO: failed to parse database type 'bytea'
	logoData: unknown("logo_data"),
	logoMimeType: text("logo_mime_type"),
	logoWidth: integer("logo_width"),
	logoHeight: integer("logo_height"),
	logoUpdatedAt: timestamp("logo_updated_at", { withTimezone: true, mode: 'string' }),
	invoicePrefix: text("invoice_prefix").default('INV').notNull(),
	nextInvoiceNumber: integer("next_invoice_number").default(1).notNull(),
	paymentPrefix: text("payment_prefix").default('PAY').notNull(),
	nextPaymentNumber: integer("next_payment_number").default(1).notNull(),
	quotationPrefix: text("quotation_prefix").default('QTN').notNull(),
	nextQuotationNumber: integer("next_quotation_number").default(1).notNull(),
	creditNotePrefix: text("credit_note_prefix").default('CN').notNull(),
	nextCreditNoteNumber: integer("next_credit_note_number").default(1).notNull(),
	debitNotePrefix: text("debit_note_prefix").default('DN').notNull(),
	nextDebitNoteNumber: integer("next_debit_note_number").default(1).notNull(),
	salesReturnPrefix: text("sales_return_prefix").default('SR').notNull(),
	nextSalesReturnNumber: integer("next_sales_return_number").default(1).notNull(),
	purchaseReturnPrefix: text("purchase_return_prefix").default('PR').notNull(),
	nextPurchaseReturnNumber: integer("next_purchase_return_number").default(1).notNull(),
	deliveryChallanPrefix: text("delivery_challan_prefix").default('DC').notNull(),
	nextDeliveryChallanNumber: integer("next_delivery_challan_number").default(1).notNull(),
	proformaPrefix: text("proforma_prefix").default('PI').notNull(),
	nextProformaNumber: integer("next_proforma_number").default(1).notNull(),
	financialYearStartMonth: integer("financial_year_start_month").default(4).notNull(),
	currency: text().default('INR').notNull(),
	annualTurnover: numeric("annual_turnover", { precision: 15, scale: 2 }),
	storeEnabled: boolean("store_enabled").default(false).notNull(),
	storeSlug: text("store_slug"),
	storeTagline: text("store_tagline"),
	storeAccentColor: text("store_accent_color"),
	storeMinOrderAmount: numeric("store_min_order_amount", { precision: 15, scale: 2 }),
	storeDeliveryNote: text("store_delivery_note"),
	storeWhatsappNumber: text("store_whatsapp_number"),
	storeAllowNegativeStock: boolean("store_allow_negative_stock").default(false).notNull(),
	customShippingMethods: jsonb("custom_shipping_methods"),
	carrierCredentials: jsonb("carrier_credentials"),
	nextStoreOrderNumber: integer("next_store_order_number").default(1).notNull(),
	storeOrderPrefix: text("store_order_prefix").default('ORD').notNull(),
	posEnabled: boolean("pos_enabled").default(false).notNull(),
	defaultRoundOff: boolean("default_round_off").default(true).notNull(),
	defaultTermsAndConditions: text("default_terms_and_conditions"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("businesses_owner_idx").using("btree", table.createdByUserId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("businesses_store_slug_idx").using("btree", table.storeSlug.asc().nullsLast().op("text_ops")),
]);

export const bankStatementImports = pgTable("bank_statement_imports", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	bankAccountId: uuid("bank_account_id").notNull(),
	fileName: text("file_name").notNull(),
	status: bankStatementImportStatus().default('pending').notNull(),
	templateId: uuid("template_id"),
	templateVersion: integer("template_version"),
	columnMapping: jsonb("column_mapping"),
	totalLines: integer("total_lines").default(0).notNull(),
	matchedLines: integer("matched_lines").default(0).notNull(),
	unmatchedLines: integer("unmatched_lines").default(0).notNull(),
	statementStartDate: timestamp("statement_start_date", { withTimezone: true, mode: 'string' }),
	statementEndDate: timestamp("statement_end_date", { withTimezone: true, mode: 'string' }),
	closingBalance: numeric("closing_balance", { precision: 15, scale: 2 }),
	createdByUserId: uuid("created_by_user_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("bsi_bank_account_idx").using("btree", table.bankAccountId.asc().nullsLast().op("uuid_ops")),
	index("bsi_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "bank_statement_imports_business_id_businesses_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.bankAccountId],
		foreignColumns: [bankAccounts.id],
		name: "bank_statement_imports_bank_account_id_bank_accounts_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.templateId],
		foreignColumns: [bankStatementTemplates.id],
		name: "bank_statement_imports_template_id_bank_statement_templates_id_"
	}).onDelete("set null"),
]);

export const chartOfAccounts = pgTable("chart_of_accounts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	code: text().notNull(),
	name: text().notNull(),
	accountType: accountType("account_type").notNull(),
	parentId: uuid("parent_id"),
	isSystem: boolean("is_system").default(false).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("coa_business_code_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.code.asc().nullsLast().op("uuid_ops")),
	index("coa_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("coa_parent_idx").using("btree", table.parentId.asc().nullsLast().op("uuid_ops")),
	index("coa_type_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.accountType.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "chart_of_accounts_business_id_businesses_id_fk"
	}).onDelete("cascade"),
]);

export const invoiceItems = pgTable("invoice_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	invoiceId: uuid("invoice_id").notNull(),
	itemId: uuid("item_id"),
	itemName: text("item_name").notNull(),
	description: text(),
	quantity: numeric({ precision: 15, scale: 3 }).notNull(),
	unitPrice: numeric("unit_price", { precision: 15, scale: 2 }).notNull(),
	taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }).default('0').notNull(),
	taxAmount: numeric("tax_amount", { precision: 15, scale: 2 }).default('0').notNull(),
	discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).default('0').notNull(),
	totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	selectedUnit: text("selected_unit"),
	conversionFactor: numeric("conversion_factor", { precision: 10, scale: 4 }).default('1'),
	variantId: uuid("variant_id"),
}, (table) => [
	index("invoice_items_invoice_idx").using("btree", table.invoiceId.asc().nullsLast().op("uuid_ops")),
	index("invoice_items_item_idx").using("btree", table.itemId.asc().nullsLast().op("uuid_ops")),
	index("invoice_items_variant_idx").using("btree", table.variantId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.invoiceId],
		foreignColumns: [invoices.id],
		name: "invoice_items_invoice_id_invoices_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.itemId],
		foreignColumns: [items.id],
		name: "invoice_items_item_id_items_id_fk"
	}).onDelete("set null"),
	foreignKey({
		columns: [table.variantId],
		foreignColumns: [itemVariants.id],
		name: "invoice_items_variant_id_item_variants_id_fk"
	}).onDelete("set null"),
]);

export const items = pgTable("items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	name: text().notNull(),
	hsn: text(),
	sku: text(),
	unit: unit().default('pcs').notNull(),
	itemMode: itemMode("item_mode").default('simple').notNull(),
	unitVariants: jsonb("unit_variants"),
	variantAttributes: jsonb("variant_attributes"),
	salePrice: numeric("sale_price", { precision: 15, scale: 2 }),
	purchasePrice: numeric("purchase_price", { precision: 15, scale: 2 }),
	taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }).default('0').notNull(),
	stockQuantity: numeric("stock_quantity", { precision: 15, scale: 3 }).default('0').notNull(),
	lowStockAlert: numeric("low_stock_alert", { precision: 15, scale: 3 }),
	description: text(),
	itemType: itemType("item_type").default('product').notNull(),
	category: text(),
	taxInclusive: boolean("tax_inclusive").default(false).notNull(),
	source: text(),
	storeEnabled: boolean("store_enabled").default(false).notNull(),
	storePrice: numeric("store_price", { precision: 15, scale: 2 }),
	storeSortOrder: integer("store_sort_order").default(0).notNull(),
	storeCategory: text("store_category"),
	storeDescription: text("store_description"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("items_active_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.name.asc().nullsLast().op("text_ops")).where(sql`(deleted_at IS NULL)`),
	index("items_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("items_name_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.name.asc().nullsLast().op("uuid_ops")),
	index("items_sku_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.sku.asc().nullsLast().op("uuid_ops")),
	index("items_store_idx").using("btree", table.businessId.asc().nullsLast().op("bool_ops"), table.storeEnabled.asc().nullsLast().op("bool_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "items_business_id_businesses_id_fk"
	}).onDelete("cascade"),
]);

export const itemVariants = pgTable("item_variants", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	itemId: uuid("item_id").notNull(),
	attributeValues: jsonb("attribute_values").notNull(),
	sku: text(),
	salePrice: numeric("sale_price", { precision: 15, scale: 2 }),
	purchasePrice: numeric("purchase_price", { precision: 15, scale: 2 }),
	stockQuantity: numeric("stock_quantity", { precision: 15, scale: 3 }).default('0').notNull(),
	lowStockAlert: numeric("low_stock_alert", { precision: 15, scale: 3 }),
	storeEnabled: boolean("store_enabled").default(false).notNull(),
	storePrice: numeric("store_price", { precision: 15, scale: 2 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("item_variants_active_idx").using("btree", table.itemId.asc().nullsLast().op("uuid_ops")).where(sql`(deleted_at IS NULL)`),
	index("item_variants_item_idx").using("btree", table.itemId.asc().nullsLast().op("uuid_ops")),
	index("item_variants_sku_idx").using("btree", table.sku.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.itemId],
		foreignColumns: [items.id],
		name: "item_variants_item_id_items_id_fk"
	}).onDelete("cascade"),
]);

export const gstr2BUploads = pgTable("gstr2b_uploads", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	returnPeriod: text("return_period").notNull(),
	fileName: text("file_name").notNull(),
	uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	totalRecords: integer("total_records").default(0).notNull(),
	matchedRecords: integer("matched_records").default(0).notNull(),
	unmatchedRecords: integer("unmatched_records").default(0).notNull(),
	newRecords: integer("new_records").default(0).notNull(),
	createdByUserId: uuid("created_by_user_id"),
}, (table) => [
	index("g2b_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("g2b_period_idx").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.returnPeriod.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "gstr2b_uploads_business_id_businesses_id_fk"
	}).onDelete("cascade"),
]);

export const itcUtilizations = pgTable("itc_utilizations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	returnPeriod: text("return_period").notNull(),
	cgstUtilized: numeric("cgst_utilized", { precision: 15, scale: 2 }).default('0').notNull(),
	sgstUtilized: numeric("sgst_utilized", { precision: 15, scale: 2 }).default('0').notNull(),
	igstUtilizedAgainstCgst: numeric("igst_utilized_against_cgst", { precision: 15, scale: 2 }).default('0').notNull(),
	igstUtilizedAgainstSgst: numeric("igst_utilized_against_sgst", { precision: 15, scale: 2 }).default('0').notNull(),
	igstUtilizedAgainstIgst: numeric("igst_utilized_against_igst", { precision: 15, scale: 2 }).default('0').notNull(),
	notes: text(),
	createdByUserId: uuid("created_by_user_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("itc_util_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("itc_util_period_idx").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.returnPeriod.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "itc_utilizations_business_id_businesses_id_fk"
	}).onDelete("cascade"),
]);

export const journalEntries = pgTable("journal_entries", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	entryNumber: text("entry_number").notNull(),
	entryDate: timestamp("entry_date", { withTimezone: true, mode: 'string' }).notNull(),
	narration: text(),
	source: text().default('manual').notNull(),
	isVoided: boolean("is_voided").default(false).notNull(),
	voidedByEntryId: uuid("voided_by_entry_id"),
	reversesEntryId: uuid("reverses_entry_id"),
	createdByUserId: uuid("created_by_user_id"),
	createdByName: text("created_by_name"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("je_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("je_date_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.entryDate.asc().nullsLast().op("timestamptz_ops")),
	uniqueIndex("je_number_idx").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.entryNumber.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "journal_entries_business_id_businesses_id_fk"
	}).onDelete("cascade"),
]);

export const itcLedgerEntries = pgTable("itc_ledger_entries", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	invoiceId: uuid("invoice_id"),
	returnPeriod: text("return_period").notNull(),
	status: itcStatus().notNull(),
	cgst: numeric({ precision: 15, scale: 2 }).default('0').notNull(),
	sgst: numeric({ precision: 15, scale: 2 }).default('0').notNull(),
	igst: numeric({ precision: 15, scale: 2 }).default('0').notNull(),
	cess: numeric({ precision: 15, scale: 2 }).default('0').notNull(),
	isReverseCharge: boolean("is_reverse_charge").default(false).notNull(),
	blockReason: text("block_reason"),
	reversalReason: text("reversal_reason"),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("itc_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("itc_invoice_idx").using("btree", table.invoiceId.asc().nullsLast().op("uuid_ops")),
	index("itc_period_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.returnPeriod.asc().nullsLast().op("text_ops")),
	index("itc_status_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "itc_ledger_entries_business_id_businesses_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.invoiceId],
		foreignColumns: [invoices.id],
		name: "itc_ledger_entries_invoice_id_invoices_id_fk"
	}).onDelete("set null"),
]);

export const journalEntryLines = pgTable("journal_entry_lines", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	journalEntryId: uuid("journal_entry_id").notNull(),
	accountId: uuid("account_id").notNull(),
	debit: numeric({ precision: 15, scale: 2 }).default('0').notNull(),
	credit: numeric({ precision: 15, scale: 2 }).default('0').notNull(),
	narration: text(),
}, (table) => [
	index("jel_account_idx").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("jel_entry_idx").using("btree", table.journalEntryId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.journalEntryId],
		foreignColumns: [journalEntries.id],
		name: "journal_entry_lines_journal_entry_id_journal_entries_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.accountId],
		foreignColumns: [chartOfAccounts.id],
		name: "journal_entry_lines_account_id_chart_of_accounts_id_fk"
	}).onDelete("restrict"),
]);

export const journalEntryTemplates = pgTable("journal_entry_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	name: text().notNull(),
	narration: text(),
	lines: jsonb().notNull(),
	createdByUserId: uuid("created_by_user_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("jet_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "journal_entry_templates_business_id_businesses_id_fk"
	}).onDelete("cascade"),
]);

export const invoices = pgTable("invoices", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	partyId: uuid("party_id").notNull(),
	type: invoiceType().notNull(),
	status: invoiceStatus().default('draft').notNull(),
	documentType: documentType("document_type").default('invoice').notNull(),
	invoiceNumber: text("invoice_number").notNull(),
	invoiceDate: timestamp("invoice_date", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	dueDate: timestamp("due_date", { withTimezone: true, mode: 'string' }),
	subtotal: numeric({ precision: 15, scale: 2 }).default('0').notNull(),
	taxAmount: numeric("tax_amount", { precision: 15, scale: 2 }).default('0').notNull(),
	discountAmount: numeric("discount_amount", { precision: 15, scale: 2 }).default('0').notNull(),
	charges: jsonb(),
	additionalCharges: numeric("additional_charges", { precision: 15, scale: 2 }).default('0').notNull(),
	roundOff: numeric("round_off", { precision: 15, scale: 2 }).default('0').notNull(),
	totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).default('0').notNull(),
	amountPaid: numeric("amount_paid", { precision: 15, scale: 2 }).default('0').notNull(),
	notes: text(),
	termsAndConditions: text("terms_and_conditions"),
	referenceDocumentId: uuid("reference_document_id"),
	createdByUserId: uuid("created_by_user_id"),
	createdByName: text("created_by_name"),
	deliveryMethod: text("delivery_method").default('self_pickup'),
	isReverseCharge: boolean("is_reverse_charge").default(false).notNull(),
	source: text(),
	irn: text(),
	irnAckNumber: text("irn_ack_number"),
	irnAckDate: timestamp("irn_ack_date", { withTimezone: true, mode: 'string' }),
	signedQrCode: text("signed_qr_code"),
	signedInvoice: jsonb("signed_invoice"),
	eInvoiceStatus: text("e_invoice_status"),
	eInvoiceError: text("e_invoice_error"),
	eInvoiceRetryCount: integer("e_invoice_retry_count").default(0),
	eInvoiceCancelReason: text("e_invoice_cancel_reason"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("invoices_active_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.invoiceDate.asc().nullsLast().op("timestamptz_ops")).where(sql`(deleted_at IS NULL)`),
	index("invoices_active_type_idx").using("btree", table.businessId.asc().nullsLast().op("enum_ops"), table.type.asc().nullsLast().op("uuid_ops"), table.documentType.asc().nullsLast().op("enum_ops"), table.invoiceDate.asc().nullsLast().op("uuid_ops")).where(sql`(deleted_at IS NULL)`),
	index("invoices_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("invoices_date_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.invoiceDate.asc().nullsLast().op("timestamptz_ops")),
	index("invoices_doc_type_idx").using("btree", table.businessId.asc().nullsLast().op("enum_ops"), table.documentType.asc().nullsLast().op("uuid_ops")),
	index("invoices_einvoice_status_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.eInvoiceStatus.asc().nullsLast().op("text_ops")),
	uniqueIndex("invoices_number_idx").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.invoiceNumber.asc().nullsLast().op("text_ops")),
	index("invoices_party_date_idx").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.partyId.asc().nullsLast().op("timestamptz_ops"), table.invoiceDate.asc().nullsLast().op("timestamptz_ops")),
	index("invoices_party_idx").using("btree", table.partyId.asc().nullsLast().op("uuid_ops")),
	index("invoices_ref_doc_idx").using("btree", table.referenceDocumentId.asc().nullsLast().op("uuid_ops")),
	index("invoices_status_idx").using("btree", table.businessId.asc().nullsLast().op("enum_ops"), table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "invoices_business_id_businesses_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.partyId],
		foreignColumns: [parties.id],
		name: "invoices_party_id_parties_id_fk"
	}).onDelete("restrict"),
]);

export const payments = pgTable("payments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	paymentNumber: text("payment_number"),
	businessId: uuid("business_id").notNull(),
	invoiceId: uuid("invoice_id"),
	partyId: uuid("party_id").notNull(),
	amount: numeric({ precision: 15, scale: 2 }).notNull(),
	discount: numeric({ precision: 15, scale: 2 }).default('0').notNull(),
	mode: paymentMode().notNull(),
	referenceNumber: text("reference_number"),
	paymentDate: timestamp("payment_date", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	notes: text(),
	bankAccountId: uuid("bank_account_id"),
	createdByUserId: uuid("created_by_user_id"),
	createdByName: text("created_by_name"),
	source: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("payments_active_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.paymentDate.asc().nullsLast().op("timestamptz_ops")).where(sql`(deleted_at IS NULL)`),
	index("payments_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("payments_date_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.paymentDate.asc().nullsLast().op("uuid_ops")),
	index("payments_invoice_idx").using("btree", table.invoiceId.asc().nullsLast().op("uuid_ops")),
	index("payments_party_date_idx").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.partyId.asc().nullsLast().op("timestamptz_ops"), table.paymentDate.asc().nullsLast().op("uuid_ops")),
	index("payments_party_idx").using("btree", table.partyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "payments_business_id_businesses_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.invoiceId],
		foreignColumns: [invoices.id],
		name: "payments_invoice_id_invoices_id_fk"
	}).onDelete("set null"),
	foreignKey({
		columns: [table.partyId],
		foreignColumns: [parties.id],
		name: "payments_party_id_parties_id_fk"
	}).onDelete("restrict"),
]);

export const recurringInvoiceTemplates = pgTable("recurring_invoice_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	partyId: uuid("party_id").notNull(),
	name: text().notNull(),
	type: invoiceType().notNull(),
	frequency: recurringFrequency().notNull(),
	customIntervalDays: integer("custom_interval_days"),
	lineItems: jsonb("line_items").notNull(),
	notes: text(),
	termsAndConditions: text("terms_and_conditions"),
	additionalCharges: numeric("additional_charges", { precision: 15, scale: 2 }).default('0').notNull(),
	charges: jsonb(),
	status: recurringTemplateStatus().default('active').notNull(),
	startDate: timestamp("start_date", { withTimezone: true, mode: 'string' }).notNull(),
	endDate: timestamp("end_date", { withTimezone: true, mode: 'string' }),
	nextRunDate: timestamp("next_run_date", { withTimezone: true, mode: 'string' }).notNull(),
	lastRunDate: timestamp("last_run_date", { withTimezone: true, mode: 'string' }),
	totalRuns: integer("total_runs").default(0).notNull(),
	maxRuns: integer("max_runs"),
	createdByUserId: uuid("created_by_user_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("recurring_tpl_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("recurring_tpl_next_run_idx").using("btree", table.status.asc().nullsLast().op("timestamptz_ops"), table.nextRunDate.asc().nullsLast().op("enum_ops")),
	index("recurring_tpl_party_idx").using("btree", table.partyId.asc().nullsLast().op("uuid_ops")),
	index("recurring_tpl_status_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "recurring_invoice_templates_business_id_businesses_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.partyId],
		foreignColumns: [parties.id],
		name: "recurring_invoice_templates_party_id_parties_id_fk"
	}).onDelete("restrict"),
]);

export const paymentGatewayConfigs = pgTable("payment_gateway_configs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	bankAccountId: uuid("bank_account_id").notNull(),
	settlementAccountId: uuid("settlement_account_id").notNull(),
	chargeConfig: jsonb("charge_config").notNull(),
	expenseCategory: text("expense_category").default('Payment Gateway Charges').notNull(),
	autoSettle: boolean("auto_settle").default(true).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("pg_config_account_idx").using("btree", table.bankAccountId.asc().nullsLast().op("uuid_ops")),
	index("pg_config_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "payment_gateway_configs_business_id_businesses_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.bankAccountId],
		foreignColumns: [bankAccounts.id],
		name: "payment_gateway_configs_bank_account_id_bank_accounts_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.settlementAccountId],
		foreignColumns: [bankAccounts.id],
		name: "payment_gateway_configs_settlement_account_id_bank_accounts_id_"
	}).onDelete("restrict"),
]);

export const salesTargets = pgTable("sales_targets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	userId: uuid("user_id").notNull(),
	targetType: text("target_type").notNull(),
	targetValue: numeric("target_value", { precision: 15, scale: 2 }).notNull(),
	itemId: uuid("item_id"),
	periodType: text("period_type").notNull(),
	periodStart: timestamp("period_start", { withTimezone: true, mode: 'string' }).notNull(),
	periodEnd: timestamp("period_end", { withTimezone: true, mode: 'string' }).notNull(),
	notes: text(),
	createdByUserId: uuid("created_by_user_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("sales_targets_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("sales_targets_period_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.periodStart.asc().nullsLast().op("timestamptz_ops"), table.periodEnd.asc().nullsLast().op("uuid_ops")),
	index("sales_targets_user_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "sales_targets_business_id_businesses_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.itemId],
		foreignColumns: [items.id],
		name: "sales_targets_item_id_items_id_fk"
	}).onDelete("set null"),
]);

export const shipments = pgTable("shipments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	invoiceId: uuid("invoice_id"),
	partyId: uuid("party_id"),
	carrier: text(),
	mode: text(),
	trackingNumber: text("tracking_number"),
	trackingUrl: text("tracking_url"),
	cost: numeric({ precision: 15, scale: 2 }).default('0').notNull(),
	weight: numeric({ precision: 10, scale: 3 }),
	shippingAddress: text("shipping_address"),
	shippingCity: text("shipping_city"),
	shippingPincode: text("shipping_pincode"),
	carrierOrderId: text("carrier_order_id"),
	labelUrl: text("label_url"),
	manifestId: text("manifest_id"),
	carrierMeta: jsonb("carrier_meta"),
	status: shipmentStatus().default('pending').notNull(),
	shipmentDate: timestamp("shipment_date", { withTimezone: true, mode: 'string' }),
	estimatedDelivery: timestamp("estimated_delivery", { withTimezone: true, mode: 'string' }),
	actualDelivery: timestamp("actual_delivery", { withTimezone: true, mode: 'string' }),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("shipments_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("shipments_carrier_order_idx").using("btree", table.carrierOrderId.asc().nullsLast().op("text_ops")),
	index("shipments_date_idx").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.shipmentDate.asc().nullsLast().op("uuid_ops")),
	index("shipments_invoice_idx").using("btree", table.invoiceId.asc().nullsLast().op("uuid_ops")),
	index("shipments_party_idx").using("btree", table.partyId.asc().nullsLast().op("uuid_ops")),
	index("shipments_status_idx").using("btree", table.businessId.asc().nullsLast().op("enum_ops"), table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "shipments_business_id_businesses_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.invoiceId],
		foreignColumns: [invoices.id],
		name: "shipments_invoice_id_invoices_id_fk"
	}).onDelete("set null"),
	foreignKey({
		columns: [table.partyId],
		foreignColumns: [parties.id],
		name: "shipments_party_id_parties_id_fk"
	}).onDelete("set null"),
]);

export const shipmentEvents = pgTable("shipment_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	shipmentId: uuid("shipment_id").notNull(),
	status: text().notNull(),
	statusDetail: text("status_detail"),
	location: text(),
	source: text().default('manual'),
	carrierStatus: text("carrier_status"),
	eventTime: timestamp("event_time", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("shipment_events_shipment_idx").using("btree", table.shipmentId.asc().nullsLast().op("uuid_ops")),
	index("shipment_events_time_idx").using("btree", table.shipmentId.asc().nullsLast().op("timestamptz_ops"), table.eventTime.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
		columns: [table.shipmentId],
		foreignColumns: [shipments.id],
		name: "shipment_events_shipment_id_shipments_id_fk"
	}).onDelete("cascade"),
]);

export const stockAdjustments = pgTable("stock_adjustments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	itemId: uuid("item_id").notNull(),
	variantId: uuid("variant_id"),
	quantity: numeric({ precision: 15, scale: 3 }).notNull(),
	previousStock: numeric("previous_stock", { precision: 15, scale: 3 }).notNull(),
	newStock: numeric("new_stock", { precision: 15, scale: 3 }).notNull(),
	reason: text(),
	adjustmentDate: timestamp("adjustment_date", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdByUserId: uuid("created_by_user_id"),
	createdByName: text("created_by_name"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("stock_adj_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("stock_adj_date_idx").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.adjustmentDate.asc().nullsLast().op("uuid_ops")),
	index("stock_adj_item_idx").using("btree", table.itemId.asc().nullsLast().op("uuid_ops")),
	index("stock_adj_variant_idx").using("btree", table.variantId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "stock_adjustments_business_id_businesses_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.itemId],
		foreignColumns: [items.id],
		name: "stock_adjustments_item_id_items_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.variantId],
		foreignColumns: [itemVariants.id],
		name: "stock_adjustments_variant_id_item_variants_id_fk"
	}).onDelete("cascade"),
]);

export const storeOrders = pgTable("store_orders", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	invoiceId: uuid("invoice_id"),
	orderNumber: text("order_number").notNull(),
	status: storeOrderStatus().default('pending').notNull(),
	customerName: text("customer_name").notNull(),
	customerPhone: text("customer_phone").notNull(),
	customerEmail: text("customer_email"),
	deliveryAddress: text("delivery_address"),
	deliveryCity: text("delivery_city"),
	deliveryPincode: text("delivery_pincode"),
	deliveryNotes: text("delivery_notes"),
	totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).default('0').notNull(),
	itemCount: integer("item_count").default(0).notNull(),
	source: text().default('online_store').notNull(),
	confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: 'string' }),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }),
	cancellationReason: text("cancellation_reason"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("store_orders_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("store_orders_date_idx").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")),
	index("store_orders_invoice_idx").using("btree", table.invoiceId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("store_orders_number_idx").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.orderNumber.asc().nullsLast().op("uuid_ops")),
	index("store_orders_phone_idx").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.customerPhone.asc().nullsLast().op("uuid_ops")),
	index("store_orders_status_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "store_orders_business_id_businesses_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.invoiceId],
		foreignColumns: [invoices.id],
		name: "store_orders_invoice_id_invoices_id_fk"
	}).onDelete("set null"),
]);

export const accessTokens = pgTable("access_tokens", {
	id: text().primaryKey().notNull(),
	sessionId: text("session_id").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("access_tokens_expires_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	index("access_tokens_session_idx").using("btree", table.sessionId.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.sessionId],
		foreignColumns: [sessions.id],
		name: "access_tokens_session_id_sessions_id_fk"
	}).onDelete("cascade"),
]);

export const ewayBillVehicleUpdates = pgTable("eway_bill_vehicle_updates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ewayBillId: uuid("eway_bill_id").notNull(),
	vehicleNumber: text("vehicle_number").notNull(),
	fromPlace: text("from_place"),
	reason: text(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ewb_vehicle_ewb_idx").using("btree", table.ewayBillId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.ewayBillId],
		foreignColumns: [ewayBills.id],
		name: "eway_bill_vehicle_updates_eway_bill_id_eway_bills_id_fk"
	}).onDelete("cascade"),
]);

export const recurringInvoiceRuns = pgTable("recurring_invoice_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	templateId: uuid("template_id").notNull(),
	businessId: uuid("business_id").notNull(),
	invoiceId: uuid("invoice_id"),
	status: recurringRunStatus().notNull(),
	errorMessage: text("error_message"),
	executedAt: timestamp("executed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("recurring_run_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("recurring_run_executed_idx").using("btree", table.businessId.asc().nullsLast().op("timestamptz_ops"), table.executedAt.asc().nullsLast().op("timestamptz_ops")),
	index("recurring_run_template_idx").using("btree", table.templateId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.templateId],
		foreignColumns: [recurringInvoiceTemplates.id],
		name: "recurring_invoice_runs_template_id_recurring_invoice_templates_"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "recurring_invoice_runs_business_id_businesses_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.invoiceId],
		foreignColumns: [invoices.id],
		name: "recurring_invoice_runs_invoice_id_invoices_id_fk"
	}).onDelete("set null"),
]);

export const gstr2BRecords = pgTable("gstr2b_records", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	uploadId: uuid("upload_id").notNull(),
	businessId: uuid("business_id").notNull(),
	supplierGstin: text("supplier_gstin").notNull(),
	supplierName: text("supplier_name"),
	invoiceNumber: text("invoice_number").notNull(),
	invoiceDate: timestamp("invoice_date", { withTimezone: true, mode: 'string' }),
	invoiceValue: numeric("invoice_value", { precision: 15, scale: 2 }).default('0').notNull(),
	taxableValue: numeric("taxable_value", { precision: 15, scale: 2 }).default('0').notNull(),
	cgst: numeric({ precision: 15, scale: 2 }).default('0').notNull(),
	sgst: numeric({ precision: 15, scale: 2 }).default('0').notNull(),
	igst: numeric({ precision: 15, scale: 2 }).default('0').notNull(),
	cess: numeric({ precision: 15, scale: 2 }).default('0').notNull(),
	itcAvailable: text("itc_available"),
	reason: text(),
	sourceType: text("source_type"),
	matchStatus: text("match_status").default('pending').notNull(),
	matchedInvoiceId: uuid("matched_invoice_id"),
	mismatchReasons: jsonb("mismatch_reasons"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("g2br_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("g2br_gstin_idx").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.supplierGstin.asc().nullsLast().op("text_ops")),
	index("g2br_match_idx").using("btree", table.uploadId.asc().nullsLast().op("text_ops"), table.matchStatus.asc().nullsLast().op("uuid_ops")),
	index("g2br_upload_idx").using("btree", table.uploadId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.uploadId],
		foreignColumns: [gstr2BUploads.id],
		name: "gstr2b_records_upload_id_gstr2b_uploads_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "gstr2b_records_business_id_businesses_id_fk"
	}).onDelete("cascade"),
]);

export const parties = pgTable("parties", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	businessId: uuid("business_id").notNull(),
	type: partyType().notNull(),
	name: text().notNull(),
	phone: text(),
	email: text(),
	gstin: text(),
	pan: text(),
	billingAddress: text("billing_address"),
	shippingAddress: text("shipping_address"),
	city: text(),
	state: text(),
	stateCode: text("state_code"),
	pincode: text(),
	openingBalance: numeric("opening_balance", { precision: 15, scale: 2 }).default('0').notNull(),
	category: text(),
	creditPeriodDays: integer("credit_period_days"),
	creditLimit: numeric("credit_limit", { precision: 15, scale: 2 }),
	contactPersonName: text("contact_person_name"),
	contactPersonDob: timestamp("contact_person_dob", { withTimezone: true, mode: 'string' }),
	bankAccountNumber: text("bank_account_number"),
	bankIfsc: text("bank_ifsc"),
	bankName: text("bank_name"),
	source: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("parties_business_idx").using("btree", table.businessId.asc().nullsLast().op("uuid_ops")),
	index("parties_name_idx").using("btree", table.businessId.asc().nullsLast().op("text_ops"), table.name.asc().nullsLast().op("uuid_ops")),
	index("parties_type_idx").using("btree", table.businessId.asc().nullsLast().op("enum_ops"), table.type.asc().nullsLast().op("enum_ops")),
	foreignKey({
		columns: [table.businessId],
		foreignColumns: [businesses.id],
		name: "parties_business_id_businesses_id_fk"
	}).onDelete("cascade"),
]);

export const paymentAllocations = pgTable("payment_allocations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	paymentId: uuid("payment_id").notNull(),
	invoiceId: uuid("invoice_id").notNull(),
	amount: numeric({ precision: 15, scale: 2 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("payment_alloc_invoice_idx").using("btree", table.invoiceId.asc().nullsLast().op("uuid_ops")),
	index("payment_alloc_payment_idx").using("btree", table.paymentId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
		columns: [table.paymentId],
		foreignColumns: [payments.id],
		name: "payment_allocations_payment_id_payments_id_fk"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.invoiceId],
		foreignColumns: [invoices.id],
		name: "payment_allocations_invoice_id_invoices_id_fk"
	}).onDelete("cascade"),
]);
