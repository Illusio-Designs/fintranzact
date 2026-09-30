/**
 * GST / MSME / TDS details for parties (mostly suppliers).
 *
 * Shared by the API, web and mobile so the lists, formats, derived values and
 * warnings stay identical everywhere.
 */

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

/** Characters 3-12 of a valid GSTIN are the holder's PAN; null otherwise. */
export function panFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const normalized = gstin.trim().toUpperCase();
  return GSTIN_REGEX.test(normalized) ? normalized.slice(2, 12) : null;
}

// ── GST registration ───────────────────────────────────────────────────────

export const partyGstTypes = ["regular", "composition", "unregistered", "sez", "overseas", "uin"] as const;
export type PartyGstType = (typeof partyGstTypes)[number];

export const partyGstTypeLabels: Record<PartyGstType, string> = {
  regular: "Registered (regular)",
  composition: "Composition scheme",
  unregistered: "Unregistered",
  sez: "SEZ unit / developer",
  overseas: "Overseas (import / export)",
  uin: "UN body / embassy (UIN)",
};

/** Supplier types whose bills don't give the buyer input tax credit. */
export const noItcGstTypes: readonly PartyGstType[] = ["composition", "unregistered"];

export const partyConstitutions = [
  "proprietorship", "partnership", "llp", "private_company", "public_company",
  "huf", "trust", "society", "government", "other",
] as const;
export type PartyConstitution = (typeof partyConstitutions)[number];

export const partyConstitutionLabels: Record<PartyConstitution, string> = {
  proprietorship: "Proprietorship",
  partnership: "Partnership firm",
  llp: "LLP",
  private_company: "Private limited company",
  public_company: "Public limited company",
  huf: "HUF",
  trust: "Trust",
  society: "Society / AOP / BOI",
  government: "Government body",
  other: "Other",
};

/**
 * The 4th character of a PAN encodes the holder type. Firms (F) cover both
 * partnerships and LLPs, and companies (C) both private and public, so the
 * guess is the most common case; the user can correct it.
 */
export function constitutionFromPan(pan: string | null | undefined): PartyConstitution | null {
  if (!pan || !PAN_REGEX.test(pan.trim().toUpperCase())) return null;
  switch (pan.trim().toUpperCase()[3]) {
    case "P": return "proprietorship";
    case "F": return "partnership";
    case "C": return "private_company";
    case "H": return "huf";
    case "T": return "trust";
    case "A":
    case "B": return "society";
    case "G":
    case "L": return "government";
    default: return "other";
  }
}

export const gstinStatuses = ["active", "cancelled", "suspended", "inactive"] as const;
export type GstinStatus = (typeof gstinStatuses)[number];

/** First two digits of a valid GSTIN are the GST state code; null otherwise. */
export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const normalized = gstin.trim().toUpperCase();
  return GSTIN_REGEX.test(normalized) ? normalized.slice(0, 2) : null;
}

// ── MSME (Udyam) ───────────────────────────────────────────────────────────

export const msmeCategories = ["micro", "small", "medium"] as const;
export type MsmeCategory = (typeof msmeCategories)[number];

/** e.g. UDYAM-MH-26-0012345 */
export const UDYAM_REGEX = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;

/**
 * Section 43B(h): pay registered micro and small suppliers within 15 days, or
 * up to 45 days when agreed in writing, to deduct the expense that year.
 * Medium enterprises are not covered.
 */
export const MSME_PAYMENT_DAYS = 45;
export function isMsmePaymentRuleCovered(p: { isMsme?: boolean | null; msmeCategory?: string | null }) {
  return !!p.isMsme && p.msmeCategory !== "medium";
}

// ── Bank ───────────────────────────────────────────────────────────────────

/** 4 letters (bank), a zero, then 6 letters/digits (branch). */
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// ── TDS ────────────────────────────────────────────────────────────────────

export interface TdsSection {
  code: string;
  label: string;
  /** Rate in percent when the payee has given a valid PAN. */
  rate: string;
  /** Different rate for individuals / HUFs, where the Act has one. */
  individualRate?: string;
  /** Rate in percent when no valid PAN is given (s.206AA / s.397(2)). */
  rateWithoutPan: string;
  note: string;
}

/**
 * Common TDS sections on business payments (FY 2026-27). From 1 April 2026
 * they sit under s.393 of the Income Tax Act 2025; the familiar 1961 numbers
 * are kept as codes because that is what businesses and CAs still use.
 * Thresholds decide *whether* TDS applies; these are only the rates.
 */
export const tdsSections: readonly TdsSection[] = [
  { code: "194Q", label: "194Q · Purchase of goods", rate: "0.1", rateWithoutPan: "5", note: "On purchases above ₹50 lakh a year from one seller, if your turnover was above ₹10 crore last year." },
  { code: "194C", label: "194C · Contractors", rate: "2", individualRate: "1", rateWithoutPan: "20", note: "1% for individuals/HUFs, 2% for firms and companies." },
  { code: "194J_TECH", label: "194J · Technical services / royalty", rate: "2", rateWithoutPan: "20", note: "Technical services, call centres, certain royalties." },
  { code: "194J_PROF", label: "194J · Professional fees", rate: "10", rateWithoutPan: "20", note: "Professional services such as CA, legal, consultants." },
  { code: "194H", label: "194H · Commission / brokerage", rate: "2", rateWithoutPan: "20", note: "Commission and brokerage." },
  { code: "194I_PM", label: "194I · Rent – plant & machinery", rate: "2", rateWithoutPan: "20", note: "Rent for plant, machinery or equipment." },
  { code: "194I_LB", label: "194I · Rent – land / building", rate: "10", rateWithoutPan: "20", note: "Rent for land, building, furniture or fittings." },
];

export const tdsSectionCodes = tdsSections.map((s) => s.code) as [string, ...string[]];

const INDIVIDUAL_CONSTITUTIONS: readonly string[] = ["proprietorship", "huf"];

/** TDS rate in percent for a party, or null when no section is set. */
export function tdsRateFor(p: {
  tdsSection?: string | null;
  pan?: string | null;
  gstin?: string | null;
  constitution?: string | null;
}): string | null {
  const section = tdsSections.find((s) => s.code === p.tdsSection);
  if (!section) return null;
  const hasPan = !!(p.pan?.trim() || panFromGstin(p.gstin));
  if (!hasPan) return section.rateWithoutPan;
  if (section.individualRate && p.constitution && INDIVIDUAL_CONSTITUTIONS.includes(p.constitution)) {
    return section.individualRate;
  }
  return section.rate;
}

// ── Warnings ───────────────────────────────────────────────────────────────

export interface PartyComplianceInput {
  type?: string | null;
  gstin?: string | null;
  pan?: string | null;
  stateCode?: string | null;
  gstRegistrationType?: string | null;
  gstinStatus?: string | null;
  isMsme?: boolean | null;
  udyamNumber?: string | null;
  tdsSection?: string | null;
}

/**
 * Non-blocking problems worth showing next to a party. Format errors are
 * enforced by createPartySchema; these are mismatches and risks, deliberately
 * not blocking so imported or hand-entered values still save.
 */
export function partyComplianceWarnings(p: PartyComplianceInput): string[] {
  const warnings: string[] = [];
  const gstPan = panFromGstin(p.gstin);
  const pan = p.pan?.trim().toUpperCase();

  if (gstPan && pan && gstPan !== pan) {
    warnings.push(`PAN ${pan} doesn't match the PAN inside the GSTIN (${gstPan}).`);
  }
  const gstState = stateCodeFromGstin(p.gstin);
  if (gstState && p.stateCode && gstState !== p.stateCode) {
    warnings.push(`State code ${p.stateCode} doesn't match the GSTIN's state (${gstState}); GST will be split wrongly.`);
  }
  if (p.gstin && !p.stateCode && !gstState) {
    warnings.push("Add the state so CGST+SGST or IGST can be worked out.");
  }
  if (p.gstinStatus && p.gstinStatus !== "active") {
    warnings.push(`GSTIN is ${p.gstinStatus} — input tax credit on its bills can be denied.`);
  }
  if (p.type === "supplier" && p.gstRegistrationType && (noItcGstTypes as readonly string[]).includes(p.gstRegistrationType)) {
    warnings.push("No input tax credit on purchases from composition or unregistered suppliers.");
  }
  if (p.tdsSection && !pan && !gstPan) {
    const section = tdsSections.find((s) => s.code === p.tdsSection);
    warnings.push(`No PAN — TDS applies at ${section?.rateWithoutPan ?? "20"}% instead of the normal rate.`);
  }
  if (p.isMsme && !p.udyamNumber) {
    warnings.push("Marked as MSME without a Udyam number — only a Udyam registration proves MSME status.");
  }
  return warnings;
}
