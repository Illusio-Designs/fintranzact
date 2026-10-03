import { describe, it, expect } from "vitest";
import { proposeOffset, offsetBody, parseLedgerBalances, proposalKey, type HeadAmounts } from "../lib/gst-3b-offset.js";

const h = (igst: number, cgst: number, sgst: number): HeadAmounts => ({ igst, cgst, sgst });
const Z = h(0, 0, 0);

describe("proposeOffset: statutory utilisation order", () => {
  type Row = {
    name: string;
    liability: HeadAmounts;
    itc: HeadAmounts;
    cash?: HeadAmounts;
    rcm?: HeadAmounts;
    blocked?: boolean;
    itcUse: Partial<Record<string, number>>;
    cashTx: HeadAmounts;
    sufficient?: boolean;
  };
  const rows: Row[] = [
    { name: "zero liability: nothing used", liability: Z, itc: h(100, 100, 100), itcUse: {}, cashTx: Z },
    { name: "IGST credit pays IGST first", liability: h(100, 0, 0), itc: h(100, 50, 50), itcUse: { igstOnIgst: 100 }, cashTx: Z },
    { name: "IGST credit then spills to CGST then SGST", liability: h(0, 60, 60), itc: h(100, 0, 0), itcUse: { igstOnCgst: 60, igstOnSgst: 40 }, cashTx: h(0, 0, 20) },
    { name: "CGST credit pays CGST, then IGST", liability: h(30, 40, 0), itc: h(0, 60, 0), itcUse: { cgstOnCgst: 40, cgstOnIgst: 20 }, cashTx: h(10, 0, 0) },
    { name: "SGST credit pays SGST, then IGST", liability: h(30, 0, 40), itc: h(0, 0, 60), itcUse: { sgstOnSgst: 40, sgstOnIgst: 20 }, cashTx: h(10, 0, 0) },
    { name: "CGST credit never pays SGST and SGST credit never pays CGST", liability: h(0, 50, 50), itc: h(0, 0, 80), itcUse: { sgstOnSgst: 50 }, cashTx: h(0, 50, 0) },
    { name: "IGST credit is applied before CGST credit against IGST", liability: h(80, 0, 0), itc: h(50, 50, 0), itcUse: { igstOnIgst: 50, cgstOnIgst: 30 }, cashTx: Z },
    { name: "insufficient credit: the rest is cash, head by head", liability: h(100, 100, 100), itc: h(10, 10, 10), itcUse: { igstOnIgst: 10, cgstOnCgst: 10, sgstOnSgst: 10 }, cashTx: h(90, 90, 90) },
    { name: "ITC blocked: all cash", liability: h(10, 20, 30), itc: h(100, 100, 100), blocked: true, itcUse: {}, cashTx: h(10, 20, 30) },
    { name: "reverse charge is cash only even with credit available", liability: Z, itc: h(100, 100, 100), rcm: h(5, 6, 7), itcUse: {}, cashTx: h(5, 6, 7) },
    { name: "mixed: RCM plus outward", liability: h(0, 100, 100), itc: h(0, 100, 100), rcm: h(0, 10, 10), itcUse: { cgstOnCgst: 100, sgstOnSgst: 100 }, cashTx: h(0, 10, 10) },
  ];

  it.each(rows)("$name", (r) => {
    const p = proposeOffset({ liability: r.liability, itc: r.itc, cash: r.cash ?? h(1e6, 1e6, 1e6), rcmCash: r.rcm, itcBlocked: r.blocked });
    for (const [k, v] of Object.entries(p.itc)) expect(v, k).toBe(r.itcUse[k] ?? 0);
    expect({ igst: p.cash.igst.tx, cgst: p.cash.cgst.tx, sgst: p.cash.sgst.tx }).toEqual(r.cashTx);
    // conservation: liability + rcm = credit used against it + cash tx
    const used = Object.values(p.itc).reduce((a, b) => a + b, 0);
    const owed = r.liability.igst + r.liability.cgst + r.liability.sgst + (r.rcm ? r.rcm.igst + r.rcm.cgst + r.rcm.sgst : 0);
    const cash = p.cash.igst.tx + p.cash.cgst.tx + p.cash.sgst.tx;
    expect(used + cash).toBeCloseTo(owed, 2);
    expect(p.sufficient).toBe(true);
  });

  it("never uses more credit than a head holds, and reports what is left", () => {
    const p = proposeOffset({ liability: h(500, 500, 500), itc: h(120.5, 30.25, 80), cash: h(1e6, 1e6, 1e6) });
    expect(p.itc.igstOnIgst + p.itc.igstOnCgst + p.itc.igstOnSgst).toBeLessThanOrEqual(120.5);
    expect(p.itcRemaining).toEqual(h(0, 0, 0));
    const q = proposeOffset({ liability: h(10, 0, 0), itc: h(100, 5, 5), cash: Z });
    expect(q.itcRemaining).toEqual(h(90, 5, 5));
  });

  it("cash shortfall: insufficient cash balance is reported per head and blocks 'sufficient'", () => {
    const p = proposeOffset({ liability: h(0, 100, 0), itc: Z, cash: h(0, 60, 0), interest: h(0, 5, 0), lateFee: h(0, 5, 0) });
    expect(p.cashNeeded.cgst).toBe(110);
    expect(p.cashShortfall).toEqual(h(0, 50, 0));
    expect(p.sufficient).toBe(false);
    expect(p.cash.cgst).toEqual({ tx: 100, intr: 5, fee: 5 });
  });

  it("is exact in paise (no floating drift)", () => {
    const p = proposeOffset({ liability: h(0.1, 0.2, 0), itc: h(0.1, 0.2, 0), cash: Z });
    expect(p.itc.igstOnIgst + p.itc.cgstOnCgst).toBeCloseTo(0.3, 10);
    expect(p.cash.igst.tx + p.cash.cgst.tx).toBe(0);
  });
});

describe("offsetBody / proposalKey", () => {
  it("maps the proposal onto pdcash / pditc (GSTN names, VERIFY) and includes ledger ids only when known", () => {
    const p = proposeOffset({ liability: h(10, 20, 20), itc: h(5, 10, 10), cash: h(1e3, 1e3, 1e3) });
    const b = offsetBody(p);
    expect(b.pditc).toEqual({ i_pdi: 5, i_pdc: 0, i_pds: 0, c_pdi: 0, c_pdc: 10, s_pdi: 0, s_pds: 10, cs_pdcs: 0 });
    expect(b.pdcash).toEqual([{ ipd: { tx: 5, intr: 0, fee: 0 }, cpd: { tx: 10, intr: 0, fee: 0 }, spd: { tx: 10, intr: 0, fee: 0 } }]);
    expect(offsetBody(p, { liab_ldg_id: 7, trans_typ: 30002 }).pditc).toMatchObject({ liab_ldg_id: 7, trans_typ: 30002 });
  });
  it("the key changes with the proposal", () => {
    const a = proposeOffset({ liability: h(10, 0, 0), itc: h(10, 0, 0), cash: Z });
    const b = proposeOffset({ liability: h(10, 0, 0), itc: h(5, 0, 0), cash: h(1e3, 0, 0) });
    expect(proposalKey(a)).not.toBe(proposalKey(b));
  });
});

describe("parseLedgerBalances", () => {
  it("reads GSTN-style balances (plain numbers or { tot })", () => {
    expect(parseLedgerBalances({ data: { cash_bal: { igst: { tot: "10" }, cgst: { tot: 20 }, sgst: { tot: 30 } }, itc_bal: { igst_bal: 1, cgst_bal: 2, sgst_bal: 3 } } })).toEqual({
      cash: h(10, 20, 30),
      itc: h(1, 2, 3),
    });
  });
  it("returns null rather than guessing", () => {
    expect(parseLedgerBalances(null)).toBeNull();
    expect(parseLedgerBalances({ cash_bal: { igst: 1 }, itc_bal: { igst: 1, cgst: 1, sgst: 1 } })).toBeNull();
    expect(parseLedgerBalances({ x: 1 })).toBeNull();
  });
});
