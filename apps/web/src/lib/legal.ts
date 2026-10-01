/**
 * The company's legal details, shown on the legal pages, the contact page,
 * the about page and the site footer. Kept here, free of UI imports, so there
 * is one place to change them.
 */

/** The legal entity that operates Fintranzact. */
export const LEGAL_ENTITY_NAME = "Finvera Solutions LLP";

/** Registered office address, one line per entry (for address blocks). */
export const REGISTERED_ADDRESS_LINES = [
  "B-603, 6th Floor, Darshan Srushti Apartment",
  "Kailashdhara Park, Nanavati Chowk",
  "Rajkot - 360005, Gujarat, India",
] as const;

/** Registered office address on a single line (for the footer). */
export const REGISTERED_ADDRESS = REGISTERED_ADDRESS_LINES.join(", ");

/** City the company is based in, for short mentions. */
export const REGISTERED_CITY = "Rajkot, Gujarat";

/** Company phone number as displayed. */
export const LEGAL_PHONE = "+91 76000 46416";

/** Company phone number for tel: links. */
export const LEGAL_PHONE_HREF = "tel:+917600046416";

/** Company email for legal, privacy, billing and grievance matters. */
export const LEGAL_EMAIL = "finverasolutionsllp@gmail.com";

/** Grievance Officer under the IT Rules, 2021 and the DPDP Act, 2023. */
export const GRIEVANCE_OFFICER = {
  name: "Rishi",
  role: "Grievance Officer",
  organization: LEGAL_ENTITY_NAME,
  email: LEGAL_EMAIL,
  phone: LEGAL_PHONE,
  phoneHref: LEGAL_PHONE_HREF,
} as const;

/** How quickly the Grievance Officer acknowledges a complaint. */
export const GRIEVANCE_ACKNOWLEDGE_WITHIN = "24 hours";

/** How quickly the Grievance Officer resolves a complaint. */
export const GRIEVANCE_RESOLVE_WITHIN = "15 days";

/** Law that governs the terms. */
export const GOVERNING_LAW = "the laws of India";

/** Courts with exclusive jurisdiction over disputes. */
export const JURISDICTION = "the courts at Rajkot, Gujarat";

/** Payment gateway that processes subscription payments. */
export const PAYMENT_PROCESSOR = {
  name: "Razorpay",
  legalName: "Razorpay Software Private Limited",
} as const;

/** Usual time for an approved refund to reach the customer. */
export const REFUND_CREDIT_TIME = "5–7 working days";

/** Date shown as "Last updated" on the legal pages. */
export const LEGAL_LAST_UPDATED = "30 September 2026";
