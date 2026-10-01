/**
 * Sales/purchase documents (invoices table holds every document type) and
 * what hangs off them: lines, recurring templates, shipments, store orders,
 * e-invoice and e-way bill records.
 */

import type { TableCoverage } from "../types.js";
import {
  GST_RATES,
  MONEY_TOLERANCE,
  QTY_TOLERANCE,
  lineTaxable,
  rule,
  stockDirection,
  userEntered,
  gstStateCodeSql,
  intraStateSql,
} from "../sql-fragments.js";

const INVOICE_WRITERS = [
  "invoice.create / invoice.update (Sales|Purchases → Invoice form, POS)",
  "<docType>.create via createDocumentRouter (Quotations, Orders, Challans, GRNs, Returns, Notes)",
  "document.convert (Convert to …)",
  "recurring-invoice-generator",
];
const PAYMENT_WRITERS = ["payment.create / payment.update / payment.delete (Payments)"];

/** @fintranzact/shared freeQuantityDocumentTypes. */
const FREE_QTY_DOC_TYPES = "('invoice', 'quotation', 'proforma', 'delivery_challan', 'sales_return', 'purchase_return', 'purchase_order', 'sales_order', 'goods_receipt_note')";

/** Sum of what live payments allocated to each invoice (plus legacy single-invoice payments with no allocation rows). */
const PAID_BY_INVOICE = `(
  SELECT invoice_id, SUM(amount) AS paid FROM (
    SELECT pa.invoice_id, pa.amount::numeric AS amount
    FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
    WHERE p.deleted_at IS NULL
    UNION ALL
    SELECT p.invoice_id, p.amount::numeric
    FROM payments p
    WHERE p.deleted_at IS NULL AND p.invoice_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.payment_id = p.id)
  ) x GROUP BY invoice_id
)`;

/** Live credit notes / returns issued against each document. */
const ADJUSTED_BY_INVOICE = `(
  SELECT reference_document_id AS invoice_id, SUM(total_amount::numeric) AS adjusted
  FROM invoices
  WHERE document_type IN ('credit_note', 'sales_return', 'purchase_return')
    AND status <> 'cancelled' AND deleted_at IS NULL AND reference_document_id IS NOT NULL
  GROUP BY reference_document_id
)`;

export const documentTables: TableCoverage[] = [
  {
    table: "invoices",
    rules: [
      rule("invoices", "has-lines", "error",
        "Every document has at least one line (createInvoiceSchema: lineItems.min(1)).",
        INVOICE_WRITERS,
        `SELECT i.business_id, i.id::text, i.document_type || ' ' || i.invoice_number || ' has no lines'
         FROM invoices i WHERE NOT EXISTS (SELECT 1 FROM invoice_items li WHERE li.invoice_id = i.id)`),
      rule("invoices", "subtotal-and-tax-match-lines", "error",
        "calcInvoiceTotals: subtotal = Σ line values after line discounts (before the document discount); the document discount is spread over the lines (their saved taxable values fall short of the line values by exactly discount_amount — or not at all on documents saved before discounts were spread); tax_amount = Σ line tax + tax on the charges at the highest line rate (0 on documents saved before charges were taxed).",
        INVOICE_WRITERS.concat("shipment.create / update (charge sync)"),
        `WITH l AS (
           SELECT li.invoice_id,
                  SUM(${lineTaxable("li")}) AS gross,
                  SUM(li.total_amount::numeric - li.tax_amount::numeric) AS taxable,
                  SUM(li.tax_amount::numeric) AS tax,
                  MAX(li.tax_percent::numeric) AS max_rate,
                  COUNT(*) AS n
           FROM invoice_items li GROUP BY li.invoice_id
         )
         SELECT i.business_id, i.id::text,
                i.invoice_number || ': subtotal ' || i.subtotal || ' vs lines ' || l.gross ||
                ', discount spread ' || (l.gross - l.taxable) || ' of ' || i.discount_amount ||
                ', tax ' || i.tax_amount || ' vs lines ' || l.tax || ' + charges ' || ROUND(i.additional_charges::numeric * l.max_rate / 100, 2)
         FROM invoices i JOIN l ON l.invoice_id = i.id
         WHERE ABS(i.subtotal::numeric - l.gross) > ${MONEY_TOLERANCE}
            OR (ABS((l.gross - l.taxable) - i.discount_amount::numeric) > ${MONEY_TOLERANCE}
                AND ABS(l.gross - l.taxable) > ${MONEY_TOLERANCE})
            OR (ABS(i.tax_amount::numeric - l.tax) > ${MONEY_TOLERANCE}
                AND ABS(i.tax_amount::numeric - l.tax - ROUND(i.additional_charges::numeric * l.max_rate / 100, 2)) > ${MONEY_TOLERANCE})`),
      rule("invoices", "total-formula", "error",
        "total_amount = subtotal + tax_amount − discount_amount + additional_charges + round_off + tcs_amount (TCS collected with a sale).",
        INVOICE_WRITERS,
        `SELECT i.business_id, i.id::text,
                i.invoice_number || ': total ' || i.total_amount || ' vs ' ||
                (i.subtotal::numeric + i.tax_amount::numeric - i.discount_amount::numeric + i.additional_charges::numeric + i.round_off::numeric + i.tcs_amount::numeric)
         FROM invoices i
         WHERE ABS(i.total_amount::numeric - (i.subtotal::numeric + i.tax_amount::numeric - i.discount_amount::numeric
                   + i.additional_charges::numeric + i.round_off::numeric + i.tcs_amount::numeric)) > ${MONEY_TOLERANCE}`),
      rule("invoices", "charges-sum", "error",
        "When itemised charges are stored, additional_charges is their sum.",
        INVOICE_WRITERS.concat("shipment.create / shipment.update (charge sync)"),
        `SELECT i.business_id, i.id::text, i.invoice_number || ': additional_charges ' || i.additional_charges || ' vs charges ' || c.s
         FROM invoices i
         JOIN LATERAL (SELECT COALESCE(SUM((e->>'amount')::numeric), 0) AS s FROM jsonb_array_elements(i.charges) e) c ON TRUE
         WHERE jsonb_typeof(i.charges) = 'array' AND ABS(i.additional_charges::numeric - c.s) > ${MONEY_TOLERANCE}`),
      rule("invoices", "discount-within-subtotal", "error",
        "The document-level discount is not negative and not more than the subtotal.",
        INVOICE_WRITERS,
        `SELECT i.business_id, i.id::text, i.invoice_number || ': discount ' || i.discount_amount || ' on subtotal ' || i.subtotal
         FROM invoices i WHERE i.discount_amount::numeric < 0 OR i.discount_amount::numeric > i.subtotal::numeric + ${MONEY_TOLERANCE}`),
      rule("invoices", "amount-paid-matches-allocations", "error",
        "amount_paid equals what live payments allocated to the document.",
        PAYMENT_WRITERS,
        `SELECT i.business_id, i.id::text, i.invoice_number || ': amount_paid ' || i.amount_paid || ' vs allocations ' || COALESCE(p.paid, 0)
         FROM invoices i LEFT JOIN ${PAID_BY_INVOICE} p ON p.invoice_id = i.id
         WHERE ABS(i.amount_paid::numeric - COALESCE(p.paid, 0)) > ${MONEY_TOLERANCE}`),
      rule("invoices", "not-overpaid", "error",
        "amount_paid never exceeds total_amount (payment.create refuses an allocation above the balance; invoice.update must not shrink a total below what was paid).",
        PAYMENT_WRITERS.concat("invoice.update"),
        `SELECT i.business_id, i.id::text, i.invoice_number || ': paid ' || i.amount_paid || ' of ' || i.total_amount
         FROM invoices i WHERE i.deleted_at IS NULL AND i.amount_paid::numeric > i.total_amount::numeric + ${MONEY_TOLERANCE}`),
      rule("invoices", "payment-status", "error",
        "A live invoice's stored status is what lib/invoice-status.ts works out from its payments and live credit notes/returns: adjusted when the notes alone cover it, paid when payments + notes do, partial when something is paid, otherwise open (sent / overdue / unfulfilled). A draft is promoted once a payment lands.",
        PAYMENT_WRITERS.concat("invoice.update", "creditNote|salesReturn|purchaseReturn.* (recomputeReferencedInvoice)", "shipment.create / update (charge changes the total)"),
        `WITH s AS (
           SELECT i.*, COALESCE(a.adjusted, 0) AS adj,
                  CASE WHEN COALESCE(a.adjusted, 0) > 0 AND COALESCE(a.adjusted, 0) >= i.total_amount::numeric - ${MONEY_TOLERANCE} THEN 'adjusted'
                       WHEN i.amount_paid::numeric + COALESCE(a.adjusted, 0) > 0
                            AND i.amount_paid::numeric + COALESCE(a.adjusted, 0) >= i.total_amount::numeric - ${MONEY_TOLERANCE} THEN 'paid'
                       WHEN i.amount_paid::numeric > 0 THEN 'partial'
                       ELSE 'open' END AS expected,
                  CASE WHEN i.status IN ('sent', 'overdue', 'unfulfilled') THEN 'open' ELSE i.status::text END AS stored
           FROM invoices i LEFT JOIN ${ADJUSTED_BY_INVOICE} a ON a.invoice_id = i.id
           WHERE i.document_type = 'invoice' AND i.deleted_at IS NULL AND i.status <> 'cancelled' AND i.total_amount::numeric > 0
         )
         SELECT s.business_id, s.id::text, s.invoice_number || ': status ' || s.status || ', expected ' || s.expected ||
                ' (paid ' || s.amount_paid || ', notes ' || s.adj || ' of ' || s.total_amount || ')'
         FROM s
         WHERE (s.status = 'draft' AND s.amount_paid::numeric > 0)
            OR (s.status <> 'draft' AND s.stored <> s.expected
                -- marked paid/partial by hand with nothing recorded: see paid-without-payment
                AND NOT (s.stored IN ('paid', 'partial') AND s.amount_paid::numeric = 0 AND s.adj = 0))`),
      rule("invoices", "paid-without-payment", "warning",
        "An invoice marked paid/partial has a recorded payment or note. invoice.updateStatus allows marking it by hand (documented: it records no payment), but then receivables, cash and the party ledger still show it unpaid.",
        ["invoice.updateStatus (API — the web records a payment instead)"],
        `SELECT i.business_id, i.id::text, i.invoice_number || ': status ' || i.status || ' with nothing paid of ' || i.total_amount
         FROM invoices i LEFT JOIN ${ADJUSTED_BY_INVOICE} a ON a.invoice_id = i.id
         WHERE i.document_type = 'invoice' AND i.deleted_at IS NULL AND i.total_amount::numeric > 0
           AND i.amount_paid::numeric = 0 AND COALESCE(a.adjusted, 0) = 0 AND i.status IN ('paid', 'partial')`),
      rule("invoices", "adjusted-status-backed", "error",
        "A document stored as 'adjusted' is fully covered by live credit notes / returns (the status must be undone when one of them is cancelled or deleted).",
        ["creditNote|salesReturn|purchaseReturn.create / updateStatus / delete (createDocumentRouter)"],
        `SELECT i.business_id, i.id::text, i.invoice_number || ': adjusted but only ' || COALESCE(a.adjusted, 0) || ' of ' || i.total_amount || ' is covered'
         FROM invoices i LEFT JOIN ${ADJUSTED_BY_INVOICE} a ON a.invoice_id = i.id
         WHERE i.status = 'adjusted' AND i.deleted_at IS NULL
           AND COALESCE(a.adjusted, 0) < i.total_amount::numeric - ${MONEY_TOLERANCE}`),
      rule("invoices", "adjustments-within-total", "error",
        "Live credit notes / sales returns / purchase returns against an invoice never add up to more than its total (returns of goods rejected on a GRN are bounded by the rejected quantity instead).",
        ["creditNote|salesReturn|purchaseReturn.create (createDocumentRouter)", "document.convert"],
        `SELECT i.business_id, i.id::text, i.invoice_number || ': adjusted ' || a.adjusted || ' of ' || i.total_amount
         FROM invoices i JOIN ${ADJUSTED_BY_INVOICE} a ON a.invoice_id = i.id
         WHERE i.document_type = 'invoice' AND a.adjusted > i.total_amount::numeric + ${MONEY_TOLERANCE}`),
      rule("invoices", "reference-consistent", "error",
        "reference_document_id (no FK) names a document of the same business and the same party; a credit note / return points at an invoice of its own side (sale or purchase) — a purchase return may instead point at the GRN whose rejected goods it sends back.",
        ["document.convert", "creditNote|salesReturn|purchaseReturn.create"],
        `SELECT i.business_id, i.id::text, i.invoice_number || ' → ' ||
                CASE WHEN r.id IS NULL THEN 'missing document ' || i.reference_document_id
                     WHEN r.business_id <> i.business_id THEN 'document of another business'
                     WHEN r.party_id <> i.party_id THEN 'document of another party'
                     ELSE r.document_type || ' (' || r.type || ')' END
         FROM invoices i LEFT JOIN invoices r ON r.id = i.reference_document_id
         WHERE i.reference_document_id IS NOT NULL
           AND (r.id IS NULL OR r.business_id <> i.business_id OR r.party_id <> i.party_id
                OR (i.document_type IN ('credit_note', 'sales_return', 'purchase_return')
                    AND r.type <> i.type)
                OR (i.document_type IN ('credit_note', 'sales_return') AND r.document_type <> 'invoice')
                -- a purchase return also returns goods rejected on a GRN (document.convert fromRejected)
                OR (i.document_type = 'purchase_return' AND r.document_type NOT IN ('invoice', 'goods_receipt_note')))`),
      rule("invoices", "document-side", "error",
        "Fixed-side documents carry their side: sales order / sales return → sale; purchase order / GRN / purchase return → purchase.",
        INVOICE_WRITERS,
        `SELECT i.business_id, i.id::text, i.document_type || ' stored as ' || i.type
         FROM invoices i
         WHERE (i.document_type IN ('sales_order', 'sales_return') AND i.type <> 'sale')
            OR (i.document_type IN ('purchase_order', 'goods_receipt_note', 'purchase_return') AND i.type <> 'purchase')`),
      rule("invoices", "party-same-business", "error",
        "The party (and saved warehouse) of a document belong to the document's business.",
        INVOICE_WRITERS,
        `SELECT i.business_id, i.id::text, i.invoice_number || ': party business ' || p.business_id || COALESCE(', warehouse business ' || w.business_id, '')
         FROM invoices i JOIN parties p ON p.id = i.party_id LEFT JOIN warehouses w ON w.id = i.warehouse_id
         WHERE p.business_id <> i.business_id OR w.business_id <> i.business_id`),
      rule("invoices", "deleted-is-cancelled", "error",
        "A soft-deleted document is also cancelled (every delete path sets both).",
        ["invoice.delete", "<docType>.delete"],
        `SELECT i.business_id, i.id::text, i.invoice_number || ' deleted with status ' || i.status
         FROM invoices i WHERE i.deleted_at IS NOT NULL AND i.status <> 'cancelled'`),
      rule("invoices", "due-after-date", "warning",
        "The due date is not before the document date.",
        INVOICE_WRITERS,
        `SELECT i.business_id, i.id::text, i.invoice_number || ': due ' || i.due_date::date || ' before ' || i.invoice_date::date
         FROM invoices i WHERE i.due_date IS NOT NULL AND i.due_date::date < i.invoice_date::date`),
      rule("invoices", "created-by-user", "error",
        "A document a person entered (source NULL or 'pos') records who created it (created_by_user_id / created_by_name).",
        INVOICE_WRITERS,
        `SELECT i.business_id, i.id::text, i.invoice_number || ' has no creator'
         FROM invoices i WHERE ${userEntered("i")} AND (i.created_by_user_id IS NULL OR NULLIF(i.created_by_name, '') IS NULL)`),
      rule("invoices", "tds-matches-payment", "error",
        "A live purchase bill's TDS (tds_amount) is settled by exactly one system TDS payment of that amount; a cancelled or deleted bill has none; no other document carries TDS; the mode is auto, none or manual and the amount is not negative.",
        ["invoice.create / update / updateStatus / delete (syncBillTds)"],
        `SELECT i.business_id, i.id::text, i.invoice_number || ': tds ' || i.tds_amount || ' (' || i.tds_mode || '), ' || COUNT(p.id) || ' TDS payments totalling ' || COALESCE(SUM(p.amount::numeric), 0)
         FROM invoices i
         LEFT JOIN payments p ON p.invoice_id = i.id AND p.source = 'tds' AND p.deleted_at IS NULL
         GROUP BY i.id
         HAVING i.tds_mode NOT IN ('auto', 'none', 'manual') OR i.tds_amount::numeric < 0
             OR COUNT(p.id) > 1
             OR ABS(COALESCE(SUM(p.amount::numeric), 0) - (CASE
                  WHEN i.type = 'purchase' AND i.document_type = 'invoice' AND i.deleted_at IS NULL AND i.status <> 'cancelled' THEN i.tds_amount::numeric
                  ELSE 0 END)) > ${MONEY_TOLERANCE}
             OR (NOT (i.type = 'purchase' AND i.document_type = 'invoice') AND i.tds_amount::numeric <> 0)`),
      rule("invoices", "tcs-matches-deductions", "error",
        "A live sale invoice's TCS (tcs_amount) is the sum of its TCS ledger rows, one per section, each kind 'tcs' and payable; a cancelled or deleted invoice, one with TCS switched off, and any other document carries none; the mode is auto or none and the amount is not negative.",
        INVOICE_WRITERS,
        `SELECT i.business_id, i.id::text, i.invoice_number || ': tcs ' || i.tcs_amount || ' (' || i.tcs_mode || ') vs ' || COUNT(d.id) || ' TCS rows totalling ' || COALESCE(SUM(d.amount::numeric), 0)
         FROM invoices i
         LEFT JOIN tax_deductions d ON d.invoice_id = i.id AND d.kind = 'tcs'
         GROUP BY i.id
         HAVING i.tcs_mode NOT IN ('auto', 'none') OR i.tcs_amount::numeric < 0
             OR ABS(COALESCE(SUM(d.amount::numeric), 0) - (CASE
                  WHEN i.type = 'sale' AND i.document_type = 'invoice' AND i.deleted_at IS NULL AND i.status <> 'cancelled' AND i.tcs_mode = 'auto' THEN i.tcs_amount::numeric
                  ELSE 0 END)) > ${MONEY_TOLERANCE}
             OR (NOT (i.type = 'sale' AND i.document_type = 'invoice') AND i.tcs_amount::numeric <> 0)
             OR bool_or(d.direction <> 'payable') OR bool_or(d.payment_id IS NOT NULL)`),
      rule("invoices", "audit-trail", "error",
        "A document a person entered has a '<docType>.create' audit entry.",
        INVOICE_WRITERS,
        `SELECT i.business_id, i.id::text, 'no create audit entry for ' || i.document_type || ' ' || i.invoice_number
         FROM invoices i
         WHERE ${userEntered("i")} AND i.created_by_user_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = i.id AND a.action LIKE '%.create')`),
      rule("invoices", "stock-mode", "error",
        "stock_mode is tracked | none | legacy, and a stock-moving document (invoice, challan, GRN, return) is only 'none' when it was billed from a delivery challan or GRN that already moved the goods.",
        ["document.convert (challan/GRN → invoice)", "invoice.create (skipStockAdjustment)"],
        `SELECT i.business_id, i.id::text, i.document_type || ' ' || i.invoice_number || ': stock_mode ' || i.stock_mode ||
                COALESCE(' referencing ' || r.document_type, ' with no source document')
         FROM invoices i LEFT JOIN invoices r ON r.id = i.reference_document_id
         WHERE i.stock_mode NOT IN ('tracked', 'none', 'legacy')
            OR (i.stock_mode = 'none' AND ${stockDirection("i")} <> 0
                AND (r.id IS NULL OR r.document_type NOT IN ('delivery_challan', 'goods_receipt_note')))`),
      rule("invoices", "stock-posted-matches-lines", "error",
        "A live tracked document's net stock movements per product and batch equal its lines — billed + free quantity (never GRN-rejected goods), in base units, × its direction; a cancelled/deleted one, a 'none' one or a non-stock type (quotation, order, note, proforma) holds nothing.",
        ["syncDocumentStock (invoice.create/update/updateStatus/delete, <docType>.create/updateStatus/delete)"],
        `WITH docs AS (
           SELECT i.id, i.business_id, i.invoice_number, i.document_type,
                  CASE WHEN i.stock_mode = 'tracked' AND i.deleted_at IS NULL AND i.status <> 'cancelled' THEN ${stockDirection("i")} ELSE 0 END AS dir,
                  CASE WHEN i.document_type = 'invoice' THEN 'INVOICE' ELSE 'DOCUMENT' END AS prefix
           FROM invoices i WHERE i.stock_mode <> 'legacy'
         ),
         desired AS (
           SELECT d.id AS doc_id, COALESCE(li.item_id, v.item_id) AS item_id, li.variant_id, li.batch_id,
                  SUM(ROUND((li.quantity::numeric + COALESCE(li.free_quantity, 0)::numeric)
                        * CASE WHEN li.variant_id IS NULL THEN COALESCE(li.conversion_factor, 1)::numeric ELSE 1 END, 3) * d.dir) AS qty
           FROM docs d JOIN invoice_items li ON li.invoice_id = d.id
           LEFT JOIN item_variants v ON v.id = li.variant_id
           JOIN items it ON it.id = COALESCE(li.item_id, v.item_id)
           WHERE d.dir <> 0 AND it.item_type = 'product'
           GROUP BY 1, 2, 3, 4
         ),
         held AS (
           SELECT d.id AS doc_id, m.item_id, m.variant_id, m.batch_id, SUM(m.quantity::numeric) AS qty
           FROM docs d JOIN stock_movements m ON m.reference_id = d.id AND m.business_id = d.business_id AND m.reference_type LIKE d.prefix || '%'
           GROUP BY 1, 2, 3, 4
         )
         SELECT d.business_id, d.id::text, d.document_type || ' ' || d.invoice_number || ': item ' || COALESCE(x.item_id::text, '?') ||
                COALESCE(' batch ' || x.batch_id, '') || ' should hold ' || COALESCE(x.want, 0) || ' but movements net ' || COALESCE(x.have, 0)
         FROM (SELECT COALESCE(ds.doc_id, h.doc_id) AS doc_id, COALESCE(ds.item_id, h.item_id) AS item_id,
                      COALESCE(ds.batch_id, h.batch_id) AS batch_id, ds.qty AS want, h.qty AS have
               FROM desired ds FULL OUTER JOIN held h
                 ON h.doc_id = ds.doc_id AND h.item_id = ds.item_id AND h.variant_id IS NOT DISTINCT FROM ds.variant_id
                AND h.batch_id IS NOT DISTINCT FROM ds.batch_id) x
         JOIN docs d ON d.id = x.doc_id
         WHERE ABS(COALESCE(x.want, 0) - COALESCE(x.have, 0)) > ${QTY_TOLERANCE}`),
      rule("invoices", "e-invoice-fields", "error",
        "E-invoice state is complete: 'generated' has IRN, ack number, ack date and signed QR; 'cancelled' has the IRN and a cancel reason; 'failed' has the error; an IRN only exists on a generated/cancelled document; e-invoicing only applies to sale invoices and credit/debit notes.",
        ["invoice.create (auto IRN)", "eInvoice.generate / cancel / retryFailed (E-Invoicing)"],
        `SELECT i.business_id, i.id::text, i.invoice_number || ': e_invoice_status ' || COALESCE(i.e_invoice_status, 'NULL') ||
                ', irn ' || CASE WHEN i.irn IS NULL THEN 'NULL' ELSE 'set' END ||
                ', ack ' || COALESCE(i.irn_ack_number, 'NULL') || '/' || COALESCE(i.irn_ack_date::text, 'NULL')
         FROM invoices i
         WHERE (i.e_invoice_status = 'generated' AND (i.irn IS NULL OR i.irn_ack_number IS NULL OR i.irn_ack_date IS NULL OR i.signed_qr_code IS NULL))
            OR (i.e_invoice_status = 'cancelled' AND (i.irn IS NULL OR i.e_invoice_cancel_reason IS NULL))
            OR (i.e_invoice_status = 'failed' AND NULLIF(i.e_invoice_error, '') IS NULL)
            OR (i.irn IS NOT NULL AND COALESCE(i.e_invoice_status, '') NOT IN ('generated', 'cancelled'))
            OR (i.e_invoice_status IS NOT NULL AND NOT (i.type = 'sale' AND i.document_type IN ('invoice', 'credit_note', 'debit_note')))
            OR (i.e_invoice_status IS NOT NULL AND i.e_invoice_status NOT IN ('pending', 'generated', 'cancelled', 'failed'))`),
      rule("invoices", "composition-intra-state", "error",
        "A composition business makes no inter-state sale (invoice.create refuses it; the rule also catches a later party change). Intra/inter-state as @fintranzact/shared isIntraStateSupply decides it.",
        ["invoice.create / invoice.update (party change)"],
        `SELECT i.business_id, i.id::text, i.invoice_number || ': business state ' || COALESCE(${gstStateCodeSql("b")}, '?') || ', party state ' || COALESCE(${gstStateCodeSql("p")}, '?')
         FROM invoices i JOIN businesses b ON b.id = i.business_id JOIN parties p ON p.id = i.party_id
         WHERE b.gst_registration_type = 'composition' AND i.type = 'sale' AND i.document_type = 'invoice'
           AND i.deleted_at IS NULL AND i.status <> 'cancelled'
           AND NOT ${intraStateSql("b", "p")}`),
      rule("invoices", "tax-only-when-registered", "warning",
        "Only a regular GST registrant charges GST on a sale: composition and unregistered businesses' sale invoices carry no tax.",
        ["invoice.create / invoice.update", "POS"],
        `SELECT i.business_id, i.id::text, i.invoice_number || ': tax ' || i.tax_amount || ' charged by a ' || b.gst_registration_type || ' business'
         FROM invoices i JOIN businesses b ON b.id = i.business_id
         WHERE b.gst_registration_type <> 'regular' AND i.type = 'sale' AND i.document_type = 'invoice'
           AND i.deleted_at IS NULL AND i.status <> 'cancelled' AND i.tax_amount::numeric > 0`),
      rule("invoices", "delivery-method-known", "error",
        "delivery_method is a built-in method (self_pickup, hand_delivery, courier, bus, transport, post) or the id of one of the business's own methods (Settings → Shipping) — the form, PDF and e-way bill resolve it by id.",
        ["invoice.create / update (resolveDeliveryMethod)", "document.convert"],
        `SELECT i.business_id, i.id::text, i.invoice_number || ': delivery_method ' || i.delivery_method
         FROM invoices i JOIN businesses b ON b.id = i.business_id
         WHERE i.delivery_method IS NOT NULL
           AND i.delivery_method NOT IN ('self_pickup', 'hand_delivery', 'courier', 'bus', 'transport', 'post')
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.custom_shipping_methods) = 'array' THEN b.custom_shipping_methods ELSE '[]'::jsonb END) m
                           WHERE m->>'id' = i.delivery_method)`),
      rule("invoices", "e-invoice-cancel-audited", "error",
        "Cancelling an IRN is in the audit log (eInvoice.cancel).",
        ["eInvoice.cancel (E-Invoicing)"],
        `SELECT i.business_id, i.id::text, i.invoice_number || ': IRN cancelled with no audit entry'
         FROM invoices i WHERE i.e_invoice_status = 'cancelled' AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = i.id AND a.action LIKE 'eInvoice.cancel')`),
    ],
  },
  {
    table: "invoice_items",
    rules: [
      rule("invoice_items", "line-math", "error",
        "A line's saved taxable value (total − tax) is its value after the line discount less its share of the document discount (never more, never negative), and tax_amount = that taxable value × tax% rounded to the paisa (calcInvoiceTotals / withAllocatedLines).",
        INVOICE_WRITERS,
        `SELECT inv.business_id, li.id::text,
                inv.invoice_number || ' line ' || li.sort_order || ': taxable ' || (li.total_amount::numeric - li.tax_amount::numeric) ||
                ' of ' || ${lineTaxable("li")} || ', tax ' || li.tax_amount || ' vs ' ||
                ROUND((li.total_amount::numeric - li.tax_amount::numeric) * li.tax_percent::numeric / 100, 2)
         FROM invoice_items li JOIN invoices inv ON inv.id = li.invoice_id
         WHERE ABS(li.tax_amount::numeric - ROUND((li.total_amount::numeric - li.tax_amount::numeric) * li.tax_percent::numeric / 100, 2)) > ${MONEY_TOLERANCE}
            OR li.total_amount::numeric - li.tax_amount::numeric > ${lineTaxable("li")} + ${MONEY_TOLERANCE}
            OR li.total_amount::numeric - li.tax_amount::numeric < -${MONEY_TOLERANCE}`),
      rule("invoice_items", "values-in-range", "error",
        "quantity > 0, unit_price ≥ 0, discount 0–100 %, tax 0–56 % (invoiceLineItemSchema).",
        INVOICE_WRITERS,
        `SELECT inv.business_id, li.id::text, inv.invoice_number || ': qty ' || li.quantity || ', price ' || li.unit_price ||
                ', disc ' || li.discount_percent || ', tax ' || li.tax_percent
         FROM invoice_items li JOIN invoices inv ON inv.id = li.invoice_id
         WHERE li.quantity::numeric <= 0 OR li.unit_price::numeric < 0
            OR li.discount_percent::numeric NOT BETWEEN 0 AND 100 OR li.tax_percent::numeric NOT BETWEEN 0 AND 56`),
      rule("invoice_items", "variant-linked-to-item", "error",
        "A line billed as a variant also names the variant's parent item (item_id) — item-level reports, HSN lookup and the e-invoice payload join on item_id.",
        INVOICE_WRITERS,
        `SELECT inv.business_id, li.id::text, inv.invoice_number || ': variant ' || li.variant_id || ' with item_id ' || COALESCE(li.item_id::text, 'NULL')
         FROM invoice_items li JOIN invoices inv ON inv.id = li.invoice_id JOIN item_variants v ON v.id = li.variant_id
         WHERE li.item_id IS DISTINCT FROM v.item_id`),
      rule("invoice_items", "item-same-business", "error",
        "A line's item belongs to the document's business.",
        INVOICE_WRITERS,
        `SELECT inv.business_id, li.id::text, inv.invoice_number || ': item of business ' || it.business_id
         FROM invoice_items li JOIN invoices inv ON inv.id = li.invoice_id JOIN items it ON it.id = li.item_id
         WHERE it.business_id <> inv.business_id`),
      rule("invoice_items", "unit-conversion", "error",
        "A variant line has conversion_factor 1; an alternate-unit line's factor is the one the item defines for that unit, and a base-unit line's is 1.",
        INVOICE_WRITERS.concat("item.switchBaseUnit"),
        `SELECT inv.business_id, li.id::text, inv.invoice_number || ': unit ' || COALESCE(li.selected_unit, it.unit::text) ||
                ' factor ' || COALESCE(li.conversion_factor::text, 'NULL') || ' expected ' || COALESCE(u.factor::text, '1')
         FROM invoice_items li JOIN invoices inv ON inv.id = li.invoice_id
         JOIN items it ON it.id = li.item_id
         LEFT JOIN LATERAL (SELECT (e->>'conversionFactor')::numeric AS factor FROM jsonb_array_elements(COALESCE(it.unit_variants, '[]'::jsonb)) e
                            WHERE lower(e->>'unit') = lower(li.selected_unit) LIMIT 1) u ON TRUE
         WHERE (li.variant_id IS NOT NULL AND COALESCE(li.conversion_factor, 1)::numeric <> 1)
            OR (li.variant_id IS NULL AND (li.selected_unit IS NULL OR lower(li.selected_unit) = lower(it.unit::text))
                AND ABS(COALESCE(li.conversion_factor, 1)::numeric - 1) > 0.0001 AND it.item_mode <> 'alt_units')
            OR (li.variant_id IS NULL AND u.factor IS NOT NULL AND lower(li.selected_unit) <> lower(it.unit::text)
                AND ABS(COALESCE(li.conversion_factor, 1)::numeric - u.factor) > 0.0001)`),
      rule("invoice_items", "gst-rate-valid", "warning",
        "A line's tax_percent is a GST rate.",
        INVOICE_WRITERS,
        `SELECT inv.business_id, li.id::text, inv.invoice_number || ': tax_percent ' || li.tax_percent
         FROM invoice_items li JOIN invoices inv ON inv.id = li.invoice_id
         WHERE inv.deleted_at IS NULL AND li.tax_percent::numeric NOT IN ${GST_RATES}`),
      rule("invoice_items", "hsn-on-taxable-sale", "warning",
        "A regular GST registrant's taxed sale line links an item with an HSN/SAC (GSTR-1 table 12 and the e-invoice need one; lines without an item or HSN go out as '0000').",
        INVOICE_WRITERS.concat("item.create / item.update"),
        `SELECT inv.business_id, li.id::text, inv.invoice_number || ': "' || li.item_name || '" has ' ||
                CASE WHEN it.id IS NULL THEN 'no item' ELSE 'no HSN' END
         FROM invoice_items li JOIN invoices inv ON inv.id = li.invoice_id JOIN businesses b ON b.id = inv.business_id
         LEFT JOIN items it ON it.id = li.item_id
         WHERE b.gst_registration_type = 'regular' AND inv.type = 'sale' AND inv.document_type = 'invoice'
           AND inv.deleted_at IS NULL AND inv.status <> 'cancelled' AND li.tax_percent::numeric > 0
           AND (it.id IS NULL OR NULLIF(it.hsn, '') IS NULL)`),
      rule("invoice_items", "free-quantity-allowed", "error",
        "Free goods (10 + 1 schemes) are not negative and only appear on documents that can carry them (freeQuantityDocumentTypes — not credit/debit notes).",
        INVOICE_WRITERS,
        `SELECT inv.business_id, li.id::text, inv.document_type || ' ' || inv.invoice_number || ': free_quantity ' || li.free_quantity
         FROM invoice_items li JOIN invoices inv ON inv.id = li.invoice_id
         WHERE li.free_quantity::numeric < 0
            OR (li.free_quantity::numeric > 0 AND inv.document_type NOT IN ${FREE_QTY_DOC_TYPES})`),
      rule("invoice_items", "rejection-on-grn-with-reason", "error",
        "Rejected quantities are only recorded on a goods receipt note, never negative, always with a reason; a line with nothing rejected carries no reason.",
        ["goodsReceiptNote.create / document.convert (PO → GRN)"],
        `SELECT inv.business_id, li.id::text, inv.document_type || ' ' || inv.invoice_number || ': rejected ' || li.rejected_quantity ||
                ', reason ' || COALESCE(li.rejection_reason, 'NULL')
         FROM invoice_items li JOIN invoices inv ON inv.id = li.invoice_id
         WHERE li.rejected_quantity::numeric < 0
            OR (li.rejected_quantity::numeric > 0 AND (inv.document_type <> 'goods_receipt_note' OR NULLIF(trim(li.rejection_reason), '') IS NULL))
            OR (li.rejected_quantity::numeric = 0 AND li.rejection_reason IS NOT NULL)`),
      rule("invoice_items", "batch-of-item", "error",
        "A line's batch is a batch of the line's own item (and variant) in the document's business.",
        INVOICE_WRITERS.concat("resolveLineBatches (lib/batches.ts)"),
        `SELECT inv.business_id, li.id::text, inv.invoice_number || ' "' || li.item_name || '": batch ' || b.batch_number || ' is of item ' || b.item_id
         FROM invoice_items li JOIN invoices inv ON inv.id = li.invoice_id JOIN item_batches b ON b.id = li.batch_id
         WHERE b.business_id <> inv.business_id OR b.item_id IS DISTINCT FROM li.item_id
            OR b.variant_id IS DISTINCT FROM li.variant_id`),
      rule("invoice_items", "batch-on-inward-line", "error",
        "A user-entered, live, stock-moving inward line (purchase, GRN, inward challan, sales return) of an item that tracks batches names the batch its goods came in as — resolveLineBatches refuses one without. (A line saved before the item started tracking batches would show here too.)",
        INVOICE_WRITERS.concat("resolveLineBatches (lib/batches.ts)"),
        `SELECT inv.business_id, li.id::text, inv.document_type || ' ' || inv.invoice_number || ' "' || li.item_name || '" has no batch'
         FROM invoice_items li JOIN invoices inv ON inv.id = li.invoice_id
         JOIN items it ON it.id = li.item_id
         WHERE it.track_batches AND it.item_type = 'product' AND li.batch_id IS NULL
           AND inv.stock_mode = 'tracked' AND inv.deleted_at IS NULL AND inv.status <> 'cancelled'
           AND ${stockDirection("inv")} = 1
           AND li.quantity::numeric + COALESCE(li.free_quantity, 0)::numeric > 0
           AND ${userEntered("inv")}`),
    ],
  },
  {
    table: "recurring_invoice_templates",
    rules: [
      rule("recurring_invoice_templates", "lines-complete", "error",
        "A template has at least one line, and every line has a name, a positive quantity and a price.",
        ["recurringInvoice.create / update (Automated Invoices)"],
        `SELECT t.business_id, t.id::text, t.name || ': ' || COALESCE(jsonb_array_length(t.line_items), 0) || ' lines, bad line ' || COALESCE(e::text, '')
         FROM recurring_invoice_templates t
         LEFT JOIN LATERAL (SELECT e FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.line_items) = 'array' THEN t.line_items ELSE '[]'::jsonb END) e
                            WHERE NULLIF(e->>'itemName', '') IS NULL OR COALESCE((e->>'quantity')::numeric, 0) <= 0
                               OR NULLIF(e->>'unitPrice', '') IS NULL LIMIT 1) bad ON TRUE
         WHERE jsonb_typeof(t.line_items) <> 'array' OR jsonb_array_length(t.line_items) = 0 OR bad.e IS NOT NULL`),
      rule("recurring_invoice_templates", "schedule-consistent", "error",
        "custom frequency has a positive interval; end_date is not before start_date; next_run_date is not before start_date; the party belongs to the business.",
        ["recurringInvoice.create / update / resume", "recurring-invoice-scheduler"],
        `SELECT t.business_id, t.id::text, t.name || ': ' || t.frequency || '/' || COALESCE(t.custom_interval_days::text, '-') ||
                ', start ' || t.start_date::date || ', end ' || COALESCE(t.end_date::date::text, '-') || ', next ' || t.next_run_date::date
         FROM recurring_invoice_templates t JOIN parties p ON p.id = t.party_id
         WHERE (t.frequency = 'custom' AND COALESCE(t.custom_interval_days, 0) <= 0)
            OR (t.end_date IS NOT NULL AND t.end_date < t.start_date)
            OR t.next_run_date::date < t.start_date::date
            OR p.business_id <> t.business_id`),
      rule("recurring_invoice_templates", "run-count", "error",
        "total_runs equals the number of successful runs recorded, and never exceeds max_runs.",
        ["recurring-invoice-generator / scheduler", "recurringInvoice.runNow"],
        `SELECT t.business_id, t.id::text, t.name || ': total_runs ' || t.total_runs || ' vs ' || COUNT(r.id) || ' successful runs' || COALESCE(', max ' || t.max_runs, '')
         FROM recurring_invoice_templates t
         LEFT JOIN recurring_invoice_runs r ON r.template_id = t.id AND r.status = 'success'
         GROUP BY t.id
         HAVING t.total_runs <> COUNT(r.id) OR (t.max_runs IS NOT NULL AND t.total_runs > t.max_runs)`),
    ],
  },
  {
    table: "recurring_invoice_runs",
    rules: [
      rule("recurring_invoice_runs", "outcome-recorded", "error",
        "A successful run links the invoice it made (and that invoice was made from the template's party); a failed run says why; the run's business is its template's.",
        ["recurring-invoice-generator", "recurring-invoice-scheduler"],
        `SELECT r.business_id, r.id::text, r.status || ': invoice ' || COALESCE(r.invoice_id::text, 'NULL') || ', error ' || COALESCE(r.error_message, 'NULL')
         FROM recurring_invoice_runs r JOIN recurring_invoice_templates t ON t.id = r.template_id
         LEFT JOIN invoices i ON i.id = r.invoice_id
         WHERE t.business_id <> r.business_id
            OR (r.status = 'failed' AND NULLIF(r.error_message, '') IS NULL)
            OR (r.status = 'success' AND i.id IS NOT NULL AND i.party_id <> t.party_id)
            OR (r.status <> 'success' AND r.invoice_id IS NOT NULL)`),
    ],
  },
  {
    table: "shipments",
    rules: [
      rule("shipments", "links-consistent", "error",
        "A shipment's invoice and party belong to its business, and the party is the invoice's party.",
        ["shipment.create / update (Shipments)", "invoice.create (shipping charge auto-shipment)"],
        `SELECT s.business_id, s.id::text, 'invoice party ' || COALESCE(i.party_id::text, '-') || ', shipment party ' || COALESCE(s.party_id::text, 'NULL')
         FROM shipments s LEFT JOIN invoices i ON i.id = s.invoice_id LEFT JOIN parties p ON p.id = s.party_id
         WHERE i.business_id <> s.business_id OR p.business_id <> s.business_id
            OR (i.id IS NOT NULL AND s.party_id IS DISTINCT FROM i.party_id)`),
      rule("shipments", "charge-linked", "error",
        "A shipment's cost is on its invoice: a sale invoice charge tagged with the shipment id carries the same amount, and every tagged charge points at an existing shipment.",
        ["invoice.create (shipping charge)", "shipment.create / update / delete"],
        `SELECT s.business_id, s.id::text, 'cost ' || s.cost || ' vs invoice charge ' || (e->>'amount')
         FROM shipments s JOIN invoices i ON i.id = s.invoice_id
         CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(i.charges) = 'array' THEN i.charges ELSE '[]'::jsonb END) e
         WHERE e->>'shipmentId' = s.id::text AND ABS((e->>'amount')::numeric - s.cost::numeric) > ${MONEY_TOLERANCE}
         UNION ALL
         SELECT i.business_id, i.id::text, 'charge tagged with missing shipment ' || (e->>'shipmentId')
         FROM invoices i
         CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(i.charges) = 'array' THEN i.charges ELSE '[]'::jsonb END) e
         WHERE e ? 'shipmentId' AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.id::text = e->>'shipmentId')`),
      rule("shipments", "status-dates", "warning",
        "A shipped/in-transit/delivered shipment has a shipment date, a delivered one an actual delivery date.",
        ["shipment.update (Shipments)", "carrier webhook (server.ts)"],
        `SELECT s.business_id, s.id::text, s.status || ': shipped ' || COALESCE(s.shipment_date::text, 'NULL') || ', delivered ' || COALESCE(s.actual_delivery::text, 'NULL')
         FROM shipments s
         WHERE (s.status IN ('shipped', 'in_transit', 'delivered') AND s.shipment_date IS NULL)
            OR (s.status = 'delivered' AND s.actual_delivery IS NULL)`),
    ],
  },
  {
    table: "shipment_events",
    rules: [],
    noExtraRequirements:
      "Append-only carrier/manual timeline: shipment_id is a cascading FK and status/event_time are NOT NULL; detail, location and carrier status are whatever the carrier sent.",
  },
  {
    table: "store_orders",
    rules: [
      rule("store_orders", "invoice-consistent", "error",
        "A store order's invoice is in its business, and total_amount / item_count mirror that invoice (total, number of lines).",
        ["public store checkout (server.ts /store/:slug/order)"],
        `SELECT o.business_id, o.id::text, o.order_number || ': total ' || o.total_amount || ' vs invoice ' || i.total_amount ||
                ', items ' || o.item_count || ' vs ' || (SELECT COUNT(*) FROM invoice_items li WHERE li.invoice_id = i.id)
         FROM store_orders o JOIN invoices i ON i.id = o.invoice_id
         WHERE i.business_id <> o.business_id
            OR ABS(o.total_amount::numeric - i.total_amount::numeric) > ${MONEY_TOLERANCE}
            OR o.item_count <> (SELECT COUNT(*) FROM invoice_items li WHERE li.invoice_id = i.id)`),
      rule("store_orders", "lifecycle-dates", "error",
        "A confirmed (or later) order has confirmed_at; a cancelled one has cancelled_at.",
        ["store.confirmOrder / cancelOrder / updateOrderStatus (Store Orders)"],
        `SELECT o.business_id, o.id::text, o.order_number || ' ' || o.status || ': confirmed ' || COALESCE(o.confirmed_at::text, 'NULL') ||
                ', cancelled ' || COALESCE(o.cancelled_at::text, 'NULL')
         FROM store_orders o
         WHERE (o.status IN ('confirmed', 'preparing', 'ready', 'delivered') AND o.confirmed_at IS NULL)
            OR (o.status = 'cancelled' AND o.cancelled_at IS NULL)`),
    ],
  },
  {
    table: "e_invoice_configs",
    rules: [
      rule("e_invoice_configs", "gstin-is-business", "error",
        "The IRP login is for the business's own GSTIN, and an enabled config has credentials.",
        ["business.create / update (compliance credentials)", "eInvoice.configure (E-Invoicing → Settings)"],
        `SELECT c.business_id, c.id::text, 'config gstin ' || c.gstin || ' vs business ' || COALESCE(b.gstin, 'NULL')
         FROM e_invoice_configs c JOIN businesses b ON b.id = c.business_id
         WHERE c.gstin IS DISTINCT FROM b.gstin OR (c.is_enabled AND (NULLIF(c.username, '') IS NULL OR NULLIF(c.password, '') IS NULL))`),
    ],
  },
  {
    table: "eway_bill_configs",
    rules: [
      rule("eway_bill_configs", "gstin-is-business", "error",
        "The EWB login is for the business's own GSTIN, and an enabled config has credentials.",
        ["business.create / update (compliance credentials)"],
        `SELECT c.business_id, c.id::text, 'config gstin ' || c.gstin || ' vs business ' || COALESCE(b.gstin, 'NULL')
         FROM eway_bill_configs c JOIN businesses b ON b.id = c.business_id
         WHERE c.gstin IS DISTINCT FROM b.gstin OR (c.is_enabled AND (NULLIF(c.username, '') IS NULL OR NULLIF(c.password, '') IS NULL))`),
    ],
  },
  {
    table: "eway_bills",
    rules: [
      rule("eway_bills", "generated-fields", "error",
        "A generated/active e-way bill has its EWB number, date, validity and vehicle; a cancelled one has a reason; it belongs to a sale invoice of its business.",
        ["ewayBill.generate / cancel / updateVehicle / extend (E-Way Bills)"],
        `SELECT e.business_id, e.id::text, e.status || ': ewb ' || COALESCE(e.ewb_number, 'NULL') || ', valid ' || COALESCE(e.valid_upto::text, 'NULL') ||
                COALESCE(', invoice ' || i.document_type || '/' || i.type, '')
         FROM eway_bills e LEFT JOIN invoices i ON i.id = e.invoice_id
         WHERE (e.status IN ('generated', 'active') AND (e.ewb_number IS NULL OR e.ewb_date IS NULL OR e.valid_upto IS NULL
                                                        OR (NULLIF(e.vehicle_number, '') IS NULL AND NULLIF(e.transporter_id, '') IS NULL)))
            OR (e.status = 'cancelled' AND NULLIF(e.cancel_reason, '') IS NULL)
            OR (i.id IS NOT NULL AND (i.business_id <> e.business_id))`),
      rule("eway_bills", "states-recorded", "warning",
        "From/to state codes are recorded (they come from the business and party state codes).",
        ["ewayBill.generate"],
        `SELECT e.business_id, e.id::text, 'from ' || COALESCE(e.from_state, 'NULL') || ' to ' || COALESCE(e.to_state, 'NULL')
         FROM eway_bills e WHERE e.status <> 'cancelled' AND (NULLIF(e.from_state, '') IS NULL OR NULLIF(e.to_state, '') IS NULL)`),
      rule("eway_bills", "audit-trail", "error",
        "An e-way bill has an ewayBill.generate audit entry, and a cancelled one an ewayBill.cancel entry.",
        ["ewayBill.generate / cancel (E-Way Bills)"],
        `SELECT e.business_id, e.id::text, COALESCE(e.ewb_number, 'EWB') || ' (' || e.status || ') is missing its audit entry'
         FROM eway_bills e
         WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = e.id AND a.action LIKE 'ewayBill.generate')
            OR (e.status = 'cancelled' AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = e.id AND a.action LIKE 'ewayBill.cancel'))`),
    ],
  },
  {
    table: "eway_bill_vehicle_updates",
    rules: [],
    noExtraRequirements:
      "History rows written by ewayBill.updateVehicle: eway_bill_id is a cascading FK and vehicle_number is NOT NULL; from_place/reason are optional in the NIC API.",
  },
];
