/**
 * gstr4-json.ts — maps the GSTR-4 tables (lib/gstr4.ts) to a JSON file shaped
 * like the GST portal's offline-utility upload.
 *
 * BEST EFFORT, NOT VERIFIED AGAINST THE PORTAL. What is reasonably reliable:
 * the amount keys that every GST portal JSON uses (txval, camt, samt, iamt,
 * csamt, rt), the "gstin" and "fy" header and the annual-return concept. What
 * is NOT verified: the table keys, the section names, the nesting and whether
 * the portal wants tax-paid and interest sections in this file at all. Every
 * name that is a guess lives in GSTR4_PORTAL_KEYS below, in one place, so it is
 * fixed there once the schema from the offline tool is at hand. Do not upload
 * this file to the portal without checking it against that schema (or use it as
 * the reference for keying the figures into the tool by hand).
 */

import { money } from "@fintranzact/shared";
import type { Gstr4InwardKind, Gstr4Report } from "./gstr4.js";

/**
 * VERIFY against the GST offline tool / portal schema before upload.
 * Every key below is a best guess unless noted.
 */
export const GSTR4_PORTAL_KEYS = {
  // Header: "gstin" is standard on portal JSON; "fy" for an annual return is likely.
  gstin: "gstin",
  fy: "fy",
  // Section names (guessed).
  inward: "table4",
  outward: "table5",
  rateWise: "table6",
  taxPaid: "table7",
  // Table 4 row codes (follow the post-2021 form numbering; see docs/GSTR-4.md).
  inwardRows: {
    registered_non_rcm: "4A",
    registered_rcm: "4B",
    unregistered_rcm: "4C",
    unregistered_non_rcm: "4C",
    import_of_services: "4D",
  } as Record<Gstr4InwardKind, string>,
  // Amount keys: the usual portal amount keys (txval, iamt, camt, samt, csamt, rt) are
  // the part most likely to be right; the quarter and tax-paid keys are guesses.
  amounts: { taxableValue: "txval", integrated: "iamt", central: "camt", state: "samt", cess: "csamt", rate: "rt" },
  quarter: "qtr",
  quarterRows: "qtrs",
  payable: { composition: "cmp_tax", rcm: "rcm_tax", total: "tot_tax" },
  paid: { cmp08: "paid_cmp08", balance: "bal_pay", excess: "excess_paid" },
  interest: "intr",
  lateFee: "lfee",
} as const;

const K = GSTR4_PORTAL_KEYS;
const num = (v: string): number => parseFloat(money.add(v, 0));

export interface Gstr4JsonOptions {
  /** Business GSTIN (the report itself does not carry it). */
  gstin: string;
  /** Financial year such as "2026-27". */
  fy: string;
}

/** Table 4 sums rows that share a portal code (unregistered, with and without reverse charge). */
function inwardSection(report: Gstr4Report): Record<string, Record<string, number>> {
  const out: Record<string, { txval: string; iamt: string; camt: string; samt: string; csamt: string }> = {};
  for (const row of report.inward.rows) {
    const code = K.inwardRows[row.kind];
    const a = out[code] ?? { txval: "0", iamt: "0", camt: "0", samt: "0", csamt: "0" };
    a.txval = money.add(a.txval, row.taxableValue);
    a.iamt = money.add(a.iamt, row.integratedTax);
    a.camt = money.add(a.camt, row.centralTax);
    a.samt = money.add(a.samt, row.stateTax);
    a.csamt = money.add(a.csamt, row.cess);
    out[code] = a;
  }
  const A = K.amounts;
  return Object.fromEntries(Object.entries(out).map(([code, a]) => [code, {
    [A.taxableValue]: num(a.txval), [A.integrated]: num(a.iamt), [A.central]: num(a.camt),
    [A.state]: num(a.samt), [A.cess]: num(a.csamt),
  }]));
}

export function gstr4ToPortalJson(report: Gstr4Report, opts: Gstr4JsonOptions): Record<string, unknown> {
  const A = K.amounts;
  const tp = report.taxPaid;
  return {
    [K.gstin]: opts.gstin,
    [K.fy]: opts.fy,
    [K.inward]: inwardSection(report),
    [K.outward]: {
      [K.quarterRows]: report.outward.quarters.map((q) => ({
        [K.quarter]: q.quarter, [A.taxableValue]: num(q.taxableValue), [A.rate]: num(q.rate), tax: num(q.tax),
      })),
      [A.taxableValue]: num(report.outward.taxableValue),
      tax: num(report.outward.tax),
      exempt: num(report.outward.exempt),
      nil: num(report.outward.nilRated),
      non_gst: num(report.outward.nonGst),
    },
    [K.rateWise]: report.rateWise.map((r) => ({
      [A.rate]: num(r.rate), [A.taxableValue]: num(r.taxableValue),
      [A.central]: num(r.centralTax), [A.state]: num(r.stateTax), [A.integrated]: num(r.integratedTax),
    })),
    [K.taxPaid]: {
      [K.payable.composition]: num(tp.compositionTaxPayable),
      [K.payable.rcm]: num(tp.rcmTaxPayable),
      [K.payable.total]: num(tp.totalPayable),
      [K.paid.cmp08]: num(tp.paidThroughCmp08),
      [K.paid.balance]: num(tp.balancePayable),
      [K.paid.excess]: num(tp.excessPaid),
      [K.interest]: num(tp.interest),
      [K.lateFee]: num(tp.lateFee),
    },
  };
}
