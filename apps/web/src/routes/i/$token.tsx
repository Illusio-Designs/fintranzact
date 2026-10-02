/**
 * Public view of one shared document (invoice, quotation, …). No sign-in:
 * whoever holds the link can read the document, pay by UPI and download the
 * PDF. Rendered outside the app shell for signed-in and signed-out visitors.
 */
import { BootSplash } from "@/components/ui/BootSplash";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download04Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { apiUrl } from "@/lib/api-url";
import { formatCurrency, formatDate, getDocumentTypeLabel } from "@/lib/utils";
import { Icon } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";

export const Route = createFileRoute("/i/$token")({
  component: SharedDocumentPage,
});

interface SharedDocument {
  document: {
    documentType: string;
    number: string;
    date: string;
    dueDate: string | null;
    status: string;
    subtotal: string;
    taxAmount: string;
    discountAmount: string | null;
    additionalCharges: string | null;
    /** TCS (s.206C) collected with the sale, included in totalAmount. */
    tcsAmount?: string | null;
    roundOff: string | null;
    totalAmount: string;
    amountPaid: string;
    amountAdjusted: string;
    balance: string;
    notes: string | null;
    terms: string | null;
  };
  business: {
    name: string;
    legalName: string | null;
    gstin: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    hasLogo: boolean;
  };
  party: { name: string; gstin: string | null; address: string | null };
  lineItems: Array<{
    name: string;
    description: string | null;
    hsn: string | null;
    quantity: string;
    /** Free goods on top of the billed quantity ("10 + 1"). */
    freeQuantity?: string | null;
    unit: string | null;
    unitPrice: string;
    discountPercent: string | null;
    taxPercent: string | null;
    totalAmount: string;
  }>;
  payment: { upiId: string; payUrl: string | null; qrDataUrl: string } | null;
  bank: { accountName: string | null; accountNumber: string; ifsc: string | null; bankName: string | null } | null;
  poweredBy: boolean;
}

type LoadState = { kind: "loading" } | { kind: "gone" } | { kind: "error" } | { kind: "ready"; data: SharedDocument };

/** Documents a customer is asked to pay; the rest only show their total. */
const PAYABLE = new Set(["invoice", "proforma", "debit_note"]);

function SharedDocumentPage() {
  const { token } = Route.useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl(`/api/share/${encodeURIComponent(token)}`), { credentials: "omit" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) return setState({ kind: "gone" });
        if (!res.ok) return setState({ kind: "error" });
        setState({ kind: "ready", data: (await res.json()) as SharedDocument });
      })
      .catch(() => !cancelled && setState({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (state.kind !== "ready") return;
    const { document: doc, business } = state.data;
    window.document.title = `${getDocumentTypeLabel(doc.documentType)} ${doc.number} · ${business.name}`;
  }, [state]);

  if (state.kind === "loading") {
    return <BootSplash className="bg-surface-1" />;
  }

  if (state.kind !== "ready") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-surface-1">
        <div className="w-full max-w-[400px] rounded-2xl p-8 shadow-elevated bg-surface-0 border border-border-light text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center">
            <Icon icon={Cancel01Icon} size={22} className="text-red-600 dark:text-red-400" />
          </div>
          <h1 className="text-lg font-semibold text-text-primary mb-2">
            {state.kind === "gone" ? "This link is not valid any more" : "Could not open this document"}
          </h1>
          <p className="text-sm text-text-tertiary">
            {state.kind === "gone"
              ? "Ask the business that sent it for a new link."
              : "Check your connection and try again."}
          </p>
        </div>
      </div>
    );
  }

  return <SharedDocumentView token={token} data={state.data} />;
}

function SharedDocumentView({ token, data }: { token: string; data: SharedDocument }) {
  const { document: doc, business, party, lineItems, payment, bank } = data;
  const label = getDocumentTypeLabel(doc.documentType);
  const balance = parseFloat(doc.balance);
  const payable = PAYABLE.has(doc.documentType) && doc.status !== "cancelled";
  const due = payable && balance > 0.004;
  const pdfUrl = (format: "a4" | "a5") => apiUrl(`/api/share/${encodeURIComponent(token)}/pdf?format=${format}`);

  const totals: Array<[string, string | null]> = [
    ["Subtotal", doc.subtotal],
    ["Discount", doc.discountAmount && parseFloat(doc.discountAmount) ? `-${doc.discountAmount}` : null],
    ["Tax", doc.taxAmount],
    ["Other charges", doc.additionalCharges && parseFloat(doc.additionalCharges) ? doc.additionalCharges : null],
    ["TCS (s.206C)", doc.tcsAmount && parseFloat(doc.tcsAmount) ? doc.tcsAmount : null],
    ["Round off", doc.roundOff && parseFloat(doc.roundOff) ? doc.roundOff : null],
  ];

  return (
    <div className="min-h-screen bg-surface-1 py-6 sm:py-10 px-4">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {/* Header: business and amount */}
        <section className="rounded-2xl bg-surface-0 border border-border-light shadow-elevated p-5 sm:p-7">
          <div className="flex items-start gap-4">
            {business.hasLogo && (
              <img
                src={apiUrl(`/api/share/${encodeURIComponent(token)}/logo`)}
                alt=""
                className="w-14 h-14 rounded-lg object-contain border border-border-light bg-white shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold text-text-primary truncate">{business.name}</h1>
              {business.address && <p className="text-sm text-text-tertiary">{business.address}</p>}
              <p className="text-xs text-text-tertiary mt-0.5">
                {[business.gstin && `GSTIN ${business.gstin}`, business.phone, business.email].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">{label}</p>
              <p className="text-base font-semibold text-text-primary">{doc.number}</p>
              <p className="text-sm text-text-secondary">
                {formatDate(doc.date)}
                {doc.dueDate && payable && <> · Due {formatDate(doc.dueDate)}</>}
              </p>
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
                {due ? "Amount due" : payable && doc.status !== "cancelled" ? "Paid" : "Total"}
              </p>
              <p className="text-2xl font-semibold text-text-primary tabular-nums" data-testid="share-amount">
                {formatCurrency(due ? doc.balance : doc.totalAmount)}
              </p>
              {doc.status === "cancelled" && <p className="text-sm font-medium text-red-600">Cancelled</p>}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {due && payment?.payUrl && (
              <a href={payment.payUrl} className="btn-primary px-4 py-2 sm:hidden">
                Pay with UPI
              </a>
            )}
            <a href={pdfUrl("a4")} className="btn-secondary px-4 py-2 inline-flex items-center gap-2" download>
              <Icon icon={Download04Icon} size={16} />
              Download PDF
            </a>
          </div>
        </section>

        {/* UPI QR for paying from another phone */}
        {due && payment && (
          <section className="rounded-2xl bg-surface-0 border border-border-light p-5 flex items-center gap-5">
            <img src={payment.qrDataUrl} alt="UPI QR code" className="w-28 h-28 shrink-0 rounded-lg bg-white p-1" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary">Scan to pay with any UPI app</p>
              <p className="text-sm text-text-secondary break-all">{payment.upiId}</p>
              <p className="text-xs text-text-tertiary mt-1">Amount {formatCurrency(doc.balance)}</p>
            </div>
          </section>
        )}

        {/* Bill to + items */}
        <section className="rounded-2xl bg-surface-0 border border-border-light p-5 sm:p-7">
          <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">Bill to</p>
          <p className="text-sm font-semibold text-text-primary">{party.name}</p>
          {party.address && <p className="text-sm text-text-tertiary">{party.address}</p>}
          {party.gstin && <p className="text-xs text-text-tertiary">GSTIN {party.gstin}</p>}

          {/* Phones: one row per item */}
          <ul className="mt-5 sm:hidden divide-y divide-border-light border-y border-border-light">
            {lineItems.map((li, i) => (
              <li key={i} className="py-2.5 flex justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="text-text-primary">{li.name}</p>
                  <p className="text-xs text-text-tertiary">
                    {parseFloat(li.quantity)} {li.unit ?? ""} × {formatCurrency(li.unitPrice)}
                    {li.freeQuantity ? ` + ${parseFloat(li.freeQuantity)} free` : ""}
                    {li.taxPercent && parseFloat(li.taxPercent) ? ` · ${parseFloat(li.taxPercent)}% tax` : ""}
                  </p>
                </div>
                <p className="shrink-0 tabular-nums text-text-primary">{formatCurrency(li.totalAmount)}</p>
              </li>
            ))}
          </ul>

          <div className="mt-5 hidden sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-tertiary border-b border-border-light">
                  <th className="py-2 pr-2 font-medium">Item</th>
                  <th className="py-2 px-2 font-medium text-right">Qty</th>
                  <th className="py-2 px-2 font-medium text-right">Rate</th>
                  <th className="py-2 px-2 font-medium text-right">Tax</th>
                  <th className="py-2 pl-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li, i) => (
                  <tr key={i} className="border-b border-border-light last:border-0 align-top">
                    <td className="py-2.5 pr-2">
                      <p className="text-text-primary">{li.name}</p>
                      {(li.description || li.hsn) && (
                        <p className="text-xs text-text-tertiary">
                          {[li.description, li.hsn && `HSN ${li.hsn}`].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-text-secondary">
                      {parseFloat(li.quantity)} {li.unit ?? ""}
                      {li.freeQuantity && (
                        <span className="block text-xs text-emerald-700 dark:text-emerald-400">+ {parseFloat(li.freeQuantity)} free</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-text-secondary">{formatCurrency(li.unitPrice)}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-text-secondary">
                      {li.taxPercent ? `${parseFloat(li.taxPercent)}%` : "—"}
                    </td>
                    <td className="py-2.5 pl-2 text-right tabular-nums text-text-primary">
                      {formatCurrency(li.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="mt-4 ml-auto w-full sm:w-72 space-y-1 text-sm">
            {totals
              .filter((row): row is [string, string] => row[1] !== null)
              .map(([name, value]) => (
                <div key={name} className="flex justify-between text-text-secondary">
                  <dt>{name}</dt>
                  <dd className="tabular-nums">{formatCurrency(value)}</dd>
                </div>
              ))}
            <div className="flex justify-between pt-2 border-t border-border-light font-semibold text-text-primary">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatCurrency(doc.totalAmount)}</dd>
            </div>
            {payable && (parseFloat(doc.amountPaid) > 0 || parseFloat(doc.amountAdjusted) > 0) && (
              <>
                {parseFloat(doc.amountAdjusted) > 0 && (
                  <div className="flex justify-between text-text-secondary">
                    <dt>Credited</dt>
                    <dd className="tabular-nums">-{formatCurrency(doc.amountAdjusted)}</dd>
                  </div>
                )}
                {parseFloat(doc.amountPaid) > 0 && (
                  <div className="flex justify-between text-text-secondary">
                    <dt>Paid</dt>
                    <dd className="tabular-nums">{formatCurrency(doc.amountPaid)}</dd>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-text-primary">
                  <dt>Balance</dt>
                  <dd className="tabular-nums">{formatCurrency(doc.balance)}</dd>
                </div>
              </>
            )}
          </dl>
        </section>

        {(bank || doc.notes || doc.terms) && (
          <section className="rounded-2xl bg-surface-0 border border-border-light p-5 sm:p-7 space-y-4 text-sm">
            {bank && due && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary mb-1">Bank transfer</p>
                {bank.accountName && <p className="text-text-primary">{bank.accountName}</p>}
                <p className="text-text-secondary">
                  A/c {bank.accountNumber}
                  {bank.ifsc && <> · IFSC {bank.ifsc}</>}
                  {bank.bankName && <> · {bank.bankName}</>}
                </p>
              </div>
            )}
            {doc.notes && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary mb-1">Notes</p>
                <p className="text-text-secondary whitespace-pre-line">{doc.notes}</p>
              </div>
            )}
            {doc.terms && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary mb-1">Terms</p>
                <p className="text-text-secondary whitespace-pre-line">{doc.terms}</p>
              </div>
            )}
          </section>
        )}

        {data.poweredBy && (
          <a
            href="/"
            className="flex items-center justify-center gap-2 py-3 text-xs text-text-tertiary hover:text-text-secondary"
          >
            <Logo className="w-4 h-4" />
            Made with Fintranzact
          </a>
        )}
      </div>
    </div>
  );
}
