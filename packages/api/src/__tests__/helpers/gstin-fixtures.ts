/**
 * Mocked Sandbox "Search GSTIN" answers shaped like the documented examples.
 * Reference GSTINs come from the Sandbox docs; their check digits are not all
 * valid, which is why the test host does not enforce the check digit.
 */

export const addr = (over: Record<string, unknown> = {}) => ({
  bno: "No 12",
  bnm: "Prestige Tower",
  flno: "3rd Floor",
  st: "MG Road",
  loc: "Bengaluru",
  locality: "Ashok Nagar",
  dst: "Bengaluru Urban",
  stcd: "Karnataka",
  pncd: "560001",
  landMark: "Opp Metro Station",
  lt: "",
  lg: "",
  geocodelvl: "",
  ...over,
});

export const envelope = (record: Record<string, unknown>, tx = "tx-1") => ({
  code: 200,
  timestamp: 1_790_000_000_000,
  transaction_id: tx,
  data: { data: record, status_cd: "1" },
});

export const ACTIVE_REGULAR = envelope({
  gstin: "29AFSPB9500E1ZY",
  lgnm: "SHREE PACKAGING BHANDARI",
  tradeNam: "SHREE PACKAGING",
  sts: "Active",
  dty: "Regular",
  ctb: "Partnership",
  rgdt: "01/07/2017",
  cxdt: "",
  lstupdt: "12/03/2024",
  einvoiceStatus: "Yes",
  nba: ["Retail Business", "Wholesale Business"],
  ctj: "RANGE-1",
  stj: "Division 4",
  pradr: { addr: addr(), ntr: "Retail Business, Wholesale Business" },
  adadr: [{ addr: addr({ bno: "7", bnm: "Annex", stcd: "Tamil Nadu", pncd: "600001", loc: "Chennai", dst: "Chennai" }), ntr: ["Warehouse"] }],
});

export const CANCELLED = envelope({
  gstin: "36AEOFS9999J1ZI",
  lgnm: "SAI FABRICS",
  tradeNam: "",
  sts: "Cancelled",
  dty: "Regular",
  ctb: "Proprietorship",
  rgdt: "15/03/2019",
  cxdt: "31/12/2023",
  einvoiceStatus: "No",
  nba: ["Retail Business"],
  pradr: { addr: addr({ stcd: "Telangana", loc: "Hyderabad", pncd: "500001" }), ntr: "Retail Business" },
  adadr: [],
});

export const ISD = envelope({
  gstin: "27AACCA8432H2ZP",
  lgnm: "ACME LIMITED",
  tradeNam: "ACME LTD",
  sts: "Active",
  dty: "Input Service Distributor (ISD)",
  ctb: "Public Limited Company",
  rgdt: "01/07/2017",
  cxdt: "",
  einvoiceStatus: "No",
  nba: ["Input Service Distributor (ISD)"],
  pradr: { addr: addr({ stcd: "Maharashtra", loc: "Mumbai", pncd: "400001" }), ntr: "Input Service Distributor (ISD)" },
  adadr: [],
});

export const SEZ = envelope({
  gstin: "24AAACZ0629H1ZI",
  lgnm: "ZENITH SEZ DEVELOPERS PRIVATE LIMITED",
  tradeNam: "ZENITH SEZ",
  sts: "Active",
  dty: "SEZ Developer",
  ctb: "Private Limited Company",
  rgdt: "01/07/2017",
  cxdt: "",
  einvoiceStatus: "Yes",
  nba: ["SEZ"],
  pradr: { addr: addr({ stcd: "Gujarat", loc: "Surat", pncd: "395001" }), ntr: "SEZ" },
  adadr: [],
});

export const COMPOSITION = envelope({
  gstin: "27AAPFU0939F1ZV",
  lgnm: "UDAY TRADERS",
  tradeNam: "UDAY TRADERS",
  sts: "Active",
  dty: "Composition",
  ctb: "Proprietorship",
  rgdt: "01/04/2019",
  cxdt: "",
  einvoiceStatus: "No",
  nba: ["Retail Business"],
  pradr: { addr: addr({ stcd: "Maharashtra", loc: "Pune", pncd: "411001" }), ntr: "Retail Business" },
  adadr: [],
});

export const SUSPENDED = envelope({
  gstin: "27AAPFU0939F1ZV",
  lgnm: "UDAY TRADERS",
  tradeNam: "UDAY TRADERS",
  sts: "Suspended",
  dty: "Regular",
  ctb: "Proprietorship",
  rgdt: "01/04/2019",
  cxdt: "",
  nba: ["Retail Business"],
  pradr: { addr: addr({ stcd: "Maharashtra", loc: "Pune", pncd: "411001" }), ntr: "Retail Business" },
  adadr: [],
});

/** Non-resident (OIDAR / UIN style): no addresses, "NA" and empty strings. */
export const OIDAR = envelope({
  gstin: "9917SGP29002OSR",
  lgnm: "GLOBAL STREAMING PTE LTD",
  tradeNam: "",
  sts: "Active",
  dty: "Non-Resident Online Services Provider",
  ctb: "NA",
  rgdt: "01/10/2021",
  cxdt: "",
  stj: "NA",
  einvoiceStatus: "No",
  typeOfSup: "OIDAR",
});

export const MANY_ADDRESSES = envelope({
  ...(ACTIVE_REGULAR.data.data as Record<string, unknown>),
  adadr: Array.from({ length: 17 }, (_, i) => ({
    addr: addr({ bno: String(100 + i), bnm: `Depot ${i + 1}`, pncd: String(560100 + i) }),
    ntr: ["Warehouse"],
  })),
});

export const NO_RECORD = {
  code: 200,
  transaction_id: "tx-nr",
  data: { error: { error_cd: "FO8000", message: "No records found" }, status_cd: "0" },
};

export const INVALID_PATTERN = { code: 422, message: "Invalid GSTIN pattern", transaction_id: "tx-422" };

/** A real-checksum GSTIN for tests that exercise the live-host check digit. */
export const VALID_CHECKSUM_GSTIN = "27AAPFU0939F1ZV";
