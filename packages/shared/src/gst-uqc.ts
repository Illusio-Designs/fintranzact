import type { Unit } from "./validators.js";

/**
 * GST Unit Quantity Codes (UQC) for each unit an item can be sold in.
 *
 * The GSTN portal (GSTR-1 HSN summary) and the e-invoice IRP share one UQC
 * master: BAG, BOX, BTL, BUN, CMS, DOZ, GMS, KGS, LTR, MLT, MTR, NOS, OTH,
 * PAC, PCS, PRS, SET, TON, … Units with no code of their own map to the
 * closest count (NOS) or to OTH, which both schemas accept.
 */
export const GST_UQC_BY_UNIT: Record<Unit, string> = {
  pcs: "PCS",
  kg: "KGS",
  g: "GMS",
  l: "LTR",
  ml: "MLT",
  m: "MTR",
  cm: "CMS",
  ft: "OTH",
  in: "OTH",
  box: "BOX",
  dozen: "DOZ",
  pair: "PRS",
  set: "SET",
  pkt: "PAC",
  bun: "BUN",
  pouch: "PAC",
  jar: "NOS",
  btl: "BTL",
  bag: "BAG",
  ton: "TON",
  pack: "PAC",
  pet: "BTL",
  person: "NOS",
  other: "OTH",
};

// Free-text spellings seen in imported data, mapped onto the unit list above.
const UNIT_ALIASES: Record<string, Unit> = {
  nos: "pcs", piece: "pcs", pieces: "pcs", unit: "pcs", units: "pcs", number: "pcs",
  kgs: "kg", kilogram: "kg", kilograms: "kg",
  gm: "g", gms: "g", gram: "g", grams: "g",
  ltr: "l", lts: "l", litre: "l", litres: "l", liter: "l", liters: "l",
  mtr: "m", meter: "m", meters: "m", metre: "m", metres: "m",
  doz: "dozen", dozens: "dozen",
  boxes: "box", bags: "bag", sets: "set", pairs: "pair",
  pac: "pack", pk: "pack", packs: "pack", packet: "pkt", packets: "pkt",
  bottle: "btl", bottles: "btl",
  tonne: "ton", tonnes: "ton",
  millilitre: "ml", milliliter: "ml", mlt: "ml",
};

// Codes that are already UQCs but are not one of our units (e.g. imported "ROL").
const PASSTHROUGH_UQC = new Set(["CBM", "ROL", "SQF", "SQM", "TUB", "QTL", "UNT", "CTN", "DRM", "CAN"]);

/** Map an item unit to its GST UQC code; unknown or missing units give `fallback`. */
export function gstUqcForUnit(unit: string | null | undefined, fallback = "OTH"): string {
  if (!unit) return fallback;
  const key = unit.trim().toLowerCase();
  const known = (GST_UQC_BY_UNIT as Record<string, string>)[key]
    ?? (UNIT_ALIASES[key] ? GST_UQC_BY_UNIT[UNIT_ALIASES[key]] : undefined);
  if (known) return known;
  const upper = key.toUpperCase();
  return PASSTHROUGH_UQC.has(upper) ? upper : fallback;
}
