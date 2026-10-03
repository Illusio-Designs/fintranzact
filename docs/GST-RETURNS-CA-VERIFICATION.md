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
