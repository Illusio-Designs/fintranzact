# GST returns: CA verification checklist

Before go-live, a chartered accountant should sign off on the items below. The code is in `packages/api/src/lib/gst-3b-offset.ts`, `gst-return-flow.ts` and `sandbox/gst-returns.ts`.

## Tax payment set-off (GSTR-3B step 5)

- [ ] Utilisation order: IGST credit against IGST, then CGST, then SGST; CGST credit against CGST, then IGST (never SGST); SGST credit against SGST, then IGST (never CGST). Check against section 49A / 49B and Rule 88A.
- [ ] Reverse-charge tax, interest and late fee are paid from cash only.
- [ ] Available credit is taken from the ITC ledger balance. Confirm whether credit claimed in the current return must be added before the set-off.
- [ ] Cess is not modelled.
- [ ] Interest and late fee are not calculated: the user adds them on the portal.
- [ ] Blocked or restricted credit (for example Rule 86B) is not detected by the app.

## Mapping

- [ ] GSTR-3B: only `sup_details` (3.1 a, b, c, d) and `itc_elg` (4A5 and net ITC) are sent. `inward_sup`, 3.2 `inter_sup`, ITC reversal, ineligible ITC, interest and late fee are not.
- [ ] GSTR-1: `exp`, `at`, `txpd`, `doc_issue` and amendment sections are sent empty; `gt` and `cur_gt` are typed in by the user.
- [ ] Nil returns: the guards only see what the books hold (no exports, advances or interest).

## Online store delivery charge (open question, not settled)

An online-store order can carry a flat delivery charge set by the business (`store_delivery_fee`, free above an optional order subtotal). It is added to the order's invoice through the existing additional-charges mechanism, so it takes the same GST treatment as any charge on an invoice (`chargeTaxRateFor` in `packages/shared/src/calc.ts`): part of the value of supply, taxed at the highest GST rate among the items in the order, CGST + SGST, and 0% when every item is nil-rated. The store adds no tax rule of its own. The treatment has NOT been confirmed by a CA:

- [ ] Delivery billed together with goods sold to an online-store shopper: is it a composite supply taxed at the principal supply's rate (the highest line rate is used as a proxy), or does a mixed-rate order need the charge split pro rata across the rates (or taxed at the highest rate) instead? Check against section 15(2)(c) and section 8 of the CGST Act.
- [ ] A delivery charge on an order of only exempt or nil-rated goods stays untaxed here; confirm.
- [ ] The charge is entered by the owner **before** GST and GST is added on top; confirm that this is how owners should quote it (shoppers see the fee and the GST in the order summary).
- [ ] A refund reverses the delivery charge with its GST at the rate it was charged: the refund credit note joins it to the group of that rate. Confirm that one credit note line per rate is acceptable.
- [ ] Free delivery above a threshold (the fee is simply not charged): confirm no deemed supply arises.

## Filing

- [ ] The PAN used for the EVC OTP (registration PAN by default; the authorised signatory's PAN for some constitutions).

## Filing wizard wording

The web and mobile filing wizard (`packages/shared/src/gst-filing-wizard.ts` for the sentences) explains these points to the user in plain words. Check that they are right:

- [ ] The help text for the two turnover figures: "aggregate turnover of the previous financial year" and "of the current financial year up to this period, including this month" (the app does not derive either).
- [ ] The set-off explanation shown before the user confirms (utilisation order, cash of one tax cannot pay another, reverse charge in cash only, interest and late fee not included).
- [ ] The nil-return confirmations: "no outward supplies" (GSTR-1) and "no transactions" (GSTR-3B), and the note that exports, advances and interest are not visible to the app.
- [ ] The final acknowledgement and the note that a filed return can only be corrected by an amendment.
