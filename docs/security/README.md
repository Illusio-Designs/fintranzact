# Security documents

Owner: [security owner]. Last reviewed: 2026-10-09. Next review: 2027-04-09.

Short, practical documents for running Fintranzact safely and for answering customers. They say what exists **in the repository today** and what is only planned. None of them claims a certification or legal compliance; where a law is mentioned, it is the duty we are working towards, and a lawyer should confirm the reading.

Laws and rules in mind: the Digital Personal Data Protection Act 2023 and Rules 2025 (main duties expected from about May 2027: notice and consent, security safeguards, erasure, breach intimation to the Data Protection Board with a detailed report within 72 hours), the CERT-In Directions of April 2022 (report incidents within 6 hours of noticing, keep logs 180 days, sync clocks to NTP), Razorpay's integration rules, and the Play Store and App Store data-safety forms.

## Index

| Document | Use it for |
|---|---|
| [information-security-policy.md](information-security-policy.md) | The rules everyone follows |
| [data-classification-and-handling.md](data-classification-and-handling.md) | What data we hold and how to treat each kind |
| [access-control-and-offboarding.md](access-control-and-offboarding.md) | Roles, 2FA, access reviews, removing leavers |
| [retention-and-deletion.md](retention-and-deletion.md) | What is deleted when; erasure and export requests |
| [incident-response-plan.md](incident-response-plan.md) | What to do when something goes wrong; the 6-hour and 72-hour clocks |
| [vulnerability-management.md](vulnerability-management.md) | Scanners, fix times, exceptions |
| [key-rotation.md](key-rotation.md) | Rotating `ENCRYPTION_KEY` |
| [backup-and-recovery.md](backup-and-recovery.md) | Backups, restore test, restore procedure |
| [change-management.md](change-management.md) | What CI/CD enforces before code ships |
| [third-parties-and-data-flows.md](third-parties-and-data-flows.md) | Who receives what data |
| [logging-and-monitoring.md](logging-and-monitoring.md) | What is logged, 180-day retention, gaps |
| [secrets-management.md](secrets-management.md) | Where secrets live and how they rotate |
| [calendar.md](calendar.md) | Daily to yearly routines and the evidence to keep |
| [questionnaire-answers.md](questionnaire-answers.md) | Starter answers for customer security questionnaires |
| [http-security-headers.md](http-security-headers.md) | Header audit and recommendations |

The owner's own to-do list is section 19 of [../PENDING-OWNER-TASKS.md](../PENDING-OWNER-TASKS.md).

## Control status

Status words: **in place** (works in the repo/product now), **partial** (some of it), **planned** (not built or not done). "Evidence" is where to look. Customer expectation means large customers' questionnaires typically ask for it.

| Control | Required or expected by | Status | Evidence in the repo |
|---|---|---|---|
| Passwords hashed with Argon2id; sessions server-controlled with expiry | Customer expectation, DPDP safeguards | in place | `SECURITY.md`; `packages/api` auth code and tests |
| Two-factor authentication (authenticator app), organisation can require it | Customer expectation | in place | `docs/TWO-FACTOR.md`; `integration/two-factor-*.test.ts` |
| Role-based access (owner, admin, accountant, HR, employee and more) | Customer expectation, DPDP safeguards | in place | `memberRoleEnum`; `docs/ACCOUNTANT-ACCESS.md`, `docs/architecture/role-based-ui.md` |
| Per-business data isolation (tenant scoping), cross-tenant audit | Customer expectation | in place | `docs/security-cross-tenant-audit.md` |
| Credentials encrypted at rest (AES-256-GCM): Razorpay keys, e-invoice/e-way bill logins, courier keys, 2FA secrets, tenant DB passwords | DPDP safeguards, Razorpay, customer expectation | in place | `packages/db/src/crypto.ts`, [key-rotation.md](key-rotation.md) |
| Encryption key rotation | Good practice, customer expectation | in place (never run on production) | `src/bin/rotate-encryption-key.ts`, tests |
| Audit log of business changes; security events (2FA, access changes, exports) | CERT-In logs, customer expectation | partial (no 180-day guarantee, see logging) | `audit_log`, `security_events`, [logging-and-monitoring.md](logging-and-monitoring.md) |
| Dependency vulnerability scanning with fail on critical/high | Customer expectation | in place (workflow not yet run on GitHub) | `.github/workflows/security.yml`, `security/audit-allowlist.json` |
| Static analysis, secret scanning, image scanning | Customer expectation | in place (same caveat) | `security/semgrep/`, `.gitleaks.toml`, `.trivyignore` |
| Dependabot updates, reviewed by a person | Customer expectation | in place | `.github/dependabot.yml` |
| Required CI checks before merge (tests, types, lint, licences) | Customer expectation | in place; branch protection is an owner setting | `.github/workflows/ci.yml`, [change-management.md](change-management.md) |
| Razorpay webhooks verified by signature; hosted payment flows | Razorpay | in place | `lib/razorpay/`, `razorpay-client.test.ts` |
| HTTP security headers (API, web app) | Customer expectation | in place; a CSP report endpoint is planned | [http-security-headers.md](http-security-headers.md) |
| Rate limiting, Turnstile bot protection on public forms | Customer expectation | in place | `SECURITY.md` |
| Employee selfie retention purge | DPDP (storage limitation) | in place | `lib/selfie-purge-scheduler.ts` |
| Other retention and automated deletion | DPDP (storage limitation) | partial | [retention-and-deletion.md](retention-and-deletion.md) |
| Customer self-export of their books | DPDP (access/portability) | in place | `src/http/exportStream.ts`, self-export docs |
| Erasure of a person's data on request | DPDP | planned (manual process documented) | [retention-and-deletion.md](retention-and-deletion.md) |
| DPDP notice and consent text, reviewed by a lawyer | DPDP | planned | owner list section 19 |
| Breach reporting: CERT-In 6 hours, Data Protection Board 72 hours, customers | CERT-In, DPDP | documented, never exercised | [incident-response-plan.md](incident-response-plan.md) |
| CERT-In point of contact designated | CERT-In | planned | owner list |
| Log retention 180 days and NTP time sync | CERT-In | planned / depends on hosting | [logging-and-monitoring.md](logging-and-monitoring.md) |
| Encrypted offsite backups and a tested restore | Customer expectation, DPDP safeguards | partial (scripts exist; restore test not scheduled) | `scripts/backup.sh`, `test-backup-restore.sh`, [backup-and-recovery.md](backup-and-recovery.md) |
| Secrets manager | Customer expectation | planned (env vars today) | [secrets-management.md](secrets-management.md) |
| MFA on every vendor and admin account (GitHub, Railway, Vercel, Razorpay, Sandbox, Resend, AWS) | Customer expectation | planned (owner action) | owner list |
| Independent penetration test | Customer expectation | planned | owner list |
| Vendor data-processing terms and a vendor register | DPDP, customer expectation | partial (register written, terms not collected) | [third-parties-and-data-flows.md](third-parties-and-data-flows.md) |
| App store data-safety forms | Play Store, App Store | planned | owner list |
| Security awareness for staff, background checks | Customer expectation | planned | policy |
| ISO 27001, SOC 2 | Some large customers | not pursued, no claim made | none |

If a row here and a statement in a customer reply ever disagree, fix the reply.
