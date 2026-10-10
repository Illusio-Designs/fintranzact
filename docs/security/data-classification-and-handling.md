# Data classification and handling

Owner: [security owner]. Last reviewed: 2026-10-09. Next review: 2027-04-09.

**STATUS.** The classes below describe data the product really holds. Encryption of the highest class, role-based access and the selfie purge are implemented. The handling rules for staff (no copies, no screenshots) are policy, not enforced by tooling.

## Roles

Fintranzact is a **processor** for the personal and business data that customer businesses enter (their parties, invoices, employees, payroll): the business decides why and how it is used. For the account data of the people who sign in to Fintranzact itself (name, email, phone, login events), Fintranzact decides the purpose and is the **data fiduciary** under the DPDP Act. Have a lawyer confirm this split in the customer terms.

## Classes

| Class | What is in it in this product | Where | Handling |
|---|---|---|---|
| **Restricted** (compromise causes direct financial or identity harm) | Razorpay key id/secret/webhook secret per business; e-invoice and e-way bill logins and tokens; courier API keys; 2FA secrets and backup-code hashes; password hashes; session ids and access tokens; the `ENCRYPTION_KEY`, `SANDBOX_API_*`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, database URLs | Encrypted columns (see [key-rotation.md](key-rotation.md)); hashes; environment variables | Never in logs, tickets, chat or screenshots. Encrypted at rest (credentials) or hashed. Staff do not read them; support cannot see them (the app returns masked values). Leak means rotate and follow the incident plan. |
| **Sensitive personal** | Employee selfies and check-in latitude/longitude; bank account numbers and IFSC of businesses, employees and parties; salary, deductions, loans, PAN and Aadhaar (encrypted in the database) / UAN / ESI numbers where entered; payroll registers and payslips; phone numbers and email addresses of people | Tenant database (`employee_punch_selfies` stores photo bytes; punches; payroll tables; `parties`; `bank_accounts`) | Visible only to roles with the matching permission (HR, payroll, accountant, owner). Selfies are deleted after the business's retention period (default 90 days). Not copied out of production. Appear in exports only to the owning business. |
| **Business confidential** | Invoices, ledgers, GSTINs, GST returns, TDS data, stock, price lists, customer and supplier lists, AI assistant conversations (may quote figures) | Tenant database; backups | Role-based access; business-scoped queries; included in the customer's own export; AI conversations only visible to the person who had them. |
| **Internal** | Application logs (no secrets or full phone numbers by design), roadmap, support notes, this documentation | Railway/host logs; repo | Staff only. |
| **Public** | Marketing site, help centre, API docs, public storefront catalog (without purchase prices or stock counts) | Web | No restriction. |

GSTIN and PAN are identifiers the customer shares on invoices; the business's own GSTIN is business confidential, an individual's PAN is sensitive personal.

**Known gap.** Employee UAN and ESIC number (`employees.uan`, `esic_number`), party and business bank account numbers, and the employee profile photo are ordinary text columns: the API masks them in lists and keeps them out of logs and the audit trail, but they are **not** field-encrypted in the database (only the host's disk or volume encryption, if enabled, protects them). Moving them to the same field encryption as the credentials is the recommended next step; it needs a migration of existing rows and care for search and masking. **Employee Aadhaar numbers, PANs and bank account numbers are encrypted** (`employees.aadhaar`, `pan`, `bank_account_number` and the copy on `payroll_run_lines`, AES-256-GCM, same key and rotation as the credentials). They are shown in full only to roles with Payroll "manage" (and in the bank file, Form 16 and Form 24Q data, which need Payroll "update"). The self-export file leaves Aadhaar out and carries PAN and bank numbers in plain text, because the ciphertext is tied to this server's key and the import encrypts them again.

## Handling rules

1. Collect only what a feature needs. A new field holding personal data needs a line here and in [retention-and-deletion.md](retention-and-deletion.md).
2. Restricted data is encrypted before it is stored and masked on every read for display (`keyIdMasked` for Razorpay). New credential columns must be added to the rotation tool's list (a test enforces it).
3. No production data in development, tests or screenshots; fixtures are fake (the secret scanner allowlist is narrow so real-looking values get caught).
4. Data sent to a third party is limited to the table in [third-parties-and-data-flows.md](third-parties-and-data-flows.md). Anything new goes through the vendor rule in the policy.
5. Selfies and locations: collected only at a punch the employee makes, shown to HR/payroll roles, purged on schedule. Not used for anything but attendance.
6. Exports and backups inherit the class of their content: exports are downloaded by the owning business through a short-lived signed link; backups are encrypted ([backup-and-recovery.md](backup-and-recovery.md)).
7. Deleting: follow [retention-and-deletion.md](retention-and-deletion.md); do not improvise `DELETE` statements in production.
