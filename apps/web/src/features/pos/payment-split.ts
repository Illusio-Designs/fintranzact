/**
 * How a POS sale's payment is taken: one tender (cash, UPI or card) or split
 * across several. Pure so the paise arithmetic can be unit-tested.
 */

export type Tender = "cash" | "upi" | "card";

/** The payment mode each tender is recorded with. */
export const TENDER_MODE = {
  cash: "cash",
  upi: "upi",
  // A swiped / tapped card at the counter (the payments list shows "Credit Card").
  card: "credit_card",
} as const;

export const TENDER_LABEL: Record<Tender, string> = { cash: "Cash", upi: "UPI", card: "Card" };

export const TENDERS: Tender[] = ["cash", "upi", "card"];

/** "12.5" → 1250 paise; blank or invalid → 0. */
export function toPaise(value: string | number): number {
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

export function fromPaise(paise: number): string {
  return (paise / 100).toFixed(2);
}

/** What is still to be taken: total − what the split's parts add up to (negative = too much). */
export function splitRemainder(parts: Partial<Record<Tender, string>>, total: number): number {
  const entered = TENDERS.reduce((sum, t) => sum + toPaise(parts[t] ?? ""), 0);
  return toPaise(total) - entered;
}

/**
 * The payments to record once the server has worked out the invoice total.
 * The cashier's split was entered against the register's own total; if the
 * server's (rounded per line) total differs by a few paise, the last tender
 * takes the difference so the invoice is paid exactly.
 */
export function paymentsForSplit(
  parts: Partial<Record<Tender, string>>,
  invoiceTotal: string,
): Array<{ tender: Tender; amount: string }> {
  const used = TENDERS.filter((t) => toPaise(parts[t] ?? "") > 0);
  if (used.length === 0) return [];
  const total = toPaise(invoiceTotal);
  const out: Array<{ tender: Tender; amount: string }> = [];
  let taken = 0;
  used.forEach((t, i) => {
    const paise = i === used.length - 1 ? total - taken : Math.min(toPaise(parts[t] ?? ""), total - taken);
    taken += paise;
    if (paise > 0) out.push({ tender: t, amount: fromPaise(paise) });
  });
  return out;
}
