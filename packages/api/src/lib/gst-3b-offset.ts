/**
 * gst-3b-offset.ts — proposed set-off of GSTR-3B tax liability against the
 * electronic credit and cash ledgers.
 *
 * PURE and unit-tested (gst-3b-offset.test.ts). It only PROPOSES a split: the
 * router shows it to the user with the ledger balances and posts nothing until
 * the user confirms. Needs a CA's sign-off before go-live (see
 * docs/GST-RETURNS-CA-VERIFICATION.md).
 *
 * Utilisation order implemented (CGST Act s.49A / s.49B, Rule 88A):
 *   1. IGST credit: against IGST, then CGST, then SGST.
 *   2. CGST credit: against CGST, then IGST. Never against SGST.
 *   3. SGST credit: against SGST, then IGST. Never against CGST.
 *   4. Whatever is left is paid in cash, head by head (cash of one head cannot
 *      pay another).
 *   Tax on reverse charge, interest and late fee are paid in CASH only.
 *   Cess is not modelled (the app does not track it).
 *   All arithmetic is in integer paise, so the split always sums exactly.
 */

export const HEADS = ["igst", "cgst", "sgst"] as const;
export type Head = (typeof HEADS)[number];
export type HeadAmounts = Record<Head, number>;

export interface OffsetInput {
  /** Tax on outward supplies (may be set off against ITC). Rupees. */
  liability: HeadAmounts;
  /** Tax payable under reverse charge: cash only. */
  rcmCash?: HeadAmounts;
  /** Interest: cash only. */
  interest?: HeadAmounts;
  /** Late fee: cash only. */
  lateFee?: HeadAmounts;
  /** Available credit per head (ITC ledger balance). */
  itc: HeadAmounts;
  /** Cash ledger balance per head. */
  cash: HeadAmounts;
  /** True when credit may not be used (blocked / restricted): everything goes to cash. */
  itcBlocked?: boolean;
}

export interface ItcUse {
  igstOnIgst: number;
  igstOnCgst: number;
  igstOnSgst: number;
  cgstOnCgst: number;
  cgstOnIgst: number;
  sgstOnSgst: number;
  sgstOnIgst: number;
}

export interface CashUse {
  /** Tax (incl. reverse charge) paid in cash. */
  tx: number;
  intr: number;
  fee: number;
}

export interface OffsetProposal {
  itc: ItcUse;
  cash: Record<Head, CashUse>;
  /** Cash needed per head (tx + intr + fee). */
  cashNeeded: HeadAmounts;
  /** Amount by which the cash ledger falls short, per head (zero when sufficient). */
  cashShortfall: HeadAmounts;
  sufficient: boolean;
  /** Credit left unused per head. */
  itcRemaining: HeadAmounts;
}

const toPaise = (n: number | undefined) => Math.round((n ?? 0) * 100);
const toRupees = (p: number) => p / 100;
const zeroHeads = (): HeadAmounts => ({ igst: 0, cgst: 0, sgst: 0 });

function paiseHeads(h: HeadAmounts | undefined): HeadAmounts {
  return { igst: toPaise(h?.igst), cgst: toPaise(h?.cgst), sgst: toPaise(h?.sgst) };
}

export function proposeOffset(input: OffsetInput): OffsetProposal {
  const liab = paiseHeads(input.liability);
  const credit = input.itcBlocked ? zeroHeads() : paiseHeads(input.itc);
  const itcStart = paiseHeads(input.itc);
  const used: Record<string, number> = {
    igstOnIgst: 0, igstOnCgst: 0, igstOnSgst: 0, cgstOnCgst: 0, cgstOnIgst: 0, sgstOnSgst: 0, sgstOnIgst: 0,
  };

  /** Use up to `credit[from]` against `liab[to]`. */
  const apply = (from: Head, to: Head, key: string) => {
    const amt = Math.max(0, Math.min(credit[from], liab[to]));
    credit[from] -= amt;
    liab[to] -= amt;
    used[key] = (used[key] ?? 0) + amt;
  };

  apply("igst", "igst", "igstOnIgst");
  apply("igst", "cgst", "igstOnCgst");
  apply("igst", "sgst", "igstOnSgst");
  apply("cgst", "cgst", "cgstOnCgst");
  apply("cgst", "igst", "cgstOnIgst");
  apply("sgst", "sgst", "sgstOnSgst");
  apply("sgst", "igst", "sgstOnIgst");

  const rcm = paiseHeads(input.rcmCash);
  const intr = paiseHeads(input.interest);
  const fee = paiseHeads(input.lateFee);
  const cashBal = paiseHeads(input.cash);

  const cash = {} as Record<Head, CashUse>;
  const cashNeeded = zeroHeads();
  const shortfall = zeroHeads();
  for (const h of HEADS) {
    const tx = liab[h] + rcm[h];
    cash[h] = { tx: toRupees(tx), intr: toRupees(intr[h]), fee: toRupees(fee[h]) };
    const need = tx + intr[h] + fee[h];
    cashNeeded[h] = toRupees(need);
    shortfall[h] = toRupees(Math.max(0, need - cashBal[h]));
  }
  const itcRemaining = zeroHeads();
  for (const h of HEADS) itcRemaining[h] = toRupees(input.itcBlocked ? itcStart[h] : credit[h]);

  return {
    itc: Object.fromEntries(Object.entries(used).map(([k, v]) => [k, toRupees(v)])) as unknown as ItcUse,
    cash,
    cashNeeded,
    cashShortfall: shortfall,
    sufficient: HEADS.every((h) => shortfall[h] === 0),
    itcRemaining,
  };
}

/**
 * The offset-liability request body from a confirmed proposal. Field names are
 * the GSTN offset JSON as we know it (VERIFY with Sandbox: the recipe elides
 * the inner shape of pdcash / pditc). `liab_ldg_id` / `trans_typ` come from the
 * liability ledger and are only included when the ledger response gave them.
 */
export function offsetBody(
  p: OffsetProposal,
  ids?: { liab_ldg_id?: string | number; trans_typ?: string | number },
): { pdcash: unknown[]; pditc: Record<string, unknown> } {
  const idFields = {
    ...(ids?.liab_ldg_id !== undefined ? { liab_ldg_id: ids.liab_ldg_id } : {}),
    ...(ids?.trans_typ !== undefined ? { trans_typ: ids.trans_typ } : {}),
  };
  return {
    pdcash: [
      {
        ...idFields,
        ipd: p.cash.igst,
        cpd: p.cash.cgst,
        spd: p.cash.sgst,
      },
    ],
    pditc: {
      ...idFields,
      i_pdi: p.itc.igstOnIgst,
      i_pdc: p.itc.igstOnCgst,
      i_pds: p.itc.igstOnSgst,
      c_pdi: p.itc.cgstOnIgst,
      c_pdc: p.itc.cgstOnCgst,
      s_pdi: p.itc.sgstOnIgst,
      s_pds: p.itc.sgstOnSgst,
      cs_pdcs: 0,
    },
  };
}

/** Stable fingerprint so a confirmation applies to exactly the proposal the user saw. */
export function proposalKey(p: OffsetProposal): string {
  return JSON.stringify([p.itc, p.cash]);
}

// ── Ledger response (shape VERIFY) ───────────────────────────

export interface LedgerBalances {
  itc: HeadAmounts;
  cash: HeadAmounts;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** First number found under any of `keys` of `o` (object form `{ tot }` / `{ bal }` accepted). */
function pick(o: unknown, keys: string[]): number | null {
  if (!o || typeof o !== "object") return null;
  const rec = o as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    const direct = num(v);
    if (direct !== null) return direct;
    if (v && typeof v === "object") {
      const inner = v as Record<string, unknown>;
      const n = num(inner.tot) ?? num(inner.bal) ?? num(inner.total);
      if (n !== null) return n;
    }
  }
  return null;
}

/**
 * Read cash and ITC balances out of the ledger response. The response shape is
 * not documented to us (VERIFY), so this accepts the GSTN-style names
 * (`cash_bal` / `itc_bal` with `igst_bal` / `igst_tot_bal` / `igst`) and returns
 * null instead of guessing when nothing matches, so a wrong balance never
 * reaches a payment decision.
 */
export function parseLedgerBalances(data: unknown): LedgerBalances | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const root = (d.data && typeof d.data === "object" ? d.data : d) as Record<string, unknown>;
  const itcRoot = root.itc_bal ?? root.itc ?? root.itc_ledger;
  const cashRoot = root.cash_bal ?? root.cash ?? root.cash_ledger;
  const read = (r: unknown): HeadAmounts | null => {
    const out = {} as HeadAmounts;
    for (const h of HEADS) {
      const v = pick(r, [`${h}_bal`, `${h}_tot_bal`, h]);
      if (v === null) return null;
      out[h] = v;
    }
    return out;
  };
  const itc = read(itcRoot);
  const cash = read(cashRoot);
  return itc && cash ? { itc, cash } : null;
}
