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

## Filing

- [ ] The PAN used for the EVC OTP (registration PAN by default; the authorised signatory's PAN for some constitutions).

## Filing wizard wording

The web and mobile filing wizard (`packages/shared/src/gst-filing-wizard.ts` for the sentences) explains these points to the user in plain words. Check that they are right:

- [ ] The help text for the two turnover figures: "aggregate turnover of the previous financial year" and "of the current financial year up to this period, including this month" (the app does not derive either).
- [ ] The set-off explanation shown before the user confirms (utilisation order, cash of one tax cannot pay another, reverse charge in cash only, interest and late fee not included).
- [ ] The nil-return confirmations: "no outward supplies" (GSTR-1) and "no transactions" (GSTR-3B), and the note that exports, advances and interest are not visible to the app.
- [ ] The final acknowledgement and the note that a filed return can only be corrected by an amendment.
