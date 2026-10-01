/**
 * purchase-seed.ts — Masters a purchase journey buys with, created through
 * the API: suppliers and stock items are J3's (masters) journey and the bank
 * account the Cash & Bank journey's.
 */
import type { SeededOwner } from "./journey-seed";
import { uid } from "./journey";

export type PurchaseMasters = {
  id: string;
  /** Maharashtra, like the business: CGST + SGST on its bills. */
  supplier: { id: string; name: string };
  /**
   * Batch-tracked with expiry, bought at ₹80 + 12%, nothing in stock: the
   * goods arrive on the GRN in the batch typed in there.
   */
  capsules: { id: string; name: string };
  /** Plain stock item, bought at ₹250 + 18%, nothing in stock. */
  paper: { id: string; name: string };
  /** Current account the supplier is paid from (₹1,00,000 opening). */
  bank: { id: string; name: string };
};

export async function seedPurchaseMasters(owner: SeededOwner): Promise<PurchaseMasters> {
  const api = owner.api;
  const id = uid();
  const supplier = await api.mutate<{ id: string; name: string }>("party.create", {
    name: `Bhiwandi Pharma Distributors ${id}`,
    type: "supplier",
    phone: "9822098765",
    gstin: "27AADCB2230M1ZT",
    state: "Maharashtra",
    stateCode: "27",
    billingAddress: "Gala 7, Mankoli Naka, Bhiwandi",
    city: "Bhiwandi",
    pincode: "421302",
  });
  const capsules = await api.mutate<{ id: string; name: string }>("item.create", {
    name: `Amoxicillin 500 Capsules ${id}`,
    hsn: "3004",
    unit: "box",
    itemMode: "simple",
    itemType: "product",
    salePrice: "120.00",
    purchasePrice: "80.00",
    taxPercent: "12",
    stockQuantity: "0",
    taxInclusive: false,
    trackBatches: true,
    trackExpiry: true,
  });
  const paper = await api.mutate<{ id: string; name: string }>("item.create", {
    name: `A4 Copier Paper ${id}`,
    hsn: "4802",
    unit: "pack",
    itemMode: "simple",
    itemType: "product",
    salePrice: "320.00",
    purchasePrice: "250.00",
    taxPercent: "18",
    stockQuantity: "0",
    taxInclusive: false,
  });
  const bank = await api.mutate<{ id: string; accountName: string }>("bankAccount.create", {
    accountName: `HDFC Current ${id}`,
    bankName: "HDFC Bank",
    accountNumber: "50200012345678",
    ifsc: "HDFC0000123",
    accountType: "current",
    openingBalance: "100000",
    isDefault: true,
  });
  return {
    id,
    supplier: { id: supplier.id, name: supplier.name },
    capsules: { id: capsules.id, name: capsules.name },
    paper: { id: paper.id, name: paper.name },
    bank: { id: bank.id, name: bank.accountName },
  };
}
