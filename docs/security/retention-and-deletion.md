# Retention and deletion

Owner: [security owner]. Last reviewed: 2026-10-09. Next review: 2027-04-09.

**STATUS.** Automated today: attendance selfie purge, expired session and token cleanup, conversation deletion by the user, per-business self-export. **Not automated:** erasure of a person's data on request, deleting a business or user account end to end, purging old audit and security logs, AI conversation expiry, backup expiry beyond the backup tool's own days. The DPDP erasure and export process below is a manual procedure, not a button. DPDP duties are expected from about May 2027; this is the plan to be ready.

## What is retained and what is deleted today

| Data | Retention today | Automated? |
|---|---|---|
| Attendance selfies (`employee_punch_selfies`) | Per business, 7 to 365 days, default 90. The punch row stays; the photo goes. Purge runs every 6 hours and at once when retention is shortened. | Yes (`lib/selfie-purge-scheduler.ts`) |
| Punch locations (latitude/longitude on a punch) | Kept with the punch (attendance record) | No purge |
| Sessions, email-change tokens | Expire; cleaned hourly | Yes (`server.ts`) |
| 2FA challenges, trusted devices | Short expiry (5 minutes / 30 days) | Expire; cleanup by expiry |
| Share-link tokens | Until revoked | No expiry |
| Trial claims (`trial_claims`: hashes of email, phone, GSTIN) | Kept so a business cannot take a second free trial; raw values are not stored | No purge; decide a period with a lawyer |
| AI assistant conversations and pending actions | Until the person deletes the chat or the business is deleted; no automatic purge | Manual by user |
| Business books (invoices, ledgers, payroll) | For the life of the customer's account. Indian law makes the business keep books for years; that duty is the customer's, we keep their data available | No purge |
| Audit log (`audit_log`), security events (`security_events`) | Kept indefinitely today | No purge |
| Application logs on the host | Host default; not yet set to 180 days | See [logging-and-monitoring.md](logging-and-monitoring.md) |
| Backups | `BACKUP_RETENTION_DAYS` (default 30) | Yes, by the backup script |

## Roles

Fintranzact is the processor of the books and employee data a business enters; the business is responsible for lawful basis, employee notices and consent. For the account holders themselves (name, email, phone, sign-in events) Fintranzact decides the purposes. See [data-classification-and-handling.md](data-classification-and-handling.md). Customer terms must say so, and say what happens to data when a subscription ends [lawyer to confirm the wording and periods].

## Requests from people (access, correction, erasure)

Target: acknowledge in 3 working days, finish within [30] days.

1. **Who is asking.** Verify by replying to the email on the account or through the signed-in business owner. A request from an employee about payroll data goes to their employer (the business) first; we help the business act.
2. **Access or portability.** The owner of the business can download everything from the self-export feature (Settings, export: NDJSON files plus a manifest, `src/http/exportStream.ts`). For an individual's account data (name, email, phone, sessions, security events) run the queries listed in the support notes [location] and send them to the verified email.
3. **Erasure of a business.** Confirm the request comes from the owner; offer an export first; take a fresh backup copy aside only if the law requires us to keep it; delete the organisation's rows (tenant database in multi-tenant mode, or the business's rows in single-database mode) and the control rows (`tenants`, members, share links, sessions); remove the tenant database; note the date. **Not yet scripted**; do it on a staging restore first and have a second person check.
4. **Erasure of one person** (for example a former employee's selfies, an account holder who leaves): delete or anonymise the rows that identify them (selfies first), keep books of account entries the business must retain with the name replaced if the law allows. Ask the business before touching payroll history.
5. **Backups.** Deleted data remains in backups until they expire (30 days by default). Say so in the reply. Restoring a backup must re-apply any erasure done since (keep a list of erasures: id, date; see [backup-and-recovery.md](backup-and-recovery.md)).
6. **Vendors.** If the data went to a vendor that stores it (for example Resend's email logs), request deletion there too or state their retention.
7. **Record** the request, who verified it, what was done and the date, for the calendar evidence. Keep the record for [3] years without the personal data itself.

## Gaps to close (in order)

1. A scripted, tested "delete this organisation" procedure and a "delete this person" helper.
2. A retention period and purge for `security_events`, `audit_log` and old share links, chosen with the 180-day log duty in mind (keep at least 180 days; decide the maximum).
3. An expiry for AI conversations if a customer asks for one.
4. A retention rule for `trial_claims` hashes.
