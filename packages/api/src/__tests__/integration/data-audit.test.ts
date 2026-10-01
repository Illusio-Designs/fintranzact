/**
 * Layer 4 — data completeness.
 *
 * Builds one realistic business entirely through the tRPC procedures the web
 * app calls (onboarding, masters, the sales and purchase chains, returns,
 * payments, expenses, banking, stock, manufacturing, journals, recurring
 * invoices…), then runs the data audit (src/lib/data-audit) over that
 * business and expects no violations: everything the writers saved has the
 * fields business logic needs, not just what NOT NULL enforces.
 *
 * When this fails, the message is the audit report: the rule, the offending
 * row ids and the procedures that wrote them.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { createUser, createTenant, addMember } from "../helpers/fixtures.js";
import { getTestClient, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { runAudit, formatReport } from "../../lib/data-audit/runner.js";
import type { AuditReport } from "../../lib/data-audit/types.js";

const callerFactory = createCallerFactory(appRouter);

function callerFor(user: { id: string; email: string; name: string | null }, tenantId: string, businessId: string | null) {
  return callerFactory({
    user,
    tenantId,
    businessId,
    req: new Request("http://localhost:3000/api/trpc/test", {
      method: "POST",
      headers: new Headers({
        "content-type": "application/json",
        ...(businessId ? { "x-business-id": businessId } : {}),
      }),
    }),
    resHeaders: new Headers(),
    ipAddress: "127.0.0.1",
  });
}

type Caller = ReturnType<typeof callerFor>;

const iso = (d: string) => new Date(d).toISOString();

let businessId: string;
let report: AuditReport;

/** logAudit is fire-and-forget in several routers; give pending inserts a moment to land. */
const settle = () => new Promise((r) => setTimeout(r, 300));

async function buildBusiness(): Promise<string> {
  const owner = await createUser({ email: `audit.owner.${Date.now()}@example.in`, name: "Audit Owner" });
  const tenant = await createTenant({ name: "Audit Traders" });
  await addMember(tenant.id, owner.id, "owner");
  const u = { id: owner.id, email: owner.email, name: owner.name ?? null };

  // ── Onboarding ────────────────────────────────────────────────────────────
  const biz = await callerFor(u, tenant.id, null).business.create({
    name: "Audit Traders",
    legalName: "Audit Traders Private Limited",
    businessType: "private_limited",
    phone: "9876543210",
    email: "accounts@audittraders.in",
    address: "12 MG Road",
    city: "Mumbai",
    state: "Maharashtra",
    stateCode: "27",
    pincode: "400001",
    gstRegistrationType: "regular",
    gstin: "27AABCU9603R1ZM",
    pan: "AABCU9603R",
    invoicePrefix: "INV",
    currency: "INR",
  } as Parameters<Caller["business"]["create"]>[0]);
  const c = callerFor(u, tenant.id, biz.id);
  // Settings → Barcodes: several codes per item (box codes).
  await c.barcode.update({ mode: "multi" });

  // ── Masters ───────────────────────────────────────────────────────────────
  const apparel = await c.stockGroup.create({ name: "Apparel" });
  const wholesale = await c.priceLevel.create({ name: "Wholesale" });

  const customer = await c.party.create({
    type: "customer", name: "Priya Textiles", phone: "9123456780", gstin: "27AAPFU0939F1ZV",
    billingAddress: "4 Linking Road", city: "Pune", state: "Maharashtra", pincode: "411001",
    openingBalance: "0", priceLevelId: wholesale.id,
  });
  const interCustomer = await c.party.create({
    type: "customer", name: "Bengaluru Retail", gstin: "29AAACR5055K1Z2",
    city: "Bengaluru", state: "Karnataka", stateCode: "29", openingBalance: "0",
  });
  const b2cCustomer = await c.party.create({
    type: "customer", name: "Ravi Kumar", phone: "9000000001", state: "Maharashtra", stateCode: "27", openingBalance: "0",
  });
  const supplier = await c.party.create({
    type: "supplier", name: "Surat Mills", gstin: "27AABCS1234D1Z5", city: "Mumbai", state: "Maharashtra", openingBalance: "0",
  });
  const interSupplier = await c.party.create({
    type: "supplier", name: "Ahmedabad Metals", gstin: "24AAACT2727Q1ZW", city: "Ahmedabad", state: "Gujarat", openingBalance: "0",
  });

  const shirt = await c.item.create({
    name: "Cotton Shirt", hsn: "6205", unit: "pcs", itemMode: "simple", salePrice: "800", purchasePrice: "500",
    taxPercent: "5", stockQuantity: "100", itemType: "product", taxInclusive: false, stockGroupId: apparel.id,
  });
  const bottle = await c.item.create({
    name: "Steel Bottle", hsn: "73239310", unit: "pcs", itemMode: "simple", salePrice: "450", purchasePrice: "300",
    taxPercent: "18", stockQuantity: "50", itemType: "product", taxInclusive: false,
  });
  const install = await c.item.create({
    name: "Installation", hsn: "998719", unit: "pcs", itemMode: "simple", salePrice: "1000",
    taxPercent: "18", stockQuantity: "0", itemType: "service", taxInclusive: false,
  });
  const rice = await c.item.create({
    name: "Basmati Rice", hsn: "1006", unit: "kg", itemMode: "alt_units", salePrice: "90", purchasePrice: "70",
    taxPercent: "5", stockQuantity: "500", itemType: "product", taxInclusive: false,
    unitVariants: [{ unit: "bag", conversionFactor: 25, salePrice: "2200.00", purchasePrice: "1700.00" }],
  });
  const tee = await c.item.create({
    name: "Graphic Tee", hsn: "6109", unit: "pcs", itemMode: "variants", salePrice: "600", purchasePrice: "350",
    taxPercent: "5", itemType: "product", taxInclusive: false, variantAttributes: ["Size"],
    variants: [
      { attributeValues: { Size: "M" }, salePrice: "600", purchasePrice: "350", stockQuantity: "20" },
      { attributeValues: { Size: "L" }, salePrice: "650", purchasePrice: "380", stockQuantity: "15" },
    ],
  });
  const teeM = tee.variants.find((v) => v.attributeValues.Size === "M")!;
  const fabric = await c.item.create({
    name: "Cotton Fabric", hsn: "5208", unit: "m", itemMode: "simple", salePrice: "150", purchasePrice: "100",
    taxPercent: "5", stockQuantity: "300", itemType: "product", taxInclusive: false,
  });
  await c.priceLevel.setItemPrices({ priceLevelId: wholesale.id, itemId: shirt.id, slabs: [{ minQuantity: "0", price: "720" }] });

  // ── Cash & bank ───────────────────────────────────────────────────────────
  const bank = await c.bankAccount.create({
    accountName: "HDFC Current", accountType: "current", accountNumber: "50100012345678", ifsc: "HDFC0000001",
    bankName: "HDFC Bank", openingBalance: "10000", isDefault: true,
  });
  const cash = (await c.bankAccount.list()).find((a: { accountType: string }) => a.accountType === "cash")!;
  // Cash & Bank → Edit account sends every field back, opening balance included.
  await c.bankAccount.update({
    id: bank.id,
    data: { accountName: "HDFC Current", accountType: "current", accountNumber: "50100012345678", ifsc: "HDFC0000001", bankName: "HDFC Bank", openingBalance: "12000", isDefault: true },
  });
  await c.bankAccount.transfer({ fromAccountId: bank.id, toAccountId: cash.id, amount: "2000", description: "Petty cash" });

  // ── Sales chain: quotation → sales order → delivery challan → invoice ─────
  const qtn = await c.quotation.create({
    partyId: customer.id, type: "sale", invoiceDate: iso("2026-07-01"), dueDate: iso("2026-07-15"),
    lineItems: [
      { itemId: shirt.id, itemName: "Cotton Shirt", quantity: "10", unitPrice: "720", taxPercent: "5", discountPercent: "0" },
      { itemId: bottle.id, itemName: "Steel Bottle", quantity: "4", unitPrice: "450", taxPercent: "18", discountPercent: "10" },
    ],
  } as Parameters<Caller["quotation"]["create"]>[0]);
  const so = await c.document.convert({ sourceDocumentId: qtn.id, targetDocumentType: "sales_order" });
  const dc = await c.document.convert({ sourceDocumentId: so.id, targetDocumentType: "delivery_challan" });
  const chainInvoice = await c.document.convert({ sourceDocumentId: dc.id, targetDocumentType: "invoice" });
  const chainInv = await c.invoice.getById({ id: chainInvoice.id });
  await c.payment.create({ partyId: customer.id, invoiceId: chainInvoice.id, amount: "3000", mode: "bank", bankAccountId: bank.id, paymentDate: iso("2026-07-05") });
  const balance = (parseFloat(chainInv!.totalAmount) - 3000).toFixed(2);
  await c.payment.create({
    partyId: customer.id, amount: balance, mode: "upi", bankAccountId: bank.id, paymentDate: iso("2026-07-06"),
    allocations: [{ invoiceId: chainInvoice.id, amount: balance }],
  });

  // ── Direct sale: charges (auto shipment), discount, round-off, variants, alt units, service
  const sale = await c.invoice.create({
    partyId: customer.id, type: "sale", invoiceDate: iso("2026-07-10"), dueDate: iso("2026-08-09"),
    charges: [{ label: "Shipping", amount: "150" }], invoiceDiscount: "100", invoiceDiscountType: "amount", roundOff: "0.40",
    deliveryMethod: "courier",
    lineItems: [
      { itemId: tee.id, variantId: teeM.id, itemName: "Graphic Tee - M", quantity: "3", unitPrice: "600", taxPercent: "5", discountPercent: "0" },
      { itemId: rice.id, itemName: "Basmati Rice", quantity: "2", unitPrice: "2200", taxPercent: "5", discountPercent: "0", selectedUnit: "bag", conversionFactor: "25" },
      { itemId: install.id, itemName: "Installation", quantity: "1", unitPrice: "1000", taxPercent: "18", discountPercent: "0" },
    ],
  } as Parameters<Caller["invoice"]["create"]>[0]);
  const shipments = await c.shipment.list({ page: 1, limit: 10 } as Parameters<Caller["shipment"]["list"]>[0]);
  const autoShipment = shipments.data.find((s: { invoiceId: string | null }) => s.invoiceId === sale.id);
  if (autoShipment) {
    await c.shipment.update({ id: autoShipment.id, status: "shipped", carrier: "Delhivery", trackingNumber: "DL123", shipmentDate: iso("2026-07-11") } as Parameters<Caller["shipment"]["update"]>[0]);
  }
  const salePay = await c.payment.create({ partyId: customer.id, invoiceId: sale.id, amount: "1000", mode: "cash", bankAccountId: cash.id, paymentDate: iso("2026-07-12") });

  // Inter-state B2B sale, then a sales return against it and a credit note later cancelled.
  const interSale = await c.invoice.create({
    partyId: interCustomer.id, type: "sale", invoiceDate: iso("2026-07-12"),
    lineItems: [{ itemId: bottle.id, itemName: "Steel Bottle", quantity: "10", unitPrice: "450", taxPercent: "18", discountPercent: "0" }],
  } as Parameters<Caller["invoice"]["create"]>[0]);
  await c.salesReturn.create({
    partyId: interCustomer.id, type: "sale", referenceDocumentId: interSale.id, invoiceDate: iso("2026-07-14"),
    lineItems: [{ itemId: bottle.id, itemName: "Steel Bottle", quantity: "2", unitPrice: "450", taxPercent: "18", discountPercent: "0" }],
  } as Parameters<Caller["salesReturn"]["create"]>[0]);
  const b2cSale = await c.invoice.create({
    partyId: b2cCustomer.id, type: "sale", invoiceDate: iso("2026-07-13"),
    lineItems: [{ itemId: fabric.id, itemName: "Cotton Fabric", quantity: "12.5", unitPrice: "150", taxPercent: "5", discountPercent: "0" }],
  } as Parameters<Caller["invoice"]["create"]>[0]);
  const cn = await c.creditNote.create({
    partyId: b2cCustomer.id, type: "sale", referenceDocumentId: b2cSale.id, invoiceDate: iso("2026-07-15"),
    lineItems: [{ itemId: fabric.id, itemName: "Cotton Fabric", quantity: "12.5", unitPrice: "150", taxPercent: "5", discountPercent: "0" }],
  } as Parameters<Caller["creditNote"]["create"]>[0]);
  await c.creditNote.updateStatus({ id: cn.id, status: "cancelled" });

  // Items → switch base unit, after the item was already sold in its old unit.
  const sugar = await c.item.create({
    name: "Sugar", hsn: "1701", unit: "kg", itemMode: "simple", salePrice: "45", purchasePrice: "38",
    taxPercent: "5", stockQuantity: "100", itemType: "product", taxInclusive: false,
  });
  await c.invoice.create({
    partyId: b2cCustomer.id, type: "sale", invoiceDate: iso("2026-07-13"),
    lineItems: [{ itemId: sugar.id, itemName: "Sugar", quantity: "2", unitPrice: "45", taxPercent: "5", discountPercent: "0" }],
  } as Parameters<Caller["invoice"]["create"]>[0]);
  await c.item.switchBaseUnit({ id: sugar.id, newUnit: "g", conversionFactor: 1000 });

  // POS sale to the Walk-in Customer, settled in cash straight away.
  const walkIn = await c.business.ensureWalkInParty({ id: biz.id } as Parameters<Caller["business"]["ensureWalkInParty"]>[0]);
  const pos = await c.invoice.create({
    partyId: walkIn.id, type: "sale", documentType: "invoice", source: "pos", deliveryMethod: "self_pickup",
    lineItems: [{ itemId: shirt.id, itemName: "Cotton Shirt", quantity: "2", unitPrice: "800", taxPercent: "5", discountPercent: "0" }],
  } as Parameters<Caller["invoice"]["create"]>[0]);
  // POS records the cash payment without an account (PaymentSheet sends none);
  // it lands in Payments → Untracked until someone assigns it.
  await c.payment.create({ partyId: walkIn.id, invoiceId: pos.id, amount: pos.totalAmount, mode: "cash" });
  const pos2 = await c.invoice.create({
    partyId: walkIn.id, type: "sale", documentType: "invoice", source: "pos", deliveryMethod: "self_pickup",
    lineItems: [{ itemId: bottle.id, itemName: "Steel Bottle", quantity: "1", unitPrice: "450", taxPercent: "18", discountPercent: "0" }],
  } as Parameters<Caller["invoice"]["create"]>[0]);
  const voided = await c.payment.create({ partyId: walkIn.id, invoiceId: pos2.id, amount: pos2.totalAmount, mode: "cash" });
  await c.payment.delete({ id: voided.id });
  // Untracked payments → "Assign all to Cash".
  await c.payment.assignAccount({ allMatching: true, mode: "cash", bankAccountId: cash.id });

  // A sale entered by mistake: cancelled, and another one deleted.
  const wrong = await c.invoice.create({
    partyId: customer.id, type: "sale",
    lineItems: [{ itemId: shirt.id, itemName: "Cotton Shirt", quantity: "1", unitPrice: "800", taxPercent: "5", discountPercent: "0" }],
  } as Parameters<Caller["invoice"]["create"]>[0]);
  await c.invoice.updateStatus({ id: wrong.id, status: "cancelled" });
  const dup = await c.invoice.create({
    partyId: customer.id, type: "sale",
    lineItems: [{ itemId: bottle.id, itemName: "Steel Bottle", quantity: "1", unitPrice: "450", taxPercent: "18", discountPercent: "0" }],
  } as Parameters<Caller["invoice"]["create"]>[0]);
  await c.invoice.delete({ id: dup.id });

  // ── Purchase chain: PO → GRN → purchase invoice ───────────────────────────
  const po = await c.purchaseOrder.create({
    partyId: supplier.id, type: "purchase", invoiceDate: iso("2026-07-02"),
    lineItems: [{ itemId: fabric.id, itemName: "Cotton Fabric", quantity: "200", unitPrice: "100", taxPercent: "5", discountPercent: "0" }],
  } as Parameters<Caller["purchaseOrder"]["create"]>[0]);
  const grn = await c.document.convert({ sourceDocumentId: po.id, targetDocumentType: "goods_receipt_note" });
  const bill = await c.document.convert({ sourceDocumentId: grn.id, targetDocumentType: "invoice" });
  await c.payment.create({ partyId: supplier.id, invoiceId: bill.id, amount: "5000", mode: "bank", bankAccountId: bank.id, paymentDate: iso("2026-07-08") });

  // Inter-state purchase, edited afterwards (quantity corrected), then part returned.
  const interBill = await c.invoice.create({
    partyId: interSupplier.id, type: "purchase", invoiceDate: iso("2026-07-09"),
    lineItems: [{ itemId: bottle.id, itemName: "Steel Bottle", quantity: "20", unitPrice: "300", taxPercent: "18", discountPercent: "0" }],
  } as Parameters<Caller["invoice"]["create"]>[0]);
  await c.invoice.update({
    id: interBill.id,
    lineItems: [{ itemId: bottle.id, itemName: "Steel Bottle", quantity: "25", unitPrice: "300", taxPercent: "18", discountPercent: "0" }],
  });
  await c.purchaseReturn.create({
    partyId: interSupplier.id, type: "purchase", referenceDocumentId: interBill.id, invoiceDate: iso("2026-07-16"),
    lineItems: [{ itemId: bottle.id, itemName: "Steel Bottle", quantity: "5", unitPrice: "300", taxPercent: "18", discountPercent: "0" }],
  } as Parameters<Caller["purchaseReturn"]["create"]>[0]);

  // Advance paid to a supplier before any bill — money leaves the bank.
  await c.payment.create({ partyId: interSupplier.id, amount: "2500", mode: "bank", bankAccountId: bank.id, paymentDate: iso("2026-07-17") });
  // Card payment through a payment gateway: charge booked as an expense, net settled to the bank.
  const gateway = await c.bankAccount.create({ accountName: "Razorpay", accountType: "payment_gateway", openingBalance: "0", isDefault: false });
  await c.bankAccount.upsertGatewayConfig({
    bankAccountId: gateway.id, settlementAccountId: bank.id, autoSettle: true, expenseCategory: "Payment Gateway Charges",
    chargeConfig: { credit_card: { type: "percentage", value: "2" }, default: { type: "percentage", value: "1.5" } },
  });
  const cardPay = await c.payment.create({ partyId: interCustomer.id, invoiceId: interSale.id, amount: "1000", mode: "credit_card", bankAccountId: gateway.id, paymentDate: iso("2026-07-15") });
  await c.payment.update({ id: cardPay.id, amount: "800", allocations: [{ invoiceId: interSale.id, amount: "800" }] });
  const cardPay2 = await c.payment.create({ partyId: interCustomer.id, invoiceId: interSale.id, amount: "100", mode: "upi", bankAccountId: gateway.id });
  await c.payment.delete({ id: cardPay2.id });

  // A receipt recorded twice and deleted.
  const dupPay = await c.payment.create({ partyId: interCustomer.id, invoiceId: interSale.id, amount: "500", mode: "bank", bankAccountId: bank.id });
  await c.payment.delete({ id: dupPay.id });

  // ── Expenses ──────────────────────────────────────────────────────────────
  await c.expense.create({ category: "Rent", description: "July rent", amount: "15000", mode: "bank", bankAccountId: bank.id, expenseDate: iso("2026-07-03") });
  const tea = await c.expense.create({ category: "Office", description: "Tea", amount: "250", mode: "cash", expenseDate: iso("2026-07-04") });
  await c.expense.update({ id: tea.id, data: { amount: "300" } });
  const oops = await c.expense.create({ category: "Travel", amount: "800", mode: "cash" });
  await c.expense.delete({ id: oops.id });

  // ── Warehouses, transfers, adjustments ─────────────────────────────────────
  const premise = await c.warehouse.premiseCreate({ name: "Bhiwandi Godown", code: "BHW", city: "Bhiwandi", state: "Maharashtra" });
  const godown = await c.warehouse.warehouseCreate({ premiseId: premise.id, name: "Bhiwandi Store", code: "BHW-1", warehouseType: "storage" });
  const settings = await c.stock.settings();
  const main = (settings as { salesWarehouseId: string }).salesWarehouseId;
  await c.stock.transfer({ sourceWarehouseId: main, destinationWarehouseId: godown.id, date: iso("2026-07-18"), lines: [{ itemId: fabric.id, quantity: "50" }] });
  await c.stock.adjust({ warehouseId: main, reason: "Damaged in handling", lines: [{ itemId: shirt.id, quantity: "-2" }] });
  await c.item.update({ id: bottle.id, data: { stockQuantity: "80" } });

  // ── Manufacturing ─────────────────────────────────────────────────────────
  const bom = await c.manufacturing.bomCreate({ itemId: shirt.id, name: "Shirt from fabric", outputQuantity: "1", components: [{ itemId: fabric.id, quantity: "1.5" }] });
  await c.manufacturing.manufacture({
    bomId: bom.id, quantity: "10", sourceWarehouseId: main, destinationWarehouseId: main,
    additionalCosts: [{ label: "Stitching", amount: "400" }],
  });

  // ── Journal, recurring invoice, target ────────────────────────────────────
  const accounts = await c.account.list();
  const [dr, cr] = [accounts[0]!, accounts[1]!];
  const je = await c.journal.create({ entryDate: iso("2026-07-31"), narration: "Depreciation", lines: [{ accountId: dr.id, debit: "500", credit: "0" }, { accountId: cr.id, debit: "0", credit: "500" }] });
  await c.journal.create({ entryDate: iso("2026-07-31"), narration: "Accrual", lines: [{ accountId: dr.id, debit: "250", credit: "0" }, { accountId: cr.id, debit: "0", credit: "250" }] });
  await c.journal.void({ id: je.id });

  const tpl = await c.recurringInvoice.create({
    partyId: customer.id, name: "Monthly supply", type: "sale", frequency: "monthly", startDate: iso("2026-07-01"),
    lineItems: [{ itemId: bottle.id, itemName: "Steel Bottle", quantity: "5", unitPrice: "450", taxPercent: "18", discountPercent: "0" }],
  } as Parameters<Caller["recurringInvoice"]["create"]>[0]);
  await c.recurringInvoice.runNow({ id: tpl.id });

  await c.target.create({ userId: owner.id, targetType: "order_value", targetValue: "100000", periodType: "monthly", periodStart: iso("2026-07-01"), periodEnd: iso("2026-07-31") });

  // ── Later edits and housekeeping ──────────────────────────────────────────
  await c.stockGroup.rename({ id: apparel.id, name: "Clothing" });
  const box = await c.barcode.addItemCode({ itemId: shirt.id, generate: true, packQty: "12", label: "Box of 12" } as Parameters<Caller["barcode"]["addItemCode"]>[0]);
  await c.priceLevel.bulkUpdate({ priceLevelId: wholesale.id, basis: "salePrice", percent: -10, round: "rupee" });
  await c.party.update({ id: customer.id, data: { phone: "9123456789", creditPeriodDays: 30 } });

  // Duplicate masters merged away.
  const dupParty = await c.party.create({ type: "customer", name: "Priya Textile", state: "Maharashtra", stateCode: "27", openingBalance: "0" });
  await c.invoice.create({
    partyId: dupParty.id, type: "sale",
    lineItems: [{ itemId: shirt.id, itemName: "Cotton Shirt", quantity: "1", unitPrice: "800", taxPercent: "5", discountPercent: "0" }],
  } as Parameters<Caller["invoice"]["create"]>[0]);
  await c.party.merge({ sourceId: dupParty.id, targetId: customer.id });
  // A walk-in style contact later registered for GST under another entry: the
  // GSTIN entry (with a shipped invoice) is merged into the plain one.
  const plain = await c.party.create({ type: "customer", name: "RK Traders", phone: "9000000002", openingBalance: "0" });
  const registered = await c.party.create({ type: "customer", name: "R.K. Traders", gstin: "27AAFCR1234M1Z9", openingBalance: "0" });
  await c.invoice.create({
    partyId: registered.id, type: "sale", charges: [{ label: "Delivery", amount: "60" }], deliveryMethod: "transport",
    lineItems: [{ itemId: bottle.id, itemName: "Steel Bottle", quantity: "2", unitPrice: "450", taxPercent: "18", discountPercent: "0" }],
  } as Parameters<Caller["invoice"]["create"]>[0]);
  await c.party.merge({ sourceId: registered.id, targetId: plain.id });
  const dupItem = await c.item.create({ name: "Cotton Shirt (old)", hsn: "6205", unit: "pcs", itemMode: "simple", salePrice: "800", taxPercent: "5", stockQuantity: "5", itemType: "product", taxInclusive: false });
  await c.invoice.create({
    partyId: b2cCustomer.id, type: "sale",
    lineItems: [{ itemId: dupItem.id, itemName: "Cotton Shirt (old)", quantity: "1", unitPrice: "800", taxPercent: "5", discountPercent: "0" }],
  } as Parameters<Caller["invoice"]["create"]>[0]);
  await c.item.merge({ sourceId: dupItem.id, targetId: shirt.id });

  // Corrections: a receipt amount, a shipping cost, a sale's lines.
  const receipts = await c.payment.list({ page: 1, limit: 50 } as Parameters<Caller["payment"]["list"]>[0]);
  const first = receipts.data.find((p: { amount: string; partyId?: string }) => p.amount === "3000.00")!;
  await c.payment.update({ id: first.id, amount: "2500", allocations: [{ invoiceId: chainInvoice.id, amount: "2500" }] });
  if (autoShipment) await c.shipment.update({ id: autoShipment.id, cost: "200" } as Parameters<Caller["shipment"]["update"]>[0]);
  await c.invoice.update({
    id: interSale.id,
    lineItems: [{ itemId: bottle.id, itemName: "Steel Bottle", quantity: "12", unitPrice: "440", taxPercent: "18", discountPercent: "0" }],
  });
  // Edit invoice (DocumentCreator sends the whole form back, party included):
  // the courier sale was billed to the wrong customer. Its receipt was taken
  // from that customer, so it is removed first and taken again afterwards.
  await expect(c.invoice.update({ id: sale.id, partyId: b2cCustomer.id })).rejects.toThrow(/changing the party/);
  await c.payment.delete({ id: salePay.id });
  const saleNow = (await c.invoice.getById({ id: sale.id }))!;
  await c.invoice.update({
    id: sale.id,
    partyId: b2cCustomer.id,
    invoiceDate: saleNow.invoiceDate.toISOString(),
    dueDate: saleNow.dueDate ? saleNow.dueDate.toISOString() : null,
    notes: null,
    termsAndConditions: null,
    charges: (saleNow.charges ?? []).map(({ label, amount, shipmentId }) => ({ label, amount, ...(shipmentId ? { shipmentId } : {}) })),
    invoiceDiscount: saleNow.discountAmount,
    invoiceDiscountType: "amount",
    roundOff: saleNow.roundOff,
    lineItems: saleNow.lineItems.map((li) => ({
      itemId: li.itemId ?? undefined, variantId: li.variantId ?? undefined, itemName: li.itemName, quantity: li.quantity,
      unitPrice: li.unitPrice, taxPercent: li.taxPercent, discountPercent: li.discountPercent,
      selectedUnit: li.selectedUnit ?? undefined, conversionFactor: li.conversionFactor ?? undefined,
    })),
  });
  await c.payment.create({ partyId: b2cCustomer.id, invoiceId: sale.id, amount: "1000", mode: "cash", bankAccountId: cash.id, paymentDate: iso("2026-07-21") });

  // Physical count by scanning the new box code, posted straight away.
  await c.stock.countFinish({ warehouseId: main, startedAt: iso("2026-07-20"), scans: [{ code: box.code, count: 2 }], post: true });

  // A second production run entered by mistake and cancelled.
  const run2 = await c.manufacturing.manufacture({ bomId: bom.id, quantity: "2", sourceWarehouseId: main, destinationWarehouseId: main });
  await c.manufacturing.cancel({ id: run2.id });

  await c.recurringInvoice.pause({ id: tpl.id });
  await c.recurringInvoice.resume({ id: tpl.id });

  const jt = await c.journal.templateCreate({
    name: "Monthly depreciation",
    lines: [
      { accountId: dr.id, accountCode: dr.code, accountName: dr.name, debit: "100", credit: "0" },
      { accountId: cr.id, accountCode: cr.code, accountName: cr.name, debit: "0", credit: "100" },
    ],
  });
  await c.journal.createFromTemplate({ templateId: jt.id, entryDate: iso("2026-08-31") });
  await c.itc.markBlocked({ invoiceId: bill.id, blockReason: "personal" } as Parameters<Caller["itc"]["markBlocked"]>[0]);

  // ── Batches and expiry, free goods, GRN rejections, own delivery methods ──
  await c.business.update({
    id: biz.id,
    data: { customShippingMethods: [{ id: "porter", label: "Porter", hasTracking: false }] },
  } as Parameters<Caller["business"]["update"]>[0]);
  const para = await c.item.create({
    name: "Paracetamol 500", hsn: "3004", unit: "pcs", itemMode: "simple", salePrice: "30", purchasePrice: "20",
    taxPercent: "12", stockQuantity: "100", itemType: "product", taxInclusive: false, trackBatches: true, trackExpiry: true,
    openingBatch: { batchNumber: "OP-1", expiryDate: "2027-12-31" },
  } as Parameters<Caller["item"]["create"]>[0]);
  const paraPo = await c.purchaseOrder.create({
    partyId: supplier.id, type: "purchase", invoiceDate: iso("2026-07-22"),
    lineItems: [{ itemId: para.id, itemName: "Paracetamol 500", quantity: "50", freeQuantity: "5", unitPrice: "20", taxPercent: "12", discountPercent: "0" }],
  } as Parameters<Caller["purchaseOrder"]["create"]>[0]);
  const paraPoLine = (await c.purchaseOrder.getById({ id: paraPo.id }))!.lineItems[0]!;
  const paraGrn = await c.document.convert({
    sourceDocumentId: paraPo.id, targetDocumentType: "goods_receipt_note",
    lines: [{ sourceLineId: paraPoLine.id, quantity: "40", freeQuantity: "5", rejectedQuantity: "10", rejectionReason: "Crushed strips", batchNumber: "B-2", expiryDate: "2027-06-30" }],
  });
  await c.document.convert({ sourceDocumentId: paraGrn.id, targetDocumentType: "invoice" });
  await c.document.convert({ sourceDocumentId: paraGrn.id, targetDocumentType: "purchase_return", fromRejected: true });
  await c.invoice.create({
    partyId: customer.id, type: "sale", invoiceDate: iso("2026-07-23"), deliveryMethod: "porter",
    lineItems: [{ itemId: para.id, itemName: "Paracetamol 500", quantity: "60", freeQuantity: "6", unitPrice: "30", taxPercent: "12", discountPercent: "0" }],
  } as Parameters<Caller["invoice"]["create"]>[0]);
  await c.stock.adjust({ warehouseId: main, reason: "Expired strips destroyed", lines: [{ itemId: para.id, quantity: "-3" }] });
  // A single money-out row typed "transfer" (API / CLI).
  await c.bankAccount.addTransaction({ bankAccountId: bank.id, type: "transfer", amount: "100", description: "Sent to proprietor" });

  // ── Bank reconciliation of the HDFC statement ────────────────────────────
  const csv = [
    "Date,Description,Debit,Credit,Balance",
    "03/07/2026,RENT JULY,15000.00,,0",
    "05/07/2026,NEFT PRIYA TEXTILES,,2500.00,0",
    "19/07/2026,BANK CHARGES,118.00,,0",
    "20/07/2026,INTEREST CREDIT,,45.00,0",
  ].join("\n");
  const upload = await c.bankRecon.uploadCSV({ bankAccountId: bank.id, fileName: "hdfc-july.csv", csvContent: csv });
  await c.bankRecon.confirmMapping({
    importId: upload.importId, csvContent: csv,
    columnMapping: { date: 0, narration: 1, debit: 2, credit: 3, balance: 4, dateFormat: "DD/MM/YYYY", skipRows: 1 },
  });
  const stmt = await c.bankRecon.lines({ importId: upload.importId, page: 1, limit: 50 } as Parameters<Caller["bankRecon"]["lines"]>[0]);
  const lineBy = (text: string) => stmt.data.find((l: { narration: string | null }) => l.narration?.includes(text))!;
  const unmatchedOnly = (l: { matchStatus: string }) => l.matchStatus === "unmatched";
  if (unmatchedOnly(lineBy("PRIYA"))) {
    await c.bankRecon.manualMatch({ lineId: lineBy("PRIYA").id, paymentId: first.id });
  }
  await c.bankRecon.createExpense({
    lineId: lineBy("BANK CHARGES").id,
    expense: { category: "Bank Charges", amount: "118", mode: "bank", expenseDate: iso("2026-07-19") },
  });
  await c.bankRecon.ignoreLine({ lineId: lineBy("INTEREST").id });

  await settle();
  return biz.id;
}

beforeAll(async () => {
  businessId = await buildBusiness();
  report = await runAudit(getTestClient(), { businessIds: [businessId], samples: 10 });
}, 120_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("Layer 4 data audit over data written through the API", () => {
  it("every rule query runs", () => {
    expect(report.failures.map((f) => `${f.rule.id}: ${f.error}`)).toEqual([]);
    expect(report.rulesRun).toBeGreaterThan(100);
  });

  it("finds no violations — every saved row is complete per business logic", () => {
    const violations = report.results.map((r) => `${r.rule.id} (${r.count})`);
    expect(violations, formatReport(report)).toEqual([]);
  });

  it("the journey really wrote the data the rules check", async () => {
    const sql = getTestClient();
    const [counts] = await sql`
      SELECT
        (SELECT COUNT(DISTINCT document_type) FROM invoices WHERE business_id = ${businessId})::int AS doc_types,
        (SELECT COUNT(*) FROM payments WHERE business_id = ${businessId})::int AS payments,
        (SELECT COUNT(*) FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE p.business_id = ${businessId})::int AS allocations,
        (SELECT COUNT(*) FROM stock_movements WHERE business_id = ${businessId})::int AS movements,
        (SELECT COUNT(DISTINCT reference_type) FROM bank_transactions WHERE business_id = ${businessId})::int AS bank_ref_types,
        (SELECT COUNT(*) FROM itc_ledger_entries WHERE business_id = ${businessId})::int AS itc,
        (SELECT COUNT(*) FROM shipments WHERE business_id = ${businessId})::int AS shipments,
        (SELECT COUNT(*) FROM manufacturing_journals WHERE business_id = ${businessId})::int AS mfg,
        (SELECT COUNT(*) FROM recurring_invoice_runs WHERE business_id = ${businessId})::int AS runs,
        (SELECT COUNT(*) FROM audit_log WHERE business_id = ${businessId})::int AS audit
    `;
    expect(counts!.doc_types).toBeGreaterThanOrEqual(9);
    expect(counts!.payments).toBeGreaterThanOrEqual(8);
    expect(counts!.allocations).toBeGreaterThanOrEqual(5);
    expect(counts!.movements).toBeGreaterThanOrEqual(20);
    expect(counts!.bank_ref_types).toBeGreaterThanOrEqual(3);
    expect(counts!.itc).toBeGreaterThanOrEqual(2);
    expect(counts!.shipments).toBeGreaterThanOrEqual(1);
    expect(counts!.mfg).toBeGreaterThanOrEqual(1);
    expect(counts!.runs).toBe(1);
    expect(counts!.audit).toBeGreaterThanOrEqual(30);
  });

  // Runs last: it breaks the data on purpose.
  it("catches broken data (each corruption trips its rule)", async () => {
    const sql = getTestClient();
    const b = businessId;
    await sql`UPDATE invoices SET total_amount = total_amount + 10 WHERE id = (SELECT id FROM invoices WHERE business_id = ${b} AND document_type = 'quotation' LIMIT 1)`;
    await sql`UPDATE invoice_items SET tax_amount = tax_amount + 1 WHERE id = (SELECT li.id FROM invoice_items li JOIN invoices i ON i.id = li.invoice_id WHERE i.business_id = ${b} AND i.document_type = 'sales_order' LIMIT 1)`;
    await sql`UPDATE parties SET state_code = NULL WHERE business_id = ${b} AND name = 'Surat Mills'`;
    await sql`UPDATE items SET stock_quantity = stock_quantity + 5 WHERE business_id = ${b} AND name = 'Cotton Fabric'`;
    await sql`UPDATE stock_balances SET quantity = quantity + 1 WHERE id = (SELECT id FROM stock_balances WHERE business_id = ${b} LIMIT 1)`;
    await sql`UPDATE payment_allocations SET amount = amount * 2 WHERE id = (SELECT pa.id FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE p.business_id = ${b} AND p.party_id = (SELECT id FROM parties WHERE business_id = ${b} AND name = 'Surat Mills') LIMIT 1)`;
    await sql`UPDATE bank_accounts SET current_balance = current_balance + 1 WHERE business_id = ${b} AND account_type = 'cash'`;
    await sql`UPDATE invoices SET e_invoice_status = 'generated' WHERE id = (SELECT id FROM invoices WHERE business_id = ${b} AND party_id = (SELECT id FROM parties WHERE business_id = ${b} AND name = 'Bengaluru Retail') AND document_type = 'invoice' LIMIT 1)`;
    await sql`DELETE FROM audit_log WHERE business_id = ${b} AND action = 'expense.create'`;
    await sql`UPDATE journal_entry_lines SET debit = debit + 1 WHERE id = (SELECT l.id FROM journal_entry_lines l JOIN journal_entries j ON j.id = l.journal_entry_id WHERE j.business_id = ${b} AND l.debit::numeric > 0 LIMIT 1)`;
    await sql`UPDATE itc_ledger_entries SET cgst = cgst + 1 WHERE id = (SELECT id FROM itc_ledger_entries WHERE business_id = ${b} AND status = 'available' LIMIT 1)`;
    await sql`UPDATE stock_movements SET reference_id = gen_random_uuid() WHERE id = (SELECT id FROM stock_movements WHERE business_id = ${b} AND reference_type = 'MANUFACTURING' LIMIT 1)`;

    await sql`UPDATE invoice_items SET free_quantity = 1 WHERE id = (SELECT li.id FROM invoice_items li JOIN invoices i ON i.id = li.invoice_id WHERE i.business_id = ${b} AND i.document_type = 'credit_note' LIMIT 1)`;
    await sql`UPDATE invoice_items SET rejected_quantity = 2 WHERE id = (SELECT li.id FROM invoice_items li JOIN invoices i ON i.id = li.invoice_id WHERE i.business_id = ${b} AND i.document_type = 'purchase_order' LIMIT 1)`;
    await sql`UPDATE invoices SET delivery_method = 'zeppelin' WHERE id = (SELECT id FROM invoices WHERE business_id = ${b} AND delivery_method = 'porter' LIMIT 1)`;
    await sql`UPDATE invoice_items SET batch_id = NULL WHERE id = (SELECT li.id FROM invoice_items li JOIN invoices i ON i.id = li.invoice_id WHERE i.business_id = ${b} AND i.document_type = 'goods_receipt_note' AND li.batch_id IS NOT NULL LIMIT 1)`;
    await sql`DELETE FROM audit_log WHERE business_id = ${b} AND action IN ('stock.transfer', 'manufacturing.bomCreate', 'journal.templateCreate')`;
    const broken = await runAudit(sql, { businessIds: [b] });
    const hit = new Set(broken.results.map((r) => r.rule.id));
    for (const id of [
      "invoices.total-formula",
      "invoice_items.line-math",
      "invoices.subtotal-and-tax-match-lines",
      "parties.gstin-needs-state-code",
      "items.stock-equals-movements",
      "stock_balances.equals-movements",
      "invoices.amount-paid-matches-allocations",
      "payments.allocations-within-amount",
      "bank_accounts.balance-reconciles",
      "invoices.e-invoice-fields",
      "expenses.audit-trail",
      "journal_entries.balanced",
      "itc_ledger_entries.matches-invoice-tax",
      "stock_movements.source-document",
      "manufacturing_journals.status-and-stock",
      "invoice_items.free-quantity-allowed",
      "invoice_items.rejection-on-grn-with-reason",
      "invoices.delivery-method-known",
      "invoice_items.batch-on-inward-line",
      "stock_movements.transfer-audited",
      "boms.audit-trail",
      "journal_entry_templates.audit-trail",
    ]) {
      expect(hit.has(id), `${id} should fire\n${formatReport(broken)}`).toBe(true);
    }
    // The broken rows are the ones reported, each with an id and a detail.
    const eInvoice = broken.results.find((r) => r.rule.id === "invoices.e-invoice-fields")!;
    expect(eInvoice.count).toBe(1);
    expect(eInvoice.samples[0]!.detail).toContain("e_invoice_status generated");
  });
});
