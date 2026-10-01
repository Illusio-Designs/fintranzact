/**
 * pos-seed.ts — Masters a counter sells, created through the API: stock
 * items are J3's (masters) journey. Each has a barcode the journey scans at
 * the POS register.
 */
import type { SeededOwner } from "./journey-seed";
import { uid } from "./journey";

export type PosItem = { id: string; name: string; barcode: string; price: number; taxPercent: number; stock: number };

export type PosMasters = {
  id: string;
  /** ₹250 + 18%, 40 pcs in stock. */
  shampoo: PosItem;
  /** ₹45 + 5%, 200 pcs in stock. */
  biscuits: PosItem;
  /** ₹1,200 + 12%, 10 pairs in stock. */
  slippers: PosItem;
};

export async function seedPosMasters(owner: SeededOwner): Promise<PosMasters> {
  const api = owner.api;
  const id = uid();
  const make = async (name: string, unit: string, hsn: string, price: number, taxPercent: number, stock: number) => {
    const barcode = `890${Math.floor(Math.random() * 1e9)
      .toString()
      .padStart(9, "0")}${name.length % 10}`;
    const row = await api.mutate<{ id: string; name: string }>("item.create", {
      name: `${name} ${id}`,
      hsn,
      unit,
      itemMode: "simple",
      itemType: "product",
      salePrice: price.toFixed(2),
      purchasePrice: (price * 0.6).toFixed(2),
      taxPercent: String(taxPercent),
      stockQuantity: String(stock),
      barcode,
      taxInclusive: false,
    });
    return { id: row.id, name: row.name, barcode, price, taxPercent, stock };
  };
  return {
    id,
    shampoo: await make("Herbal Shampoo", "pcs", "3305", 250, 18, 40),
    biscuits: await make("Glucose Biscuits", "pcs", "1905", 45, 5, 200),
    slippers: await make("Rubber Slippers", "pair", "6402", 1200, 12, 10),
  };
}
