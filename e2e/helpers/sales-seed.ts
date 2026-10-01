/**
 * sales-seed.ts — Masters a sales journey sells to and from, created through
 * the API: customers and items are J3's (masters) journey, and the walk-in
 * customer is the one the POS keeps.
 */
import type { SeededOwner } from "./journey-seed";
import { uid } from "./journey";

export type SalesMasters = {
  id: string;
  /** Maharashtra, like the business: CGST + SGST. */
  localCustomer: { id: string; name: string };
  /** Karnataka: IGST. */
  outstationCustomer: { id: string; name: string };
  /** No GSTIN, no state: the POS's "Walk-in Customer". */
  walkIn: { id: string; name: string };
  /** Plain stock item, 100 in stock, ₹1,000 + 18%. */
  bracket: { id: string; name: string };
  /**
   * Batch-tracked with expiry, ₹512.50 + 12%: 20 in batch LATE (expires in
   * two years) and 5 in batch SOON (expires in three months), so
   * first-expiry-first-out takes SOON first.
   */
  syrup: { id: string; name: string };
};

function isoDay(offsetDays: number) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export async function seedSalesMasters(owner: SeededOwner): Promise<SalesMasters> {
  const api = owner.api;
  const id = uid();
  const party = (name: string, extra: Record<string, unknown>) =>
    api.mutate<{ id: string; name: string }>("party.create", { name, type: "customer", ...extra });

  const localCustomer = await party(`Pune Retail ${id}`, {
    phone: "9822012345",
    gstin: "27AAACR5055K1Z5",
    state: "Maharashtra",
    stateCode: "27",
    billingAddress: "14 FC Road, Pune",
    city: "Pune",
    pincode: "411004",
  });
  const outstationCustomer = await party(`Tumkur Traders ${id}`, {
    phone: "9845012345",
    gstin: "29AABCT1332L1ZT",
    state: "Karnataka",
    stateCode: "29",
    billingAddress: "12 BH Road, Tumakuru",
    city: "Tumakuru",
    pincode: "572101",
  });
  const walkIn = await api.mutate<{ id: string }>("business.ensureWalkInParty", { id: owner.businessId });

  const bracket = await api.mutate<{ id: string; name: string }>("item.create", {
    name: `Steel Bracket ${id}`,
    hsn: "7326",
    unit: "pcs",
    itemMode: "simple",
    itemType: "product",
    salePrice: "1000.00",
    purchasePrice: "700.00",
    taxPercent: "18",
    stockQuantity: "100",
    taxInclusive: false,
  });
  const syrup = await api.mutate<{ id: string; name: string }>("item.create", {
    name: `Cough Syrup ${id}`,
    hsn: "3004",
    unit: "btl",
    itemMode: "simple",
    itemType: "product",
    salePrice: "512.50",
    purchasePrice: "300.00",
    taxPercent: "12",
    stockQuantity: "20",
    taxInclusive: false,
    trackBatches: true,
    trackExpiry: true,
    openingBatch: { batchNumber: "LATE", expiryDate: isoDay(730) },
  });
  const soon = await api.mutate<{ id: string }>("batch.create", {
    itemId: syrup.id,
    batchNumber: "SOON",
    expiryDate: isoDay(90),
  });
  await api.mutate("item.adjustStock", { itemId: syrup.id, batchId: soon.id, quantity: "5", reason: "Opening stock, batch SOON" });

  return {
    id,
    localCustomer: { id: localCustomer.id, name: localCustomer.name },
    outstationCustomer: { id: outstationCustomer.id, name: outstationCustomer.name },
    walkIn: { id: walkIn.id, name: "Walk-in Customer" },
    bracket: { id: bracket.id, name: bracket.name },
    syrup: { id: syrup.id, name: syrup.name },
  };
}
