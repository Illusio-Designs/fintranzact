/**
 * GSTIN helpers shared by the API, web and mobile: format + check-digit
 * validation, the GST state list, and the mapping of a Sandbox "Search GSTIN"
 * record (normalised to a GstinProfile) onto party form fields.
 *
 * Everything here is pure. Anything we infer rather than read from the portal
 * is marked VERIFY and listed in docs/SANDBOX-INTEGRATION.md.
 */

import {
  GSTIN_REGEX,
  PAN_REGEX,
  constitutionFromPan,
  panFromGstin,
  type GstinStatus,
  type PartyConstitution,
  type PartyGstType,
} from "./party-compliance.js";

// ── Format and check digit ─────────────────────────────────────────────────

/** UIN holders (embassies, UN bodies): 4 digits, 3 letters, 5 digits, 3 letters. VERIFY exact format. */
export const UIN_REGEX = /^[0-9]{4}[A-Z]{3}[0-9]{5}[A-Z]{3}$/;
/** Non-resident online (OIDAR) providers: 9917, 3 letters, 5 digits, O, 2 letters. VERIFY exact format. */
export const OIDAR_REGEX = /^9917[A-Z]{3}[0-9]{5}O[A-Z]{2}$/;

const CHECK_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The 15th character a regular GSTIN must carry, from its first 14; "" for bad input. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHECK_ALPHABET.indexOf(first14[i] ?? "");
    if (v < 0) return "";
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHECK_ALPHABET[(36 - (sum % 36)) % 36];
}

export type GstinFormat = "regular" | "uin" | "oidar";

export interface GstinValidation {
  /** Upper-cased, trimmed input. */
  gstin: string;
  /** Pattern is right (and, when checksum is strict, the check digit too). */
  valid: boolean;
  format: GstinFormat | null;
  /** True/false for regular GSTINs; null for UIN / OIDAR (no known check digit). */
  checksumOk: boolean | null;
  reason?: "empty" | "format" | "checksum";
}

/**
 * Validate a GSTIN without any network call. Regular GSTINs get the check
 * digit test; UIN and OIDAR (non-resident) patterns only get the pattern test.
 * `strictChecksum: false` reports the check digit in `checksumOk` but does not
 * fail on it (Sandbox's test environment documents GSTINs with wrong digits).
 */
export function validateGstin(input: string | null | undefined, opts: { strictChecksum?: boolean } = {}): GstinValidation {
  const gstin = (input ?? "").trim().toUpperCase();
  if (!gstin) return { gstin, valid: false, format: null, checksumOk: null, reason: "empty" };
  if (GSTIN_REGEX.test(gstin)) {
    const checksumOk = gstinCheckChar(gstin.slice(0, 14)) === gstin[14];
    if (!checksumOk && (opts.strictChecksum ?? true)) return { gstin, valid: false, format: "regular", checksumOk, reason: "checksum" };
    return { gstin, valid: true, format: "regular", checksumOk };
  }
  if (OIDAR_REGEX.test(gstin)) return { gstin, valid: true, format: "oidar", checksumOk: null };
  if (UIN_REGEX.test(gstin)) return { gstin, valid: true, format: "uin", checksumOk: null };
  return { gstin, valid: false, format: null, checksumOk: null, reason: "format" };
}

// ── GST states ─────────────────────────────────────────────────────────────

/** GST state / UT codes with the names the GST portal uses. */
export const GST_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "01", name: "Jammu & Kashmir" }, { code: "02", name: "Himachal Pradesh" }, { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" }, { code: "05", name: "Uttarakhand" }, { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" }, { code: "08", name: "Rajasthan" }, { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" }, { code: "11", name: "Sikkim" }, { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" }, { code: "14", name: "Manipur" }, { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" }, { code: "17", name: "Meghalaya" }, { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" }, { code: "20", name: "Jharkhand" }, { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" }, { code: "23", name: "Madhya Pradesh" }, { code: "24", name: "Gujarat" },
  { code: "25", name: "Daman & Diu" }, { code: "26", name: "Dadra & Nagar Haveli and Daman & Diu" },
  { code: "27", name: "Maharashtra" }, { code: "28", name: "Andhra Pradesh" }, { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" }, { code: "31", name: "Lakshadweep" }, { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" }, { code: "34", name: "Puducherry" }, { code: "35", name: "Andaman & Nicobar Islands" },
  { code: "36", name: "Telangana" }, { code: "37", name: "Andhra Pradesh (New)" }, { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
];

const stateKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/\b(and|the|of)\b/g, " ")
    .replace(/[^a-z]+/g, "");

/** Spellings the portal and older records use that differ from our names. VERIFY against live data. */
const STATE_ALIASES: Record<string, string> = {
  orissa: "21",
  pondicherry: "34",
  uttaranchal: "05",
  jammukashmir: "01",
  damandiu: "26",
  dadranagarhaveli: "26",
  dadranagarhavelidamandiu: "26",
  nctdelhi: "07",
  newdelhi: "07",
  telengana: "36",
  chattisgarh: "22",
  andamannicobar: "35",
  andhrapradeshnew: "28",
};

const STATE_BY_KEY = new Map<string, string>();
for (const s of GST_STATES) {
  const k = stateKey(s.name);
  if (!STATE_BY_KEY.has(k)) STATE_BY_KEY.set(k, s.code);
}

/**
 * GST state code for a state name as the portal prints it ("Karnataka"); null
 * when unknown. "Andhra Pradesh" maps to 28 (the 37 code is an alias of the
 * same name and is only ever taken from the GSTIN itself).
 */
export function stateCodeFromStateName(name: string | null | undefined): string | null {
  if (!name) return null;
  const k = stateKey(name);
  if (!k) return null;
  return STATE_BY_KEY.get(k) ?? STATE_ALIASES[k] ?? null;
}

export function stateNameFromCode(code: string | null | undefined): string | null {
  return GST_STATES.find((s) => s.code === code)?.name ?? null;
}

// ── Profile ────────────────────────────────────────────────────────────────

export type GstinProfileStatus = "active" | "cancelled" | "suspended" | "provisional" | "other";

export interface GstinAddress {
  line1: string;
  line2: string;
  city: string;
  district: string;
  /** State name as we list it (from the code when known, else the portal's). */
  state: string;
  /** Two-digit GST state code; "" when it cannot be told. */
  stateCode: string;
  pincode: string;
  /** The portal's state name disagrees with the GSTIN's own state code. */
  stateMismatch?: boolean;
}

export interface GstinProfile {
  gstin: string;
  legalName: string;
  tradeName: string;
  status: GstinProfileStatus;
  /** The portal's own status word. */
  statusRaw: string;
  /** Taxpayer type as printed ("Regular", "Composition", "SEZ Developer", ...). */
  taxpayerType: string;
  /** Constitution of business as printed; "" when the portal says NA. */
  constitution: string;
  /** ISO date or null. */
  registeredOn: string | null;
  cancelledOn: string | null;
  lastUpdatedOn: string | null;
  eInvoiceEnabled: boolean | null;
  natureOfBusiness: string[];
  principalAddress: GstinAddress | null;
  additionalAddresses: GstinAddress[];
  source: "sandbox";
  transactionId?: string;
  /** Fields we derived rather than read (the VERIFY list). */
  inferred: string[];
}

/** Party GST type from a taxpayer type string; null when it says nothing usable. VERIFY exact strings. */
export function gstTypeFromTaxpayerType(dty: string | null | undefined): PartyGstType | null {
  const t = (dty ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t.includes("composition")) return "composition";
  if (t.includes("sez")) return "sez";
  if (/\buin\b|united nations|embass/.test(t)) return "uin";
  if (/non[- ]resident|oidar|online services/.test(t)) return "overseas";
  if (t.includes("unregistered")) return "unregistered";
  if (/regular|input service distributor|\bisd\b|casual|tax deductor|\btds\b|tax collector|\btcs\b|e-commerce/.test(t)) return "regular";
  return null;
}

/** Party constitution from the portal's "constitution of business" text; null when unclear. VERIFY exact strings. */
export function constitutionFromText(ctb: string | null | undefined): PartyConstitution | null {
  const t = (ctb ?? "").trim().toLowerCase();
  if (!t || t === "na" || t === "n/a") return null;
  if (t.includes("proprietor")) return "proprietorship";
  if (t.includes("limited liability") || /\bllp\b/.test(t)) return "llp";
  if (t.includes("partnership")) return "partnership";
  if (t.includes("public limited") || t.includes("public company")) return "public_company";
  if (/private limited|private company|unlimited company|foreign company|limited company/.test(t)) return "private_company";
  if (t.includes("hindu undivided") || /\bhuf\b/.test(t)) return "huf";
  if (t.includes("trust")) return "trust";
  if (/society|club|\baop\b|\bboi\b/.test(t)) return "society";
  if (/government|local authority|statutory body|public sector/.test(t)) return "government";
  return "other";
}

const PROFILE_TO_PARTY_STATUS: Record<GstinProfileStatus, GstinStatus | null> = {
  active: "active",
  provisional: "active",
  cancelled: "cancelled",
  suspended: "suspended",
  other: null,
};

export interface PartyFieldsFromGstin {
  gstin: string;
  legalName: string | null;
  tradeName: string | null;
  billingAddress: string | null;
  city: string | null;
  /** State name as our state picker lists it. */
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
  pan: string | null;
  constitution: PartyConstitution | null;
  gstRegistrationType: PartyGstType | null;
  gstinStatus: GstinStatus | null;
  blocked: boolean;
  registeredOn: string | null;
  cancelledOn: string | null;
}

/** Address lines (building, street) as one string for the party's address box. */
export function gstinAddressText(a: Pick<GstinAddress, "line1" | "line2">): string {
  return [a.line1, a.line2].map((s) => s.trim()).filter(Boolean).join(", ");
}

/** The party form fields a profile fills. Same shape as the IRP lookup so callers share one path. */
export function partyFieldsFromGstinProfile(p: GstinProfile): PartyFieldsFromGstin {
  const a = p.principalAddress;
  const pan = panFromGstin(p.gstin);
  return {
    gstin: p.gstin,
    legalName: p.legalName || null,
    tradeName: p.tradeName || null,
    billingAddress: a ? gstinAddressText(a) || null : null,
    city: a?.city || null,
    state: a?.state || null,
    stateCode: a?.stateCode || null,
    pincode: a?.pincode || null,
    pan,
    constitution: constitutionFromText(p.constitution) ?? (pan && PAN_REGEX.test(pan) ? constitutionFromPan(pan) : null),
    gstRegistrationType: gstTypeFromTaxpayerType(p.taxpayerType),
    gstinStatus: PROFILE_TO_PARTY_STATUS[p.status],
    blocked: false,
    registeredOn: p.registeredOn,
    cancelledOn: p.cancelledOn,
  };
}

/** A profile address as a party shipping-address entry. */
export function shippingEntryFromGstinAddress(a: GstinAddress, label: string): {
  label: string; address: string; city?: string; state?: string; stateCode?: string; pincode?: string;
} {
  return {
    label,
    address: gstinAddressText(a) || a.city,
    ...(a.city ? { city: a.city } : {}),
    ...(a.state ? { state: a.state } : {}),
    ...(a.stateCode ? { stateCode: a.stateCode } : {}),
    ...(a.pincode ? { pincode: a.pincode } : {}),
  };
}
