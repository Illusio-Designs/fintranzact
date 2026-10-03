# Subscription invoices: GST checklist for the CA

What the code does today on the GST invoices Finvera Solutions LLP issues for Fintranzact subscriptions and add-ons. Read from the source, not legal advice. **The CA still has to be told and to confirm every item.**

## Seller and rate

- Seller: Finvera Solutions LLP. GSTIN from `FINVERA_GSTIN` (the invoice says "Registration applied for" until it is set). Seller state code from `FINVERA_STATE_CODE`, default `24` (Gujarat). `packages/api/src/lib/billing/invoice-pdf.ts`.
- SAC **998315** ("online software services"). Owner confirmed; CA to confirm.
- GST rate 18% (`PLAN_GST_RATE_PERCENT`). Plan and add-on prices are ex-GST; GST is added at checkout and shown on the invoice.

## CGST + SGST or IGST (place of supply)

The organisation's billing details hold a GSTIN (optional) and a **State / UT (for GST)** (a GST state code, optional). The split is one pure rule (`billingPlaceOfSupply` in `packages/shared/src/billing.ts`, used by `gstSplit`):

| Customer | Tax |
|---|---|
| Valid GSTIN in the seller's state | CGST 9% + SGST 9% |
| Valid GSTIN in another state | IGST 18% |
| No GSTIN, billing state = seller's state | CGST 9% + SGST 9% |
| No GSTIN, billing state in another state | IGST 18% |
| No GSTIN and no billing state (unknown) | IGST 18% (owner-confirmed safe default) |
| GSTIN and a billing state that differ | the GSTIN's state decides; the form shows a note |
| GSTIN that fails the structure check | treated as no GSTIN |

A registered customer's place of supply is its GSTIN state (B2B: the recipient's registered state). The free-text address is never read to guess a state. In the billing form the state is filled from the GSTIN and locked when a valid GSTIN is entered.

An unregistered customer in Gujarat used to be charged IGST; they now pay CGST + SGST once they set their state to Gujarat.

## What is printed and kept

- The invoice prints the customer's name, address, GSTIN (or "Unregistered"), **State: name (code)** and **Place of supply** (or "Not specified (taxed as IGST)").
- The state is copied onto each payment (`billing_payments.billing_state`) when it is made, together with the name, GSTIN and address. Changing the billing state later never rewrites an invoice already issued.
- Invoice numbers are sequential (`FIN-00001`); failed charges take no number. Credit notes (unused time on an upgrade) are numbered from the same series.

## For the CA to confirm

1. SAC 998315 and the 18% rate for the plans and add-ons.
2. The unregistered-customer rule: state decides, unknown state is IGST.
3. Place of supply for a registered customer is its GSTIN state, even when the organisation's own billing state differs.
4. Credit notes on plan upgrades, and the treatment of the free trial (no invoice, no charge).
5. When Finvera's GST registration lands: set `FINVERA_GSTIN` and check `FINVERA_STATE_CODE`.
