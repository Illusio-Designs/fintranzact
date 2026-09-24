import { relations } from "drizzle-orm/relations";
import { businesses, premises, warehouses, warehouseLocations, users, magicLinkTokens, tenants, tenantMembers, apiKeys, invitations, auditLog, bankAccounts, sessions, bankStatementTemplates, bankTransactions, bankStatementImports, bankStatementLines, businessMembers, bankCategorizationRules, eInvoiceConfigs, ewayBills, invoices, expenses, chartOfAccounts, invoiceItems, items, itemVariants, gstr2BUploads, itcUtilizations, journalEntries, itcLedgerEntries, journalEntryLines, journalEntryTemplates, parties, payments, recurringInvoiceTemplates, paymentGatewayConfigs, salesTargets, shipments, shipmentEvents, stockAdjustments, storeOrders, accessTokens, ewayBillVehicleUpdates, recurringInvoiceRuns, gstr2BRecords, paymentAllocations } from "./schema";

export const premisesRelations = relations(premises, ({one, many}) => ({
	business: one(businesses, {
		fields: [premises.businessId],
		references: [businesses.id]
	}),
	warehouses: many(warehouses),
}));

export const businessesRelations = relations(businesses, ({many}) => ({
	premises: many(premises),
	warehouses: many(warehouses),
	auditLogs: many(auditLog),
	bankAccounts: many(bankAccounts),
	bankStatementTemplates: many(bankStatementTemplates),
	bankTransactions: many(bankTransactions),
	bankStatementLines: many(bankStatementLines),
	businessMembers: many(businessMembers),
	bankCategorizationRules: many(bankCategorizationRules),
	eInvoiceConfigs: many(eInvoiceConfigs),
	ewayBills: many(ewayBills),
	expenses: many(expenses),
	bankStatementImports: many(bankStatementImports),
	chartOfAccounts: many(chartOfAccounts),
	items: many(items),
	gstr2BUploads: many(gstr2BUploads),
	itcUtilizations: many(itcUtilizations),
	journalEntries: many(journalEntries),
	itcLedgerEntries: many(itcLedgerEntries),
	journalEntryTemplates: many(journalEntryTemplates),
	invoices: many(invoices),
	payments: many(payments),
	recurringInvoiceTemplates: many(recurringInvoiceTemplates),
	paymentGatewayConfigs: many(paymentGatewayConfigs),
	salesTargets: many(salesTargets),
	shipments: many(shipments),
	stockAdjustments: many(stockAdjustments),
	storeOrders: many(storeOrders),
	recurringInvoiceRuns: many(recurringInvoiceRuns),
	gstr2BRecords: many(gstr2BRecords),
	parties: many(parties),
}));

export const warehousesRelations = relations(warehouses, ({one, many}) => ({
	business: one(businesses, {
		fields: [warehouses.businessId],
		references: [businesses.id]
	}),
	premises: one(premises, {
		fields: [warehouses.premiseId],
		references: [premises.id]
	}),
	warehouseLocations: many(warehouseLocations),
}));

export const warehouseLocationsRelations = relations(warehouseLocations, ({one}) => ({
	warehouse: one(warehouses, {
		fields: [warehouseLocations.warehouseId],
		references: [warehouses.id]
	}),
}));

export const magicLinkTokensRelations = relations(magicLinkTokens, ({one}) => ({
	user: one(users, {
		fields: [magicLinkTokens.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	magicLinkTokens: many(magicLinkTokens),
	tenantMembers_userId: many(tenantMembers, {
		relationName: "tenantMembers_userId_users_id"
	}),
	tenantMembers_invitedBy: many(tenantMembers, {
		relationName: "tenantMembers_invitedBy_users_id"
	}),
	apiKeys: many(apiKeys),
	invitations: many(invitations),
	sessions: many(sessions),
}));

export const tenantMembersRelations = relations(tenantMembers, ({one}) => ({
	tenant: one(tenants, {
		fields: [tenantMembers.tenantId],
		references: [tenants.id]
	}),
	user_userId: one(users, {
		fields: [tenantMembers.userId],
		references: [users.id],
		relationName: "tenantMembers_userId_users_id"
	}),
	user_invitedBy: one(users, {
		fields: [tenantMembers.invitedBy],
		references: [users.id],
		relationName: "tenantMembers_invitedBy_users_id"
	}),
}));

export const tenantsRelations = relations(tenants, ({many}) => ({
	tenantMembers: many(tenantMembers),
	apiKeys: many(apiKeys),
	invitations: many(invitations),
	sessions: many(sessions),
}));

export const apiKeysRelations = relations(apiKeys, ({one}) => ({
	user: one(users, {
		fields: [apiKeys.userId],
		references: [users.id]
	}),
	tenant: one(tenants, {
		fields: [apiKeys.tenantId],
		references: [tenants.id]
	}),
}));

export const invitationsRelations = relations(invitations, ({one}) => ({
	tenant: one(tenants, {
		fields: [invitations.tenantId],
		references: [tenants.id]
	}),
	user: one(users, {
		fields: [invitations.invitedBy],
		references: [users.id]
	}),
}));

export const auditLogRelations = relations(auditLog, ({one}) => ({
	business: one(businesses, {
		fields: [auditLog.businessId],
		references: [businesses.id]
	}),
}));

export const bankAccountsRelations = relations(bankAccounts, ({one, many}) => ({
	business: one(businesses, {
		fields: [bankAccounts.businessId],
		references: [businesses.id]
	}),
	bankTransactions: many(bankTransactions),
	bankCategorizationRules: many(bankCategorizationRules),
	expenses: many(expenses),
	bankStatementImports: many(bankStatementImports),
	paymentGatewayConfigs_bankAccountId: many(paymentGatewayConfigs, {
		relationName: "paymentGatewayConfigs_bankAccountId_bankAccounts_id"
	}),
	paymentGatewayConfigs_settlementAccountId: many(paymentGatewayConfigs, {
		relationName: "paymentGatewayConfigs_settlementAccountId_bankAccounts_id"
	}),
}));

export const sessionsRelations = relations(sessions, ({one, many}) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id]
	}),
	tenant: one(tenants, {
		fields: [sessions.tenantId],
		references: [tenants.id]
	}),
	accessTokens: many(accessTokens),
}));

export const bankStatementTemplatesRelations = relations(bankStatementTemplates, ({one, many}) => ({
	business: one(businesses, {
		fields: [bankStatementTemplates.businessId],
		references: [businesses.id]
	}),
	bankStatementImports: many(bankStatementImports),
}));

export const bankTransactionsRelations = relations(bankTransactions, ({one}) => ({
	business: one(businesses, {
		fields: [bankTransactions.businessId],
		references: [businesses.id]
	}),
	bankAccount: one(bankAccounts, {
		fields: [bankTransactions.bankAccountId],
		references: [bankAccounts.id]
	}),
}));

export const bankStatementLinesRelations = relations(bankStatementLines, ({one}) => ({
	bankStatementImport: one(bankStatementImports, {
		fields: [bankStatementLines.importId],
		references: [bankStatementImports.id]
	}),
	business: one(businesses, {
		fields: [bankStatementLines.businessId],
		references: [businesses.id]
	}),
}));

export const bankStatementImportsRelations = relations(bankStatementImports, ({one, many}) => ({
	bankStatementLines: many(bankStatementLines),
	business: one(businesses, {
		fields: [bankStatementImports.businessId],
		references: [businesses.id]
	}),
	bankAccount: one(bankAccounts, {
		fields: [bankStatementImports.bankAccountId],
		references: [bankAccounts.id]
	}),
	bankStatementTemplate: one(bankStatementTemplates, {
		fields: [bankStatementImports.templateId],
		references: [bankStatementTemplates.id]
	}),
}));

export const businessMembersRelations = relations(businessMembers, ({one}) => ({
	business: one(businesses, {
		fields: [businessMembers.businessId],
		references: [businesses.id]
	}),
}));

export const bankCategorizationRulesRelations = relations(bankCategorizationRules, ({one}) => ({
	business: one(businesses, {
		fields: [bankCategorizationRules.businessId],
		references: [businesses.id]
	}),
	bankAccount: one(bankAccounts, {
		fields: [bankCategorizationRules.bankAccountId],
		references: [bankAccounts.id]
	}),
}));

export const eInvoiceConfigsRelations = relations(eInvoiceConfigs, ({one}) => ({
	business: one(businesses, {
		fields: [eInvoiceConfigs.businessId],
		references: [businesses.id]
	}),
}));

export const ewayBillsRelations = relations(ewayBills, ({one, many}) => ({
	business: one(businesses, {
		fields: [ewayBills.businessId],
		references: [businesses.id]
	}),
	invoice: one(invoices, {
		fields: [ewayBills.invoiceId],
		references: [invoices.id]
	}),
	ewayBillVehicleUpdates: many(ewayBillVehicleUpdates),
}));

export const invoicesRelations = relations(invoices, ({one, many}) => ({
	ewayBills: many(ewayBills),
	invoiceItems: many(invoiceItems),
	itcLedgerEntries: many(itcLedgerEntries),
	business: one(businesses, {
		fields: [invoices.businessId],
		references: [businesses.id]
	}),
	party: one(parties, {
		fields: [invoices.partyId],
		references: [parties.id]
	}),
	payments: many(payments),
	shipments: many(shipments),
	storeOrders: many(storeOrders),
	recurringInvoiceRuns: many(recurringInvoiceRuns),
	paymentAllocations: many(paymentAllocations),
}));

export const expensesRelations = relations(expenses, ({one}) => ({
	business: one(businesses, {
		fields: [expenses.businessId],
		references: [businesses.id]
	}),
	bankAccount: one(bankAccounts, {
		fields: [expenses.bankAccountId],
		references: [bankAccounts.id]
	}),
}));

export const chartOfAccountsRelations = relations(chartOfAccounts, ({one, many}) => ({
	business: one(businesses, {
		fields: [chartOfAccounts.businessId],
		references: [businesses.id]
	}),
	journalEntryLines: many(journalEntryLines),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({one}) => ({
	invoice: one(invoices, {
		fields: [invoiceItems.invoiceId],
		references: [invoices.id]
	}),
	item: one(items, {
		fields: [invoiceItems.itemId],
		references: [items.id]
	}),
	itemVariant: one(itemVariants, {
		fields: [invoiceItems.variantId],
		references: [itemVariants.id]
	}),
}));

export const itemsRelations = relations(items, ({one, many}) => ({
	invoiceItems: many(invoiceItems),
	business: one(businesses, {
		fields: [items.businessId],
		references: [businesses.id]
	}),
	itemVariants: many(itemVariants),
	salesTargets: many(salesTargets),
	stockAdjustments: many(stockAdjustments),
}));

export const itemVariantsRelations = relations(itemVariants, ({one, many}) => ({
	invoiceItems: many(invoiceItems),
	item: one(items, {
		fields: [itemVariants.itemId],
		references: [items.id]
	}),
	stockAdjustments: many(stockAdjustments),
}));

export const gstr2BUploadsRelations = relations(gstr2BUploads, ({one, many}) => ({
	business: one(businesses, {
		fields: [gstr2BUploads.businessId],
		references: [businesses.id]
	}),
	gstr2BRecords: many(gstr2BRecords),
}));

export const itcUtilizationsRelations = relations(itcUtilizations, ({one}) => ({
	business: one(businesses, {
		fields: [itcUtilizations.businessId],
		references: [businesses.id]
	}),
}));

export const journalEntriesRelations = relations(journalEntries, ({one, many}) => ({
	business: one(businesses, {
		fields: [journalEntries.businessId],
		references: [businesses.id]
	}),
	journalEntryLines: many(journalEntryLines),
}));

export const itcLedgerEntriesRelations = relations(itcLedgerEntries, ({one}) => ({
	business: one(businesses, {
		fields: [itcLedgerEntries.businessId],
		references: [businesses.id]
	}),
	invoice: one(invoices, {
		fields: [itcLedgerEntries.invoiceId],
		references: [invoices.id]
	}),
}));

export const journalEntryLinesRelations = relations(journalEntryLines, ({one}) => ({
	journalEntry: one(journalEntries, {
		fields: [journalEntryLines.journalEntryId],
		references: [journalEntries.id]
	}),
	chartOfAccount: one(chartOfAccounts, {
		fields: [journalEntryLines.accountId],
		references: [chartOfAccounts.id]
	}),
}));

export const journalEntryTemplatesRelations = relations(journalEntryTemplates, ({one}) => ({
	business: one(businesses, {
		fields: [journalEntryTemplates.businessId],
		references: [businesses.id]
	}),
}));

export const partiesRelations = relations(parties, ({one, many}) => ({
	invoices: many(invoices),
	payments: many(payments),
	recurringInvoiceTemplates: many(recurringInvoiceTemplates),
	shipments: many(shipments),
	business: one(businesses, {
		fields: [parties.businessId],
		references: [businesses.id]
	}),
}));

export const paymentsRelations = relations(payments, ({one, many}) => ({
	business: one(businesses, {
		fields: [payments.businessId],
		references: [businesses.id]
	}),
	invoice: one(invoices, {
		fields: [payments.invoiceId],
		references: [invoices.id]
	}),
	party: one(parties, {
		fields: [payments.partyId],
		references: [parties.id]
	}),
	paymentAllocations: many(paymentAllocations),
}));

export const recurringInvoiceTemplatesRelations = relations(recurringInvoiceTemplates, ({one, many}) => ({
	business: one(businesses, {
		fields: [recurringInvoiceTemplates.businessId],
		references: [businesses.id]
	}),
	party: one(parties, {
		fields: [recurringInvoiceTemplates.partyId],
		references: [parties.id]
	}),
	recurringInvoiceRuns: many(recurringInvoiceRuns),
}));

export const paymentGatewayConfigsRelations = relations(paymentGatewayConfigs, ({one}) => ({
	business: one(businesses, {
		fields: [paymentGatewayConfigs.businessId],
		references: [businesses.id]
	}),
	bankAccount_bankAccountId: one(bankAccounts, {
		fields: [paymentGatewayConfigs.bankAccountId],
		references: [bankAccounts.id],
		relationName: "paymentGatewayConfigs_bankAccountId_bankAccounts_id"
	}),
	bankAccount_settlementAccountId: one(bankAccounts, {
		fields: [paymentGatewayConfigs.settlementAccountId],
		references: [bankAccounts.id],
		relationName: "paymentGatewayConfigs_settlementAccountId_bankAccounts_id"
	}),
}));

export const salesTargetsRelations = relations(salesTargets, ({one}) => ({
	business: one(businesses, {
		fields: [salesTargets.businessId],
		references: [businesses.id]
	}),
	item: one(items, {
		fields: [salesTargets.itemId],
		references: [items.id]
	}),
}));

export const shipmentsRelations = relations(shipments, ({one, many}) => ({
	business: one(businesses, {
		fields: [shipments.businessId],
		references: [businesses.id]
	}),
	invoice: one(invoices, {
		fields: [shipments.invoiceId],
		references: [invoices.id]
	}),
	party: one(parties, {
		fields: [shipments.partyId],
		references: [parties.id]
	}),
	shipmentEvents: many(shipmentEvents),
}));

export const shipmentEventsRelations = relations(shipmentEvents, ({one}) => ({
	shipment: one(shipments, {
		fields: [shipmentEvents.shipmentId],
		references: [shipments.id]
	}),
}));

export const stockAdjustmentsRelations = relations(stockAdjustments, ({one}) => ({
	business: one(businesses, {
		fields: [stockAdjustments.businessId],
		references: [businesses.id]
	}),
	item: one(items, {
		fields: [stockAdjustments.itemId],
		references: [items.id]
	}),
	itemVariant: one(itemVariants, {
		fields: [stockAdjustments.variantId],
		references: [itemVariants.id]
	}),
}));

export const storeOrdersRelations = relations(storeOrders, ({one}) => ({
	business: one(businesses, {
		fields: [storeOrders.businessId],
		references: [businesses.id]
	}),
	invoice: one(invoices, {
		fields: [storeOrders.invoiceId],
		references: [invoices.id]
	}),
}));

export const accessTokensRelations = relations(accessTokens, ({one}) => ({
	session: one(sessions, {
		fields: [accessTokens.sessionId],
		references: [sessions.id]
	}),
}));

export const ewayBillVehicleUpdatesRelations = relations(ewayBillVehicleUpdates, ({one}) => ({
	ewayBill: one(ewayBills, {
		fields: [ewayBillVehicleUpdates.ewayBillId],
		references: [ewayBills.id]
	}),
}));

export const recurringInvoiceRunsRelations = relations(recurringInvoiceRuns, ({one}) => ({
	recurringInvoiceTemplate: one(recurringInvoiceTemplates, {
		fields: [recurringInvoiceRuns.templateId],
		references: [recurringInvoiceTemplates.id]
	}),
	business: one(businesses, {
		fields: [recurringInvoiceRuns.businessId],
		references: [businesses.id]
	}),
	invoice: one(invoices, {
		fields: [recurringInvoiceRuns.invoiceId],
		references: [invoices.id]
	}),
}));

export const gstr2BRecordsRelations = relations(gstr2BRecords, ({one}) => ({
	gstr2BUpload: one(gstr2BUploads, {
		fields: [gstr2BRecords.uploadId],
		references: [gstr2BUploads.id]
	}),
	business: one(businesses, {
		fields: [gstr2BRecords.businessId],
		references: [businesses.id]
	}),
}));

export const paymentAllocationsRelations = relations(paymentAllocations, ({one}) => ({
	payment: one(payments, {
		fields: [paymentAllocations.paymentId],
		references: [payments.id]
	}),
	invoice: one(invoices, {
		fields: [paymentAllocations.invoiceId],
		references: [invoices.id]
	}),
}));