/** How each payment mode the API stores reads in lists and reports. */
const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  bank: "Bank",
  upi: "UPI",
  cheque: "Cheque",
  other: "Other",
  credit_card: "Credit Card",
  debit_card: "Debit Card",
  net_banking: "Net Banking",
  wallet: "Wallet",
};

export function paymentModeLabel(mode: string | null | undefined): string {
  if (!mode) return "—";
  return PAYMENT_MODE_LABELS[mode] ?? mode.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
