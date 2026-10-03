/**
 * A tiny in-memory stand-in for the gstReturns router, for the wizard tests.
 * `server.attempt` is what filingAttempt returns; mutations are vi.fn()s the test
 * programs (they usually change `server.attempt`, like the real API does).
 */

export const makeAttempt = (over: Record<string, unknown> = {}) => ({
  kind: "gstr1",
  period: "082026",
  state: "draft",
  nil: false,
  saveRef: null,
  proceedRef: null,
  offsetRef: null,
  errors: [] as string[],
  hasSummary: false,
  hasDetails: false,
  ledger: null,
  proposal: null,
  proposalKey: null,
  filedRef: null,
  lastError: null,
  updatedAt: null as number | null,
  prerequisite: "",
  nilEligible: false,
  nilBlockers: [] as string[],
  ...over,
});

const filed = (arn: string) => ({ arn, filedOn: "2026-05-11", mode: "GSP", valid: true, status: "Filed", rawType: "GSTR1" });

/** Months Apr..Sep of FY 2026-27 with the given periods filed. */
export function fyStatus(g1: string[], g3: string[], over: Record<string, unknown> = {}) {
  const periods = ["042026", "052026", "062026", "072026", "082026", "092026"];
  return {
    status: "ok",
    reason: null,
    financialYear: "FY 2026-27",
    composition: false,
    cached: false,
    fetchedAt: Date.UTC(2026, 8, 5),
    months: periods.map((period) => ({
      period,
      label: period,
      gstr1: g1.includes(period) ? filed(`ARN1-${period}`) : null,
      gstr3b: g3.includes(period) ? filed(`ARN3-${period}`) : null,
      others: [],
    })),
    ...over,
  };
}

export const gstr1Report = {
  invoiceCount: 12,
  totalInvoiceValue: 118000,
  totalTaxableValue: 100000,
  totalTax: 18000,
  creditNotes: [],
  debitNotes: [],
};

export const gstr3bReport = {
  outwardSupplies: {
    taxable: { taxableValue: 100000, igst: 0, cgst: 9000, sgst: 9000 },
    zeroRated: { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 },
    exempt: { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 },
  },
  rcmSupplies: { taxableValue: "0", igst: "0", cgst: "0", sgst: "0" },
  itc: { igst: 0, cgst: 4000, sgst: 4000, total: 8000 },
  taxPayable: { igst: 0, cgst: 9000, sgst: 9000 },
  netTax: { igst: 0, cgst: 5000, sgst: 5000, total: 10000 },
};

export const proposal = (over: Record<string, unknown> = {}) => ({
  itc: { igstOnIgst: 0, igstOnCgst: 0, igstOnSgst: 0, cgstOnCgst: 4000, cgstOnIgst: 0, sgstOnSgst: 4000, sgstOnIgst: 0 },
  cash: { igst: { tx: 0, intr: 0, fee: 0 }, cgst: { tx: 5000, intr: 0, fee: 0 }, sgst: { tx: 5000, intr: 0, fee: 0 } },
  cashNeeded: { igst: 0, cgst: 5000, sgst: 5000 },
  cashShortfall: { igst: 0, cgst: 0, sgst: 0 },
  sufficient: true,
  itcRemaining: { igst: 0, cgst: 0, sgst: 0 },
  ...over,
});

export const ledger = {
  itc: { igst: 0, cgst: 4000, sgst: 4000 },
  cash: { igst: 0, cgst: 6000, sgst: 6000 },
};
