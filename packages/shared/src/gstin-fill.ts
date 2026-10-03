/**
 * gstin-fill.ts — decide how a GST search result lands in the party form.
 *
 * Rule: empty fields are filled; fields that already hold a different value are
 * never overwritten silently. They come back as `conflicts` for the user to
 * confirm one by one. A field still holding a value we derived ourselves from
 * the GSTIN (PAN-based business type, the default "Registered" GST type) counts
 * as empty, because the user never typed it.
 */

import {
  partyConstitutionLabels,
  partyGstTypeLabels,
  type PartyConstitution,
  type PartyGstType,
} from "./party-compliance.js";
import { GST_STATES } from "./gstin.js";

export interface GstinFormValues {
  name: string;
  legalName: string;
  tradeName: string;
  billingAddress: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  gstType: PartyGstType | "";
  constitution: PartyConstitution | "";
}

/** The `details` object party.lookupGstin returns (Sandbox or IRP). */
export interface GstinDetails {
  gstin: string;
  legalName: string | null;
  tradeName: string | null;
  billingAddress: string | null;
  city: string | null;
  state?: string | null;
  stateCode: string | null;
  pincode: string | null;
  constitution: PartyConstitution | null;
  gstRegistrationType: PartyGstType | null;
  gstinStatus: "active" | "cancelled" | "suspended" | "inactive" | null;
  registeredOn?: string | null;
  cancelledOn?: string | null;
}

export type FillKey = keyof Omit<GstinFormValues, "stateCode">;

export interface FillConflict {
  key: FillKey;
  label: string;
  /** What the form holds now, as shown. */
  current: string;
  /** What the GST record says, as shown. */
  incoming: string;
  /** The form values to set when the user accepts. */
  patch: Partial<GstinFormValues>;
}

export interface FillPlan {
  /** Empty fields to fill straight away. */
  fills: Partial<GstinFormValues>;
  conflicts: FillConflict[];
}

const LABELS: Record<FillKey, string> = {
  name: "Party name",
  legalName: "Legal name",
  tradeName: "Trade name",
  billingAddress: "Billing address",
  city: "City",
  state: "State",
  pincode: "Pincode",
  gstType: "GST type",
  constitution: "Business type",
};

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function planGstinFill(
  d: GstinDetails,
  current: GstinFormValues,
  /** Values the form filled in by itself from the GSTIN (not typed by the user). */
  auto: Partial<GstinFormValues> = {},
): FillPlan {
  const fills: Partial<GstinFormValues> = {};
  const conflicts: FillConflict[] = [];

  const stateName = d.state || GST_STATES.find((s) => s.code === d.stateCode)?.name || "";
  const candidates: Array<{ key: FillKey; incoming: string; shown?: string; patch: Partial<GstinFormValues>; same?: (cur: GstinFormValues) => boolean }> = [
    { key: "name", incoming: d.tradeName || d.legalName || "", patch: { name: d.tradeName || d.legalName || "" } },
    { key: "legalName", incoming: d.legalName ?? "", patch: { legalName: d.legalName ?? "" } },
    { key: "tradeName", incoming: d.tradeName ?? "", patch: { tradeName: d.tradeName ?? "" } },
    { key: "billingAddress", incoming: d.billingAddress ?? "", patch: { billingAddress: d.billingAddress ?? "" } },
    { key: "city", incoming: d.city ?? "", patch: { city: d.city ?? "" } },
    {
      key: "state",
      incoming: stateName,
      patch: { state: stateName, stateCode: d.stateCode ?? "" },
      same: (cur) => (d.stateCode && cur.stateCode ? cur.stateCode === d.stateCode : norm(cur.state) === norm(stateName)),
    },
    { key: "pincode", incoming: d.pincode ?? "", patch: { pincode: d.pincode ?? "" } },
    {
      key: "gstType",
      incoming: d.gstRegistrationType ?? "",
      shown: d.gstRegistrationType ? partyGstTypeLabels[d.gstRegistrationType] : "",
      patch: { gstType: d.gstRegistrationType ?? "" },
    },
    {
      key: "constitution",
      incoming: d.constitution ?? "",
      shown: d.constitution ? partyConstitutionLabels[d.constitution] : "",
      patch: { constitution: d.constitution ?? "" },
    },
  ];

  for (const c of candidates) {
    if (!c.incoming) continue;
    const cur = current[c.key] as string;
    const derived = (auto as Record<string, string | undefined>)[c.key];
    const isEmpty = !cur.trim() || (derived !== undefined && cur === derived);
    if (isEmpty) {
      Object.assign(fills, c.patch);
      continue;
    }
    // The party name is what the user calls them; the legal and trade names carry the registered ones.
    if (c.key === "name") continue;
    const same = c.same ? c.same(current) : norm(cur) === norm(c.incoming);
    if (same) continue;
    const label = (k: FillKey, v: string) =>
      k === "gstType" ? partyGstTypeLabels[v as PartyGstType] ?? v : k === "constitution" ? partyConstitutionLabels[v as PartyConstitution] ?? v : v;
    conflicts.push({
      key: c.key,
      label: LABELS[c.key],
      current: label(c.key, cur),
      incoming: c.shown || c.incoming,
      patch: c.patch,
    });
  }
  return { fills, conflicts };
}
