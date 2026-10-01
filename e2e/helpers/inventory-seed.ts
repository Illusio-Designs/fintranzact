/**
 * inventory-seed.ts — Masters the inventory journey moves stock of, created
 * through the API: stock items and customers are J3's (masters) journey.
 * Stock itself (batches, warehouses, adjustments, production) is put there
 * by the inventory journey in the UI.
 */
import type { SeededOwner } from "./journey-seed";
import { uid } from "./journey";

type Ref = { id: string; name: string };

export type StockMasters = {
  id: string;
  /** Maharashtra, like the business. */
  customer: Ref;
  /** Batch-tracked with expiry, ₹20 cost / ₹35 + 12%, nothing in stock. */
  tablets: Ref;
  /** Plain item with a barcode, 12 in stock at ₹100 cost (the Main warehouse). */
  gloves: Ref & { barcode: string };
};

export async function seedStockMasters(owner: SeededOwner): Promise<StockMasters> {
  const api = owner.api;
  const id = uid();
  const customer = await api.mutate<Ref>("party.create", {
    name: `Kothrud Chemists ${id}`,
    type: "customer",
    phone: "9822011122",
    gstin: "27AAACK1234L1Z5",
    state: "Maharashtra",
    stateCode: "27",
    billingAddress: "22 Karve Road, Pune",
    city: "Pune",
    pincode: "411038",
  });
  const tablets = await api.mutate<Ref>("item.create", {
    name: `Paracetamol 650 ${id}`,
    hsn: "3004",
    unit: "pkt",
    itemMode: "simple",
    itemType: "product",
    salePrice: "35.00",
    purchasePrice: "20.00",
    taxPercent: "12",
    stockQuantity: "0",
    taxInclusive: false,
    trackBatches: true,
    trackExpiry: true,
  });
  const barcode = `J7GLV${id}`.toUpperCase();
  const gloves = await api.mutate<Ref>("item.create", {
    name: `Nitrile Gloves Box ${id}`,
    hsn: "4015",
    unit: "box",
    itemMode: "simple",
    itemType: "product",
    salePrice: "180.00",
    purchasePrice: "100.00",
    taxPercent: "12",
    stockQuantity: "12",
    barcode,
    taxInclusive: false,
  });
  return {
    id,
    customer: { id: customer.id, name: customer.name },
    tablets: { id: tablets.id, name: tablets.name },
    gloves: { id: gloves.id, name: gloves.name, barcode },
  };
}

export type ProductionMasters = {
  id: string;
  /** A dealer the price level is given to (Maharashtra). */
  dealer: Ref;
  /** Raw material: 200 m at ₹150. */
  fabric: Ref;
  /** Raw material: 1,000 pcs at ₹2. */
  buttons: Ref;
  /** Finished good: none in stock, sells at ₹800 + 5%, reorder level 25. */
  shirt: Ref;
};

export async function seedProductionMasters(owner: SeededOwner): Promise<ProductionMasters> {
  const api = owner.api;
  const id = uid();
  const dealer = await api.mutate<Ref>("party.create", {
    name: `Laxmi Road Garments ${id}`,
    type: "customer",
    phone: "9822033344",
    gstin: "27AABCL4321M1Z2",
    state: "Maharashtra",
    stateCode: "27",
    billingAddress: "101 Laxmi Road, Pune",
    city: "Pune",
    pincode: "411030",
  });
  const item = (name: string, extra: Record<string, unknown>) =>
    api.mutate<Ref>("item.create", { name, itemMode: "simple", itemType: "product", taxInclusive: false, ...extra });
  const fabric = await item(`Cotton Fabric ${id}`, {
    hsn: "5208",
    unit: "m",
    salePrice: "220.00",
    purchasePrice: "150.00",
    taxPercent: "5",
    stockQuantity: "200",
  });
  const buttons = await item(`Shirt Buttons ${id}`, {
    hsn: "9606",
    unit: "pcs",
    salePrice: "4.00",
    purchasePrice: "2.00",
    taxPercent: "18",
    stockQuantity: "1000",
  });
  const shirt = await item(`Cotton Shirt ${id}`, {
    hsn: "6205",
    unit: "pcs",
    salePrice: "800.00",
    purchasePrice: "0",
    taxPercent: "5",
    stockQuantity: "0",
    lowStockAlert: "25",
  });
  return {
    id,
    dealer: { id: dealer.id, name: dealer.name },
    fabric: { id: fabric.id, name: fabric.name },
    buttons: { id: buttons.id, name: buttons.name },
    shirt: { id: shirt.id, name: shirt.name },
  };
}
