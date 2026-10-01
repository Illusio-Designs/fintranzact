/**
 * money-seed.ts — Prerequisites the money journey (J8) works with, created
 * through the API: the customer and the service item are J3's (masters)
 * journey; a customer's invoice and the payment received for it into a bank
 * account are J4's (sales cycle).
 */
import type { SeededOwner } from "./journey-seed";
import { uid } from "./journey";

type Ref = { id: string; name: string };

export type MoneyMasters = {
  id: string;
  /** Maharashtra, like the business. */
  customer: Ref;
  /** A service billed every month: ₹5,000 + 18%. */
  amc: Ref;
};

export async function seedMoneyMasters(owner: SeededOwner): Promise<MoneyMasters> {
  const api = owner.api;
  const id = uid();
  const customer = await api.mutate<Ref>("party.create", {
    name: `Pune Retail ${id}`,
    type: "customer",
    phone: "9822012345",
    gstin: "27AAACR5055K1Z5",
    state: "Maharashtra",
    stateCode: "27",
    billingAddress: "14 FC Road, Pune",
    city: "Pune",
    pincode: "411004",
  });
  const amc = await api.mutate<Ref>("item.create", {
    name: `Annual Maintenance ${id}`,
    hsn: "998713",
    unit: "other",
    itemMode: "simple",
    itemType: "service",
    salePrice: "5000.00",
    taxPercent: "18",
    taxInclusive: false,
  });
  return { id, customer: { id: customer.id, name: customer.name }, amc: { id: amc.id, name: amc.name } };
}

/**
 * An invoice to the customer for ₹10,000 + 18% and its payment of ₹11,800
 * received into `bankAccountId` by NEFT (reference `reference`).
 */
export async function seedReceiptIntoAccount(
  owner: SeededOwner,
  m: MoneyMasters,
  bankAccountId: string,
  reference: string,
) {
  const api = owner.api;
  const invoice = await api.mutate<{ id: string; invoiceNumber: string; totalAmount: string }>("invoice.create", {
    type: "sale",
    documentType: "invoice",
    partyId: m.customer.id,
    lineItems: [
      {
        itemId: m.amc.id,
        itemName: m.amc.name,
        quantity: "2",
        unitPrice: "5000.00",
        taxPercent: "18",
        discountPercent: "0",
        conversionFactor: "1",
      },
    ],
    invoiceDiscount: "0",
    invoiceDiscountType: "amount",
    additionalCharges: "0",
    roundOff: "0",
  });
  const payment = await api.mutate<{ id: string; paymentNumber: string }>("payment.create", {
    partyId: m.customer.id,
    invoiceId: invoice.id,
    amount: invoice.totalAmount,
    mode: "bank",
    referenceNumber: reference,
    bankAccountId,
    paymentDate: new Date().toISOString(),
  });
  return { invoice, payment };
}
