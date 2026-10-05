/**
 * Money: payments and their allocations, expenses, bank/cash accounts and
 * their transactions, bank reconciliation, the ledger (chart of accounts and
 * journals), ITC and GSTR-2B.
 */

import type { TableCoverage } from "../types.js";
import { tdsSectionCodes } from "@fintranzact/shared";
import { MONEY_TOLERANCE, intraStateSql, rule, userEntered } from "../sql-fragments.js";

const PAYMENT_WRITERS = ["payment.create / payment.update / payment.delete (Payments, POS)", "payment.assignAccount (untracked payments)"];
const EXPENSE_WRITERS = ["expense.create / expense.update / expense.delete (Expenses)", "bankRecon.createExpense", "gateway charge (payment.create)"];

/**
 * Which way a payment moves its bank/cash account. A payment settling a
 * purchase invoice, or made to a supplier on account, is money out; anything
 * else received from a customer is money in. Mirrors the ledger
 * (derive-ledger.ts: payments to suppliers are Dr Payable / Cr Bank).
 */
const PAYMENT_DIRECTION = `(CASE
  WHEN pi.type = 'purchase' THEN 'withdrawal'
  WHEN pi.type = 'sale' THEN 'deposit'
  WHEN pp.type = 'supplier' THEN 'withdrawal'
  ELSE 'deposit' END)`;

export const moneyTables: TableCoverage[] = [
  {
    table: "payments",
    rules: [
      rule("payments", "numbered-and-attributed", "error",
        "A payment someone recorded has a payment number and records who recorded it.",
        PAYMENT_WRITERS,
        `SELECT p.business_id, p.id::text, 'number ' || COALESCE(p.payment_number, 'NULL') || ', by ' || COALESCE(p.created_by_name, 'NULL')
         FROM payments p WHERE ${userEntered("p")} AND (NULLIF(p.payment_number, '') IS NULL OR p.created_by_user_id IS NULL)`),
      rule("payments", "primary-invoice", "error",
        "payments.invoice_id (the list view's single invoice) is one of the invoices the payment is allocated to, and is empty for an on-account payment.",
        PAYMENT_WRITERS,
        `SELECT p.business_id, p.id::text, COALESCE(p.payment_number, '') || ': invoice_id ' || COALESCE(p.invoice_id::text, 'NULL') ||
                ' with ' || (SELECT COUNT(*) FROM payment_allocations pa WHERE pa.payment_id = p.id) || ' allocations'
         FROM payments p
         WHERE p.deleted_at IS NULL AND p.source IS NULL
           AND ((p.invoice_id IS NULL AND EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.payment_id = p.id))
             OR (p.invoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.payment_id = p.id AND pa.invoice_id = p.invoice_id)))`),
      rule("payments", "tds-consistent", "error",
        "Tax withheld from a payment is never negative and is below the payment, names its section, and is recorded as exactly one tax_deductions row of the same amount, party, section, direction and period; a payment with no tax withheld has none.",
        PAYMENT_WRITERS,
        `SELECT p.business_id, p.id::text, COALESCE(p.payment_number, '') || ': tds ' || p.tds_amount || ' of ' || p.amount ||
                ', section ' || COALESCE(p.tds_section, 'NULL') || ', ' || COUNT(d.id) || ' deduction rows' ||
                COALESCE(' (' || string_agg(d.direction || ' ' || d.amount || ' ' || d.section_code, '; ') || ')', '')
         FROM payments p JOIN parties pp ON pp.id = p.party_id
         LEFT JOIN invoices pi ON pi.id = p.invoice_id
         LEFT JOIN tax_deductions d ON d.payment_id = p.id
         GROUP BY p.id, pp.type, pi.type
         HAVING p.tds_amount::numeric < 0
             OR (p.tds_amount::numeric > 0 AND (p.tds_amount::numeric >= p.amount::numeric OR p.tds_section IS NULL))
             OR (p.deleted_at IS NOT NULL AND COUNT(d.id) > 0)
             OR (p.deleted_at IS NULL AND p.tds_amount::numeric > 0 AND (
                   COUNT(d.id) <> 1
                   OR bool_or(ABS(d.amount::numeric - p.tds_amount::numeric) > ${MONEY_TOLERANCE})
                   OR bool_or(d.party_id <> p.party_id)
                   OR bool_or(d.section_code IS DISTINCT FROM p.tds_section)
                   OR bool_or(d.deducted_on <> p.payment_date)
                   OR bool_or(d.direction <> (CASE WHEN ${PAYMENT_DIRECTION} = 'withdrawal' THEN 'payable' ELSE 'receivable' END))))
             OR (p.deleted_at IS NULL AND p.tds_amount::numeric = 0 AND COUNT(d.id) > 0 AND p.source IS DISTINCT FROM 'tds')`),
      rule("payments", "bill-tds-adjustment", "error",
        "The system payment that settles a purchase bill's TDS (source 'tds') is for a live (not cancelled or deleted) purchase bill of the same party, moves no money (no bank account, no tax of its own), is allocated wholly to that bill, and is exactly one payable tax_deductions row for the same bill and amount.",
        ["invoice.create / update / updateStatus / delete (syncBillTds)"],
        `SELECT p.business_id, p.id::text, COALESCE(p.payment_number, '') || ': ' || p.amount || ' on ' || COALESCE(i.invoice_number, 'no bill') ||
                ', ' || COUNT(DISTINCT pa.id) || ' allocations, ' || COUNT(DISTINCT d.id) || ' deductions'
         FROM payments p
         LEFT JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
         LEFT JOIN tax_deductions d ON d.payment_id = p.id
         WHERE p.source = 'tds'
         GROUP BY p.id, i.id
         HAVING p.bank_account_id IS NOT NULL OR p.tds_amount::numeric <> 0
             OR i.id IS NULL OR i.type <> 'purchase' OR i.document_type <> 'invoice' OR i.party_id <> p.party_id
             OR (p.deleted_at IS NULL AND (
                   i.deleted_at IS NOT NULL OR i.status = 'cancelled'
                   OR COUNT(DISTINCT pa.id) <> 1 OR bool_or(pa.invoice_id <> p.invoice_id) OR bool_or(ABS(pa.amount::numeric - p.amount::numeric) > ${MONEY_TOLERANCE})
                   OR COUNT(DISTINCT d.id) <> 1 OR bool_or(d.direction <> 'payable') OR bool_or(d.invoice_id IS DISTINCT FROM p.invoice_id)
                   OR bool_or(ABS(d.amount::numeric - p.amount::numeric) > ${MONEY_TOLERANCE})))`),
      rule("payments", "allocations-within-amount", "error",
        "What a payment allocates to invoices adds up to no more than the payment.",
        PAYMENT_WRITERS,
        `SELECT p.business_id, p.id::text, COALESCE(p.payment_number, '') || ': amount ' || p.amount || ', allocated ' || SUM(pa.amount::numeric)
         FROM payments p JOIN payment_allocations pa ON pa.payment_id = p.id
         GROUP BY p.id HAVING SUM(pa.amount::numeric) > p.amount::numeric + ${MONEY_TOLERANCE}`),
      rule("payments", "deleted-releases-allocations", "error",
        "A deleted payment no longer holds allocations (payment.delete removes them and reverses amount_paid).",
        PAYMENT_WRITERS,
        `SELECT p.business_id, p.id::text, COALESCE(p.payment_number, '') || ' deleted but still allocated'
         FROM payments p WHERE p.deleted_at IS NOT NULL AND EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.payment_id = p.id)`),
      rule("payments", "bank-posting", "error",
        "A live payment with a bank/cash account has exactly one 'payment' bank transaction on that account, for the amount less any TDS withheld, on the same date, in the right direction (money in from customers / sale invoices, money out to suppliers / purchase invoices); a deleted or untracked payment has none.",
        PAYMENT_WRITERS,
        `SELECT p.business_id, p.id::text, COALESCE(p.payment_number, '') || ' (' || pp.type || COALESCE(', ' || pi.type || ' invoice', ', on account') || '): ' ||
                COUNT(t.id) || ' txns, expected ' || CASE WHEN p.deleted_at IS NULL AND p.bank_account_id IS NOT NULL THEN '1 ' || ${PAYMENT_DIRECTION} ELSE 'none' END ||
                COALESCE(', found ' || string_agg(t.type::text || ' ' || t.amount || ' on ' || t.bank_account_id, '; '), '')
         FROM payments p JOIN parties pp ON pp.id = p.party_id
         LEFT JOIN invoices pi ON pi.id = p.invoice_id
         LEFT JOIN bank_transactions t ON t.reference_type = 'payment' AND t.reference_id = p.id
         GROUP BY p.id, pp.type, pi.type
         HAVING (p.deleted_at IS NOT NULL OR p.bank_account_id IS NULL) AND COUNT(t.id) > 0
             OR (p.deleted_at IS NULL AND p.bank_account_id IS NOT NULL AND (
                   COUNT(t.id) <> 1
                   OR bool_or(t.bank_account_id <> p.bank_account_id)
                   OR bool_or(ABS(t.amount::numeric - (p.amount::numeric - p.tds_amount::numeric)) > ${MONEY_TOLERANCE})
                   OR bool_or(t.type::text <> ${PAYMENT_DIRECTION})
                   OR bool_or(t.transaction_date <> p.payment_date)))`),
      rule("payments", "mode-matches-account", "warning",
        "The payment mode fits the account it was posted to: cash into a cash account, and nothing but cash into a cash account.",
        PAYMENT_WRITERS,
        `SELECT p.business_id, p.id::text, COALESCE(p.payment_number, '') || ': mode ' || p.mode || ' into ' || a.account_type || ' account ' || a.account_name
         FROM payments p JOIN bank_accounts a ON a.id = p.bank_account_id
         WHERE p.deleted_at IS NULL AND ((p.mode = 'cash') <> (a.account_type = 'cash'))`),
      rule("payments", "same-business", "error",
        "The payment's party and bank account belong to its business.",
        PAYMENT_WRITERS,
        `SELECT p.business_id, p.id::text, 'party business ' || pp.business_id || COALESCE(', account business ' || a.business_id, '')
         FROM payments p JOIN parties pp ON pp.id = p.party_id LEFT JOIN bank_accounts a ON a.id = p.bank_account_id
         WHERE pp.business_id <> p.business_id OR a.business_id <> p.business_id
            OR (p.bank_account_id IS NOT NULL AND a.id IS NULL)`),
      rule("payments", "audit-trail", "error",
        "A payment someone recorded has a payment.create audit entry.",
        PAYMENT_WRITERS,
        `SELECT p.business_id, p.id::text, 'no payment.create audit entry for ' || COALESCE(p.payment_number, p.id::text)
         FROM payments p
         WHERE ${userEntered("p")} AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = p.id AND a.action = 'payment.create')`),
    ],
  },
  {
    table: "payment_allocations",
    rules: [
      rule("payment_allocations", "same-party-and-business", "error",
        "A payment is only allocated to invoices of its own business and its own party.",
        PAYMENT_WRITERS,
        `SELECT p.business_id, pa.id::text, COALESCE(p.payment_number, '') || ' → ' || i.invoice_number ||
                CASE WHEN i.business_id <> p.business_id THEN ' (another business)' ELSE ' (party ' || i.party_id || ' not ' || p.party_id || ')' END
         FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id JOIN invoices i ON i.id = pa.invoice_id
         WHERE i.business_id <> p.business_id OR i.party_id <> p.party_id`),
      rule("payment_allocations", "positive", "error",
        "An allocation is a positive amount.",
        PAYMENT_WRITERS,
        `SELECT p.business_id, pa.id::text, 'amount ' || pa.amount
         FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE pa.amount::numeric <= 0`),
      rule("payment_allocations", "live-invoice", "warning",
        "A live payment is allocated to live invoices (Payments → Unpaid invoices only offers invoices): not a quotation/order/note, and not one later cancelled or deleted while the money stayed on it.",
        PAYMENT_WRITERS.concat("invoice.delete / invoice.updateStatus (cancel)"),
        `SELECT p.business_id, pa.id::text, COALESCE(p.payment_number, '') || ' → ' || i.document_type || ' ' || i.invoice_number || ' (' || i.status || ')'
         FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id JOIN invoices i ON i.id = pa.invoice_id
         WHERE p.deleted_at IS NULL AND (i.document_type <> 'invoice' OR i.status = 'cancelled' OR i.deleted_at IS NOT NULL)`),
    ],
  },
  {
    table: "expenses",
    rules: [
      rule("expenses", "bank-posting", "error",
        "A live expense has at most one withdrawal for its amount (less any TDS deducted) and date (referenced as 'expense', or 'gateway_charge' for a gateway's fee); when the expense is pinned to an account the withdrawal is on that account; a deleted expense has none.",
        EXPENSE_WRITERS,
        `SELECT e.business_id, e.id::text, e.category || ' ' || e.amount || ': ' || COUNT(t.id) || ' txns' ||
                COALESCE(' [' || string_agg(t.type::text || ' ' || t.amount || ' on ' || t.bank_account_id, '; ') || ']', '')
         FROM expenses e LEFT JOIN bank_transactions t ON t.reference_type IN ('expense', 'gateway_charge') AND t.reference_id = e.id
         GROUP BY e.id
         HAVING (e.deleted_at IS NOT NULL AND COUNT(t.id) > 0)
             OR (e.deleted_at IS NULL AND (COUNT(t.id) > 1
                   OR (e.bank_account_id IS NOT NULL AND COUNT(t.id) = 0)
                   OR bool_or(t.bank_account_id <> e.bank_account_id)
                   OR bool_or(t.type <> 'withdrawal')
                   OR bool_or(ABS(t.amount::numeric - (e.amount::numeric - e.tds_amount::numeric)) > ${MONEY_TOLERANCE})
                   OR bool_or(t.transaction_date <> e.expense_date)))`),
      rule("expenses", "tds-consistent", "error",
        "TDS on an expense: the mode is none, auto or manual; the tax is never negative and is below the expense; a live expense with tax has a payee of its business, a section, and exactly one payable tax_deductions row for the same amount, payee, section and date; an expense with no tax (or a deleted one) has no deduction row.",
        EXPENSE_WRITERS,
        `SELECT e.business_id, e.id::text, e.category || ' ' || e.amount || ': tds ' || e.tds_amount || ' (' || e.tds_mode || '), section ' || COALESCE(e.tds_section, 'NULL') ||
                ', ' || COUNT(d.id) || ' deduction rows'
         FROM expenses e LEFT JOIN tax_deductions d ON d.expense_id = e.id
         GROUP BY e.id
         HAVING e.tds_mode NOT IN ('none', 'auto', 'manual') OR e.tds_amount::numeric < 0
             OR (e.tds_amount::numeric > 0 AND (e.tds_amount::numeric >= e.amount::numeric OR e.tds_section IS NULL OR e.party_id IS NULL))
             OR (e.tds_mode = 'none' AND e.tds_amount::numeric <> 0)
             OR (e.deleted_at IS NOT NULL AND COUNT(d.id) > 0)
             OR (e.deleted_at IS NULL AND e.tds_amount::numeric = 0 AND COUNT(d.id) > 0)
             OR (e.deleted_at IS NULL AND e.tds_amount::numeric > 0 AND (
                   COUNT(d.id) <> 1
                   OR bool_or(ABS(d.amount::numeric - e.tds_amount::numeric) > ${MONEY_TOLERANCE})
                   OR bool_or(d.party_id IS DISTINCT FROM e.party_id)
                   OR bool_or(d.section_code IS DISTINCT FROM e.tds_section)
                   OR bool_or(d.deducted_on <> e.expense_date)
                   OR bool_or(d.direction <> 'payable')))`),
      rule("expenses", "account-same-business", "error",
        "An expense's bank account belongs to its business.",
        EXPENSE_WRITERS,
        `SELECT e.business_id, e.id::text, 'account of business ' || a.business_id
         FROM expenses e JOIN bank_accounts a ON a.id = e.bank_account_id WHERE a.business_id <> e.business_id`),
      rule("expenses", "audit-trail", "error",
        "An expense someone entered (Expenses screen, or created from a bank statement line) has an expense.create audit entry; gateway charges are system-made.",
        ["expense.create (Expenses)", "bankRecon.createExpense"],
        `SELECT e.business_id, e.id::text, 'no expense.create audit entry for ' || e.category || ' ' || e.amount
         FROM expenses e
         WHERE e.created_by_user_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = e.id AND a.action = 'expense.create')`),
    ],
  },
  {
    table: "bank_accounts",
    rules: [
      rule("bank_accounts", "balance-reconciles", "error",
        "current_balance = opening_balance + deposits − everything else (withdrawals and single 'transfer'-typed rows, which move money out) over the account's transactions — the same reading as the statement's running balance and recomputeDerived.",
        ["bankAccount.create / update (Cash & Bank)", "bankAccount.addTransaction / transfer", "payment.* / expense.* / gateway", "bankRecon.createExpense"],
        `SELECT a.business_id, a.id::text, a.account_name || ': current ' || a.current_balance || ' vs opening ' || a.opening_balance ||
                ' + postings ' || COALESCE(t.net, 0)
         FROM bank_accounts a
         LEFT JOIN (SELECT bank_account_id, SUM(CASE WHEN type = 'deposit' THEN amount::numeric ELSE -amount::numeric END) AS net
                    FROM bank_transactions GROUP BY bank_account_id) t ON t.bank_account_id = a.id
         WHERE ABS(a.current_balance::numeric - (a.opening_balance::numeric + COALESCE(t.net, 0))) > ${MONEY_TOLERANCE}`),
      rule("bank_accounts", "single-default", "error",
        "A business has at most one default account.",
        ["bankAccount.create / update"],
        `SELECT a.business_id, a.id::text, COUNT(*) OVER (PARTITION BY a.business_id) || ' default accounts'
         FROM bank_accounts a WHERE a.is_default
         AND (SELECT COUNT(*) FROM bank_accounts b WHERE b.business_id = a.business_id AND b.is_default) > 1`),
      rule("bank_accounts", "gateway-configured", "warning",
        "A payment-gateway account has its gateway config (charges and settlement account) — otherwise payments into it are never settled.",
        ["bankAccount.upsertGatewayConfig (Cash & Bank → Gateway)"],
        `SELECT a.business_id, a.id::text, a.account_name || ' has no gateway config'
         FROM bank_accounts a
         WHERE a.account_type = 'payment_gateway' AND NOT EXISTS (SELECT 1 FROM payment_gateway_configs c WHERE c.bank_account_id = a.id)`),
    ],
  },
  {
    table: "bank_transactions",
    rules: [
      rule("bank_transactions", "positive-amount", "error",
        "A transaction amount is positive; the type carries the direction.",
        ["bankAccount.addTransaction / transfer", "payment.* / expense.* / gateway"],
        `SELECT t.business_id, t.id::text, t.type || ' ' || t.amount FROM bank_transactions t WHERE t.amount::numeric <= 0`),
      rule("bank_transactions", "reference-resolves", "error",
        "A system posting points at a live source: 'payment' → a live payment, 'expense' / 'gateway_charge' → a live expense, 'gateway_settlement' → an account of the business plus the payment; the account is the business's own.",
        ["payment.* / expense.* / gateway (payment_gateway accounts)", "bankRecon.createExpense"],
        `SELECT t.business_id, t.id::text, COALESCE(t.reference_type, 'NULL') || ' → ' || COALESCE(t.reference_id::text, 'NULL') || ' does not resolve'
         FROM bank_transactions t JOIN bank_accounts a ON a.id = t.bank_account_id
         WHERE a.business_id <> t.business_id
            OR (t.reference_type = 'payment' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = t.reference_id AND p.deleted_at IS NULL AND p.business_id = t.business_id))
            OR (t.reference_type IN ('expense', 'gateway_charge') AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.id = t.reference_id AND e.deleted_at IS NULL AND e.business_id = t.business_id))
            OR (t.reference_type = 'gateway_settlement' AND (t.payment_id IS NULL
                OR NOT EXISTS (SELECT 1 FROM bank_accounts b WHERE b.id = t.reference_id AND b.business_id = t.business_id)))`),
      rule("bank_transactions", "transfer-paired", "error",
        "An account-to-account transfer is two rows: a withdrawal from one account and a deposit into the account it names, same amount and date.",
        ["bankAccount.transfer (Cash & Bank → Transfer)"],
        `SELECT t.business_id, t.id::text, t.type || ' ' || t.amount || ' with account ' || t.reference_id || ' has no matching leg'
         FROM bank_transactions t
         WHERE t.reference_type = 'transfer' AND t.reference_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM bank_transactions o
                           WHERE o.reference_type = 'transfer' AND o.bank_account_id = t.reference_id AND o.reference_id = t.bank_account_id
                             AND o.type <> t.type AND o.amount = t.amount AND o.transaction_date = t.transaction_date)`),
    ],
  },
  {
    table: "payment_gateway_configs",
    rules: [
      rule("payment_gateway_configs", "accounts-valid", "error",
        "The config sits on a payment_gateway account of its business and settles into a different, non-gateway account of the same business.",
        ["bankAccount.upsertGatewayConfig (Cash & Bank → Gateway)"],
        `SELECT c.business_id, c.id::text, 'gateway ' || g.account_type || '/' || g.business_id || ', settlement ' || s.account_type || '/' || s.business_id
         FROM payment_gateway_configs c JOIN bank_accounts g ON g.id = c.bank_account_id JOIN bank_accounts s ON s.id = c.settlement_account_id
         WHERE g.account_type <> 'payment_gateway' OR g.business_id <> c.business_id OR s.business_id <> c.business_id
            OR s.id = g.id OR s.account_type = 'payment_gateway'`),
    ],
  },
  {
    table: "razorpay_connections",
    rules: [],
    noExtraRequirements:
      "One row per business holding its own encrypted Razorpay keys and webhook token: unique per business and per token by index, secrets are NOT NULL or encrypted by the writer, nothing else to cross-check.",
  },
  {
    table: "invoice_payment_links",
    rules: [],
    noExtraRequirements:
      "A Razorpay payment link per invoice: the database allows only one active (created or partially paid) link per invoice and one row per Razorpay link id, and the invoice and business are foreign keys.",
  },
  {
    table: "razorpay_payments",
    rules: [
      rule("razorpay_payments", "matches-recorded-payment", "warning",
        "A Razorpay payment recorded against an invoice still matches the payment it created: same amount, and the Razorpay payment id as the reference. (A payment edited or deleted afterwards no longer matches; the Razorpay row is kept so a redelivered webhook never records it again.)",
        ["Razorpay webhook (payment_link.paid / partially_paid / payment.captured)"],
        `SELECT r.business_id, r.id::text, r.razorpay_payment_id || ': Razorpay ' || r.amount_paise || ' paise, payment ' || p.amount || ' ref ' || COALESCE(p.reference_number, '-')
         FROM razorpay_payments r JOIN payments p ON p.id = r.payment_id
         WHERE p.deleted_at IS NULL AND (p.amount::numeric * 100 <> r.amount_paise OR p.reference_number IS DISTINCT FROM r.razorpay_payment_id)`),
    ],
  },
  {
    table: "bank_statement_templates",
    rules: [
      rule("bank_statement_templates", "audit-trail", "error",
        "A statement template someone made (not a built-in seeded one) has a bankRecon.templateCreate / templateFork audit entry. (Otherwise templates only carry parser configuration validated by the editor.)",
        ["bankRecon.templateCreate / templateFork"],
        `SELECT t.business_id, t.id::text, t.bank_display_name || ' v' || t.version || ' has no audit entry'
         FROM bank_statement_templates t WHERE NOT t.is_seeded AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = t.id AND a.action LIKE 'bankRecon.template%')`),
    ],
  },
  {
    table: "bank_statement_imports",
    rules: [
      rule("bank_statement_imports", "counters-match-lines", "error",
        "total_lines / matched_lines / unmatched_lines count the import's lines (matched = auto/manual matched or created; unmatched = unmatched) — the import list shows these numbers.",
        ["bankRecon.uploadCSV / confirmMapping", "bankRecon.confirmMatch / manualMatch / unmatch / createExpense / ignoreLine", "expense.delete (reopenLinesMatchedTo)"],
        `SELECT i.business_id, i.id::text, i.file_name || ': total ' || i.total_lines || '/' || COALESCE(c.total, 0) ||
                ', matched ' || i.matched_lines || '/' || COALESCE(c.matched, 0) || ', unmatched ' || i.unmatched_lines || '/' || COALESCE(c.unmatched, 0)
         FROM bank_statement_imports i
         LEFT JOIN (SELECT import_id, COUNT(*) AS total,
                           COUNT(*) FILTER (WHERE match_status IN ('auto_matched', 'manual_matched', 'created')) AS matched,
                           COUNT(*) FILTER (WHERE match_status = 'unmatched') AS unmatched
                    FROM bank_statement_lines GROUP BY import_id) c ON c.import_id = i.id
         WHERE i.total_lines <> COALESCE(c.total, 0) OR i.matched_lines <> COALESCE(c.matched, 0) OR i.unmatched_lines <> COALESCE(c.unmatched, 0)`),
      rule("bank_statement_imports", "audit-trail", "error",
        "A statement upload has a bankRecon.uploadCSV audit entry.",
        ["bankRecon.uploadCSV (Bank Reconciliation)"],
        `SELECT i.business_id, i.id::text, i.file_name || ' has no audit entry'
         FROM bank_statement_imports i WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = i.id AND a.action LIKE 'bankRecon.uploadCSV')`),
    ],
  },
  {
    table: "bank_statement_lines",
    rules: [
      rule("bank_statement_lines", "match-links", "error",
        "A matched/created line names what it matched (payment, expense or bank transaction) and an unmatched/ignored line names nothing; the line's business is its import's.",
        ["bankRecon.confirmMatch / manualMatch / unmatch / createExpense / ignoreLine"],
        `SELECT l.business_id, l.id::text, 'line ' || l.line_number || ' ' || l.match_status || ': payment ' || COALESCE(l.matched_payment_id::text, '-') ||
                ', expense ' || COALESCE(l.matched_expense_id::text, '-') || ', txn ' || COALESCE(l.matched_bank_transaction_id::text, '-')
         FROM bank_statement_lines l JOIN bank_statement_imports i ON i.id = l.import_id
         WHERE i.business_id <> l.business_id
            OR (l.match_status IN ('auto_matched', 'manual_matched', 'created')
                AND COALESCE(l.matched_payment_id, l.matched_expense_id, l.matched_bank_transaction_id) IS NULL)
            OR (l.match_status IN ('unmatched', 'ignored')
                AND COALESCE(l.matched_payment_id, l.matched_expense_id, l.matched_bank_transaction_id) IS NOT NULL)`),
      rule("bank_statement_lines", "one-sided", "error",
        "A statement line is a debit or a credit, not both, and neither is negative.",
        ["bankRecon.uploadCSV / confirmMapping (statement parser)"],
        `SELECT l.business_id, l.id::text, 'line ' || l.line_number || ': debit ' || l.debit || ', credit ' || l.credit
         FROM bank_statement_lines l
         WHERE l.debit::numeric < 0 OR l.credit::numeric < 0 OR (l.debit::numeric > 0 AND l.credit::numeric > 0)`),
      rule("bank_statement_lines", "audit-trail", "error",
        "A line someone reconciled by hand (manual match, created expense, ignored) has the matching bankRecon.* audit entry.",
        ["bankRecon.manualMatch / confirmMatch / createExpense / ignoreLine"],
        `SELECT l.business_id, l.id::text, 'line ' || l.line_number || ' ' || l.match_status || ' with no audit entry'
         FROM bank_statement_lines l
         WHERE l.match_status IN ('manual_matched', 'created', 'ignored')
           AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = l.id AND a.action LIKE 'bankRecon.%')`),
    ],
  },
  {
    table: "bank_categorization_rules",
    rules: [
      rule("bank_categorization_rules", "action-complete", "error",
        "A 'create_expense' rule names the expense category; a 'tag_party' rule names a party of the business.",
        ["bankRecon.ruleCreate / ruleUpdate (Bank Reconciliation → Rules)"],
        `SELECT r.business_id, r.id::text, r.action || ': category ' || COALESCE(r.expense_category, 'NULL') || ', party ' || COALESCE(r.party_id::text, 'NULL')
         FROM bank_categorization_rules r LEFT JOIN parties p ON p.id = r.party_id
         WHERE (r.action = 'create_expense' AND NULLIF(r.expense_category, '') IS NULL)
            OR (r.action = 'tag_party' AND (p.id IS NULL OR p.business_id <> r.business_id))`),
      rule("bank_categorization_rules", "audit-trail", "error",
        "A categorisation rule has a bankRecon.ruleCreate audit entry.",
        ["bankRecon.ruleCreate"],
        `SELECT r.business_id, r.id::text, r.match_value || ' → ' || r.action || ' has no audit entry'
         FROM bank_categorization_rules r WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = r.id AND a.action LIKE 'bankRecon.ruleCreate')`),
    ],
  },
  {
    table: "chart_of_accounts",
    rules: [
      rule("chart_of_accounts", "parent-consistent", "error",
        "parent_id (no FK) names an account of the same business and the same account type.",
        ["seedChartOfAccounts (business.create)", "account.create / update (Chart of Accounts)"],
        `SELECT c.business_id, c.id::text, c.code || ' ' || c.name || ' → ' ||
                CASE WHEN p.id IS NULL THEN 'missing parent ' || c.parent_id ELSE p.code || ' (' || p.account_type || ', business ' || p.business_id || ')' END
         FROM chart_of_accounts c LEFT JOIN chart_of_accounts p ON p.id = c.parent_id
         WHERE c.parent_id IS NOT NULL AND (p.id IS NULL OR p.business_id <> c.business_id OR p.account_type <> c.account_type)`),
      rule("chart_of_accounts", "audit-trail", "error",
        "An account someone added (not seeded) has an account.create audit entry.",
        ["account.create (Chart of Accounts)"],
        `SELECT c.business_id, c.id::text, c.code || ' ' || c.name || ' has no audit entry'
         FROM chart_of_accounts c WHERE NOT c.is_system AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = c.id AND a.action LIKE 'account.create')`),
    ],
  },
  {
    table: "journal_entries",
    rules: [
      rule("journal_entries", "balanced", "error",
        "A journal entry has at least two lines and its debits equal its credits (and are not zero).",
        ["journal.create / update / createFromTemplate (Journal Entries)", "journal.void", "itc.recordUtilization"],
        `SELECT j.business_id, j.id::text, j.entry_number || ': ' || COUNT(l.id) || ' lines, Dr ' || COALESCE(SUM(l.debit::numeric), 0) ||
                ' Cr ' || COALESCE(SUM(l.credit::numeric), 0)
         FROM journal_entries j LEFT JOIN journal_entry_lines l ON l.journal_entry_id = j.id
         GROUP BY j.id
         HAVING COUNT(l.id) < 2 OR ABS(COALESCE(SUM(l.debit::numeric), 0) - COALESCE(SUM(l.credit::numeric), 0)) > ${MONEY_TOLERANCE}
             OR COALESCE(SUM(l.debit::numeric), 0) = 0`),
      rule("journal_entries", "void-linkage", "error",
        "A voided entry points at its reversal, and that reversal points back at it; a reversal's original is voided.",
        ["journal.void"],
        `SELECT j.business_id, j.id::text, j.entry_number || ': voided ' || j.is_voided || ', voided_by ' || COALESCE(j.voided_by_entry_id::text, 'NULL') ||
                ', reverses ' || COALESCE(j.reverses_entry_id::text, 'NULL')
         FROM journal_entries j
         LEFT JOIN journal_entries r ON r.id = j.voided_by_entry_id
         LEFT JOIN journal_entries o ON o.id = j.reverses_entry_id
         WHERE (j.is_voided AND (r.id IS NULL OR r.reverses_entry_id IS DISTINCT FROM j.id))
            OR (NOT j.is_voided AND j.voided_by_entry_id IS NOT NULL)
            OR (j.reverses_entry_id IS NOT NULL AND (o.id IS NULL OR NOT o.is_voided OR o.voided_by_entry_id IS DISTINCT FROM j.id))`),
      rule("journal_entries", "created-by-user", "error",
        "A manual entry records who made it.",
        ["journal.create / createFromTemplate"],
        `SELECT j.business_id, j.id::text, j.entry_number || ' has no creator'
         FROM journal_entries j WHERE j.source = 'manual' AND j.reverses_entry_id IS NULL AND j.created_by_user_id IS NULL`),
      rule("journal_entries", "audit-trail", "error",
        "Every journal entry (manual, from a template, a void's reversal or an ITC utilisation) has a journal.create audit entry, and a voided one a journal.void entry.",
        ["journal.create / createFromTemplate / void (Journal Entries)", "itc.recordUtilization"],
        `SELECT j.business_id, j.id::text, j.entry_number || ' is missing its audit entry'
         FROM journal_entries j
         WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = j.id AND a.action LIKE 'journal.create')
            OR (j.is_voided AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = j.id AND a.action LIKE 'journal.void'))`),
    ],
  },
  {
    table: "journal_entry_lines",
    rules: [
      rule("journal_entry_lines", "one-sided", "error",
        "A line is either a debit or a credit: one side positive, the other zero.",
        ["journal.create / update / createFromTemplate", "itc.recordUtilization"],
        `SELECT j.business_id, l.id::text, j.entry_number || ': Dr ' || l.debit || ' Cr ' || l.credit
         FROM journal_entry_lines l JOIN journal_entries j ON j.id = l.journal_entry_id
         WHERE l.debit::numeric < 0 OR l.credit::numeric < 0 OR (l.debit::numeric > 0) = (l.credit::numeric > 0)`),
      rule("journal_entry_lines", "account-same-business", "error",
        "A line posts to an account of the entry's business.",
        ["journal.create / update / createFromTemplate"],
        `SELECT j.business_id, l.id::text, j.entry_number || ': account of business ' || c.business_id
         FROM journal_entry_lines l JOIN journal_entries j ON j.id = l.journal_entry_id JOIN chart_of_accounts c ON c.id = l.account_id
         WHERE c.business_id <> j.business_id`),
    ],
  },
  {
    table: "journal_entry_templates",
    rules: [
      rule("journal_entry_templates", "lines-valid", "error",
        "A template has at least two lines, balances, and every line names an account of the business.",
        ["journal.templateCreate (Journal Entries → Templates)"],
        `SELECT t.business_id, t.id::text, t.name || ': ' || jsonb_array_length(t.lines) || ' lines, Dr ' || s.dr || ' Cr ' || s.cr || ', unknown accounts ' || s.bad
         FROM journal_entry_templates t
         CROSS JOIN LATERAL (
           SELECT COALESCE(SUM(NULLIF(e->>'debit', '')::numeric), 0) AS dr, COALESCE(SUM(NULLIF(e->>'credit', '')::numeric), 0) AS cr,
                  COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.id::text = e->>'accountId' AND c.business_id = t.business_id)) AS bad
           FROM jsonb_array_elements(t.lines) e) s
         WHERE jsonb_array_length(t.lines) < 2 OR ABS(s.dr - s.cr) > ${MONEY_TOLERANCE} OR s.bad > 0`),
      rule("journal_entry_templates", "audit-trail", "error",
        "A journal template has a journal.templateCreate audit entry.",
        ["journal.templateCreate"],
        `SELECT t.business_id, t.id::text, 'template ' || t.name || ' has no audit entry'
         FROM journal_entry_templates t WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = t.id AND a.action LIKE 'journal.templateCreate')`),
    ],
  },
  {
    table: "itc_ledger_entries",
    rules: [
      rule("itc_ledger_entries", "purchase-has-itc", "error",
        "Every live GST purchase invoice (tax > 0) of a non-composition business has an ITC ledger entry.",
        ["invoice.create (purchase)"],
        `SELECT i.business_id, i.id::text, i.invoice_number || ' (tax ' || i.tax_amount || ') has no ITC entry'
         FROM invoices i JOIN businesses b ON b.id = i.business_id
         WHERE i.type = 'purchase' AND i.document_type = 'invoice' AND i.deleted_at IS NULL AND i.status <> 'cancelled'
           AND i.tax_amount::numeric > 0 AND b.gst_registration_type <> 'composition'
           AND NOT EXISTS (SELECT 1 FROM itc_ledger_entries e WHERE e.invoice_id = i.id)`),
      rule("itc_ledger_entries", "reversal-has-itc", "error",
        "Every live purchase-side document that takes ITC back (goods returned to the supplier, the supplier's credit note, our debit note) with tax > 0 has its negative ITC entry, in a non-composition business.",
        ["purchaseReturn / creditNote / debitNote create (syncReversingItc)", "document.convert / returnRejected"],
        `SELECT i.business_id, i.id::text, i.invoice_number || ' (' || i.document_type || ', tax ' || i.tax_amount || ') takes no ITC back'
         FROM invoices i JOIN businesses b ON b.id = i.business_id
         WHERE i.type = 'purchase' AND i.document_type IN ('purchase_return', 'credit_note', 'debit_note')
           AND i.deleted_at IS NULL AND i.status <> 'cancelled'
           AND i.tax_amount::numeric > 0 AND b.gst_registration_type <> 'composition'
           AND NOT EXISTS (SELECT 1 FROM itc_ledger_entries e WHERE e.invoice_id = i.id)`),
      rule("itc_ledger_entries", "matches-invoice-tax", "error",
        "A live ITC entry claims exactly its purchase invoice's tax (charges' tax included) — or, for a document that takes ITC back (purchase return, supplier credit note, our debit note), exactly minus its tax — split CGST+SGST (CGST half rounded half-up, splitIntraStateTax) for an intra-state supply or IGST otherwise — isIntraStateSupply — with the document's reverse-charge flag.",
        ["invoice.create (purchase)", "invoice.update (lines/party change)", "syncReversingItc (returns and notes)"],
        `SELECT e.business_id, e.id::text, i.invoice_number || ': cgst ' || e.cgst || ' sgst ' || e.sgst || ' igst ' || e.igst ||
                ' vs tax ' || i.tax_amount || CASE WHEN i.document_type <> 'invoice' THEN ' taken back' ELSE '' END ||
                CASE WHEN ${intraStateSql("b", "p")} THEN ' (intra-state)' ELSE ' (inter-state)' END
         FROM itc_ledger_entries e JOIN invoices i ON i.id = e.invoice_id
         JOIN businesses b ON b.id = i.business_id JOIN parties p ON p.id = i.party_id
         WHERE e.status <> 'reversed' AND i.deleted_at IS NULL AND i.status <> 'cancelled'
           AND (ABS(e.cgst::numeric + e.sgst::numeric + e.igst::numeric
                    - CASE WHEN i.document_type = 'invoice' THEN i.tax_amount::numeric ELSE -i.tax_amount::numeric END) > ${MONEY_TOLERANCE}
             OR e.is_reverse_charge <> i.is_reverse_charge
             OR (${intraStateSql("b", "p")} AND (e.igst::numeric <> 0 OR ABS(e.cgst::numeric - e.sgst::numeric) > ${MONEY_TOLERANCE}))
             OR (NOT ${intraStateSql("b", "p")} AND (e.cgst::numeric <> 0 OR e.sgst::numeric <> 0)))`),
      rule("itc_ledger_entries", "invoice-is-purchase", "error",
        "ITC is only taken on a purchase invoice of the same business, and only taken back on a purchase return, the supplier's credit note or our debit note.",
        ["invoice.create (purchase)", "syncReversingItc (returns and notes)"],
        `SELECT e.business_id, e.id::text, 'linked to ' || i.type || ' ' || i.document_type || ' of business ' || i.business_id
         FROM itc_ledger_entries e JOIN invoices i ON i.id = e.invoice_id
         WHERE i.type <> 'purchase' OR i.business_id <> e.business_id
            OR i.document_type NOT IN ('invoice', 'purchase_return', 'credit_note', 'debit_note')`),
      rule("itc_ledger_entries", "reversed-when-cancelled", "error",
        "The ITC of a cancelled or deleted purchase invoice is reversed.",
        ["invoice.updateStatus (cancel) / invoice.delete"],
        `SELECT e.business_id, e.id::text, i.invoice_number || ' is cancelled but ITC is ' || e.status
         FROM itc_ledger_entries e JOIN invoices i ON i.id = e.invoice_id
         WHERE (i.deleted_at IS NOT NULL OR i.status = 'cancelled') AND e.status IN ('available', 'blocked')`),
      rule("itc_ledger_entries", "status-reasons", "error",
        "A blocked entry says why (Section 17(5) head); a reversed one says why; the return period is YYYY-MM.",
        ["itc.markBlocked / markEligible", "invoice.updateStatus / delete (reversal)"],
        `SELECT e.business_id, e.id::text, e.status || ': block ' || COALESCE(e.block_reason, 'NULL') || ', reversal ' || COALESCE(e.reversal_reason, 'NULL') || ', period ' || e.return_period
         FROM itc_ledger_entries e
         WHERE (e.status = 'blocked' AND NULLIF(e.block_reason, '') IS NULL)
            OR (e.status = 'reversed' AND NULLIF(e.reversal_reason, '') IS NULL)
            OR e.return_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
      rule("itc_ledger_entries", "period-is-invoice-month", "error",
        "The return period is the purchase invoice's month in India time (istReturnPeriod).",
        ["invoice.create (purchase)", "invoice.update (date change)"],
        `SELECT e.business_id, e.id::text, i.invoice_number || ' dated ' || i.invoice_date::date || ' in period ' || e.return_period
         FROM itc_ledger_entries e JOIN invoices i ON i.id = e.invoice_id
         WHERE e.return_period <> to_char(i.invoice_date AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')`),
      rule("itc_ledger_entries", "block-audited", "error",
        "Blocking ITC under Section 17(5) is in the audit log (itc.markBlocked).",
        ["itc.markBlocked (ITC)"],
        `SELECT e.business_id, e.id::text, 'blocked (' || COALESCE(e.block_reason, '') || ') with no audit entry'
         FROM itc_ledger_entries e WHERE e.status = 'blocked' AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = e.id AND a.action LIKE 'itc.markBlocked')`),
    ],
  },
  {
    table: "itc_utilizations",
    rules: [
      rule("itc_utilizations", "amounts-valid", "error",
        "Utilised amounts are not negative and the period is YYYY-MM.",
        ["itc.recordUtilization (ITC → Utilise)"],
        `SELECT u.business_id, u.id::text, u.return_period || ': ' || u.cgst_utilized || '/' || u.sgst_utilized || '/' ||
                u.igst_utilized_against_cgst || '/' || u.igst_utilized_against_sgst || '/' || u.igst_utilized_against_igst
         FROM itc_utilizations u
         WHERE u.return_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
            OR LEAST(u.cgst_utilized::numeric, u.sgst_utilized::numeric, u.igst_utilized_against_cgst::numeric,
                     u.igst_utilized_against_sgst::numeric, u.igst_utilized_against_igst::numeric) < 0`),
      rule("itc_utilizations", "audit-trail", "error",
        "An ITC utilisation has an itc.recordUtilization audit entry.",
        ["itc.recordUtilization"],
        `SELECT u.business_id, u.id::text, u.return_period || ' utilisation has no audit entry'
         FROM itc_utilizations u WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = u.id AND a.action LIKE 'itc.recordUtilization')`),
    ],
  },
  {
    table: "gstr2b_uploads",
    rules: [
      rule("gstr2b_uploads", "record-count", "error",
        "total_records is the number of records the upload stored.",
        ["gstr2b.upload (GSTR-2B)"],
        `SELECT u.business_id, u.id::text, u.file_name || ': total_records ' || u.total_records || ' vs ' || COUNT(r.id)
         FROM gstr2b_uploads u LEFT JOIN gstr2b_records r ON r.upload_id = u.id
         GROUP BY u.id HAVING u.total_records <> COUNT(r.id)`),
    ],
  },
  {
    table: "gstr2b_records",
    rules: [
      rule("gstr2b_records", "match-links", "error",
        "A matched/mismatched record names a purchase invoice of the same business; the record's business is its upload's.",
        ["gstr2b.upload (auto-match)", "gstr2b.linkInvoice / ignoreRecord"],
        `SELECT r.business_id, r.id::text, r.invoice_number || ' ' || r.match_status || ' → ' || COALESCE(i.type || ' ' || i.document_type || ' of ' || i.business_id, COALESCE(r.matched_invoice_id::text, 'NULL'))
         FROM gstr2b_records r JOIN gstr2b_uploads u ON u.id = r.upload_id LEFT JOIN invoices i ON i.id = r.matched_invoice_id
         WHERE u.business_id <> r.business_id
            OR (r.match_status IN ('matched', 'mismatched') AND i.id IS NULL)
            OR (i.id IS NOT NULL AND (i.business_id <> r.business_id OR i.type <> 'purchase'))`),
    ],
  },
  {
    table: "composition_settings",
    rules: [
      rule("composition_settings", "valid", "error",
        "A composition setting is for an April-March financial year (YYYY-YY, the second part the next year), a known category (manufacturer_trader, restaurant or other_service), its rate and interest rate, when set, are 0-100 percent, its late-fee amounts are not negative and its CMP-08 due day is 1-28.",
        ["gst.updateCompositionSettings (composition scheme setting)"],
        `SELECT s.business_id, s.id::text, s.financial_year || ' ' || s.category
         FROM composition_settings s
         WHERE s.financial_year !~ '^[0-9]{4}-[0-9]{2}$'
            OR (s.financial_year ~ '^[0-9]{4}-[0-9]{2}$' AND LPAD(((SUBSTRING(s.financial_year, 1, 4)::int + 1) % 100)::text, 2, '0') <> SUBSTRING(s.financial_year, 6, 2))
            OR s.category NOT IN ('manufacturer_trader', 'restaurant', 'other_service')
            OR s.rate::numeric NOT BETWEEN 0 AND 100
            OR s.interest_rate::numeric NOT BETWEEN 0 AND 100
            OR s.late_fee_per_day::numeric < 0 OR s.late_fee_cap::numeric < 0
            OR s.late_fee_nil_per_day::numeric < 0 OR s.late_fee_nil_cap::numeric < 0
            OR s.cmp08_due_day NOT BETWEEN 1 AND 28`),
      rule("composition_settings", "audit-trail", "error",
        "Every composition setting has an audit entry for the change that created or last changed it.",
        ["gst.updateCompositionSettings (composition scheme setting)"],
        `SELECT s.business_id, s.id::text, s.financial_year || ' composition setting has no audit entry'
         FROM composition_settings s WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = s.id AND a.action = 'gst.updateCompositionSettings')`),
    ],
  },
  {
    table: "tds_section_settings",
    rules: [
      rule("tds_section_settings", "valid", "error",
        "A section override is for a real section and an April-March financial year (YYYY-YY, the second part the next year), its rates are 0-100 percent and its thresholds are not negative.",
        ["tds.updateSection (TDS settings)"],
        `SELECT s.business_id, s.id::text, s.financial_year || ' ' || s.section_code
         FROM tds_section_settings s
         WHERE s.financial_year !~ '^[0-9]{4}-[0-9]{2}$'
            OR (s.financial_year ~ '^[0-9]{4}-[0-9]{2}$' AND LPAD(((SUBSTRING(s.financial_year, 1, 4)::int + 1) % 100)::text, 2, '0') <> SUBSTRING(s.financial_year, 6, 2))
            OR s.section_code NOT IN (${tdsSectionCodes.map((c) => `'${c}'`).join(", ")})
            OR s.rate::numeric NOT BETWEEN 0 AND 100 OR s.individual_rate::numeric NOT BETWEEN 0 AND 100 OR s.rate_without_pan::numeric NOT BETWEEN 0 AND 100
            OR s.single_threshold::numeric < 0 OR s.aggregate_threshold::numeric < 0`),
      rule("tds_section_settings", "audit-trail", "error",
        "Every section override has an audit entry for the change that created or last changed it.",
        ["tds.updateSection (TDS settings)"],
        `SELECT s.business_id, s.id::text, s.financial_year || ' ' || s.section_code || ' override has no audit entry'
         FROM tds_section_settings s WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = s.id AND a.action = 'tds.updateSection')`),
    ],
  },
  {
    table: "tax_challans",
    rules: [
      rule("tax_challans", "valid", "error",
        "A challan is for TDS or TCS in a quarter 1-4, has a 7-digit BSR code, a challan number and a positive amount, and is not for more than the tax it is linked to.",
        ["tds.createChallan (Challans)"],
        `SELECT c.business_id, c.id::text, c.kind || ' ' || c.financial_year || ' Q' || c.quarter || ' CIN ' || c.bsr_code || '/' || c.challan_number
         FROM tax_challans c LEFT JOIN tax_deductions d ON d.challan_id = c.id
         GROUP BY c.id
         HAVING c.kind NOT IN ('tds', 'tcs') OR c.quarter NOT BETWEEN 1 AND 4
             OR c.bsr_code !~ '^[0-9]{7}$' OR NULLIF(c.challan_number, '') IS NULL
             OR c.amount::numeric <= 0 OR c.interest::numeric < 0
             OR COALESCE(SUM(d.amount::numeric), 0) > c.amount::numeric + ${MONEY_TOLERANCE}`),
      rule("tax_challans", "audit-trail", "error",
        "Every challan has an audit entry for the deposit being recorded.",
        ["tds.createChallan (Challans)"],
        `SELECT c.business_id, c.id::text, c.kind || ' ' || c.financial_year || ' Q' || c.quarter || ' ' || c.challan_number || ' has no audit entry'
         FROM tax_challans c WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = c.id AND a.action = 'tds.createChallan')`),
    ],
  },
  {
    table: "tax_deductions",
    rules: [
      rule("tax_deductions", "valid", "error",
        "A deduction is TDS or TCS, payable or receivable, in a section of its own financial year and quarter (April-March, by Indian date), with a positive tax that is no more than the amount it was worked out on.",
        PAYMENT_WRITERS,
        `SELECT d.business_id, d.id::text, d.kind || ' ' || d.direction || ' ' || d.section_code || ' ' || d.amount || ' on ' || d.base_amount || ', ' || d.financial_year || ' Q' || d.quarter
         FROM tax_deductions d
         CROSS JOIN LATERAL (SELECT d.deducted_on AT TIME ZONE 'Asia/Kolkata' AS ist) x
         CROSS JOIN LATERAL (SELECT CASE WHEN EXTRACT(MONTH FROM x.ist) >= 4 THEN EXTRACT(YEAR FROM x.ist)::int ELSE EXTRACT(YEAR FROM x.ist)::int - 1 END AS fy_start) y
         WHERE d.kind NOT IN ('tds', 'tcs') OR d.direction NOT IN ('payable', 'receivable')
            OR d.amount::numeric <= 0 OR d.base_amount::numeric <= 0 OR d.amount::numeric > d.base_amount::numeric
            OR d.financial_year <> y.fy_start || '-' || LPAD(((y.fy_start + 1) % 100)::text, 2, '0')
            OR d.quarter <> FLOOR(((EXTRACT(MONTH FROM x.ist)::int + 8) % 12) / 3) + 1`),
      rule("tax_deductions", "links", "error",
        "A deduction's payment, expense, party and challan belong to its business, a challan covers the same kind, year and quarter, and only tax we owe (payable) is deposited.",
        PAYMENT_WRITERS,
        `SELECT d.business_id, d.id::text, d.kind || ' ' || d.direction || ' ' || d.section_code
         FROM tax_deductions d
         LEFT JOIN payments p ON p.id = d.payment_id
         LEFT JOIN expenses x ON x.id = d.expense_id
         JOIN parties pp ON pp.id = d.party_id
         LEFT JOIN tax_challans c ON c.id = d.challan_id
         WHERE pp.business_id <> d.business_id OR p.business_id <> d.business_id OR x.business_id <> d.business_id OR c.business_id <> d.business_id
            OR (c.id IS NOT NULL AND (c.kind <> d.kind OR c.financial_year <> d.financial_year OR c.quarter <> d.quarter))
            OR (c.id IS NOT NULL AND d.direction <> 'payable')`),
    ],
  },
  {
    table: "tds_reminder_log",
    rules: [],
    noExtraRequirements:
      "Scheduler bookkeeping: one row per business, item key and day offset (unique index), business_id is a cascading FK; it holds no money and nothing reads it but the reminder scheduler.",
  },
  {
    table: "tds_26as_entries",
    rules: [
      rule("tds_26as_entries", "valid", "error",
        "A 26AS row has a TAN (4 letters, 5 digits, 1 letter), a section, a status of pending or ignored, a non-negative amount paid and tax (deposited tax too, when given), and the financial year and quarter its transaction date falls in (April-March, by Indian date); a linked party belongs to the same business.",
        ["tds.import26as (26AS / AIS)", "tds.link26as / ignore26as"],
        `SELECT e.business_id, e.id::text, e.deductor_tan || ' ' || e.section || ' ' || e.tax_deducted || ', ' || e.financial_year || ' Q' || e.quarter
         FROM tds_26as_entries e
         LEFT JOIN parties pp ON pp.id = e.party_id
         CROSS JOIN LATERAL (SELECT e.txn_date AT TIME ZONE 'Asia/Kolkata' AS ist) x
         CROSS JOIN LATERAL (SELECT CASE WHEN EXTRACT(MONTH FROM x.ist) >= 4 THEN EXTRACT(YEAR FROM x.ist)::int ELSE EXTRACT(YEAR FROM x.ist)::int - 1 END AS fy_start) y
         WHERE e.deductor_tan !~ '^[A-Z]{4}[0-9]{5}[A-Z]$' OR e.section = '' OR e.status NOT IN ('pending', 'ignored')
            OR e.amount_paid::numeric < 0 OR e.tax_deducted::numeric < 0 OR e.tax_deposited::numeric < 0
            OR e.financial_year <> y.fy_start || '-' || LPAD(((y.fy_start + 1) % 100)::text, 2, '0')
            OR e.quarter <> FLOOR(((EXTRACT(MONTH FROM x.ist)::int + 8) % 12) / 3) + 1
            OR pp.business_id <> e.business_id`),
    ],
  },
  {
    table: "period_locks",
    rules: [
      rule("period_locks", "valid", "error",
        "A books lock has a date and no return month; a GST lock has a return month (YYYY-MM) and no date.",
        ["period.lockBooks", "period.lockGstMonth"],
        `SELECT business_id, id::text, kind || ' lock is malformed'
         FROM period_locks
         WHERE kind NOT IN ('books', 'gst')
            OR (kind = 'books' AND (locked_through IS NULL OR return_period IS NOT NULL))
            OR (kind = 'gst' AND (return_period IS NULL OR return_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR locked_through IS NOT NULL))`),
      rule("period_locks", "audit-trail", "error",
        "Every lock has an audit entry for the lock being set.",
        ["period.lockBooks", "period.lockGstMonth", "period.closeYear"],
        `SELECT l.business_id, l.id::text, l.kind || ' lock has no audit entry'
         FROM period_locks l WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = l.id AND a.action IN ('period.lockBooks', 'period.lockGstMonth'))
           AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.business_id = l.business_id AND a.action = 'period.closeYear')`),
    ],
  },
  {
    table: "financial_year_closes",
    rules: [
      rule("financial_year_closes", "audit-trail", "error",
        "Every closed year has an audit entry for the close.",
        ["period.closeYear"],
        `SELECT c.business_id, c.id::text, c.financial_year || ' close has no audit entry'
         FROM financial_year_closes c WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = c.id AND a.action = 'period.closeYear')`),
    ],
  },
];
