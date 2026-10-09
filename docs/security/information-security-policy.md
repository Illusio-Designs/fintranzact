# Information security policy

Owner: [security owner / founder]. Approved by: [name], [date]. Last reviewed: 2026-10-09. Next review: 2027-10-09 (and after any serious incident).

**STATUS.** This is a written policy for a very small team. Where it says "must", check the right-hand note: some rules are enforced by the product or CI today, the rest depend on people and are only as good as the calendar ([calendar.md](calendar.md)). Not audited or certified by anyone.

## Purpose and scope

Protect the accounting, GST, payroll and payment data that businesses put into Fintranzact, and the credentials that let us act for them. Applies to everyone with access to the code, servers, vendor consoles or customer data (staff, contractors), and to every system listed in [third-parties-and-data-flows.md](third-parties-and-data-flows.md).

## Rules

1. **Least access.** People get the smallest role that does their job; customer data is accessed only to support that customer, on request. (Enforced for customers by roles in the product; for staff by vendor-console roles, checked quarterly. See [access-control-and-offboarding.md](access-control-and-offboarding.md).)
2. **Strong sign-in everywhere.** Unique password in a password manager plus MFA on GitHub, Railway/AWS, Vercel, Razorpay, Sandbox.co.in, Resend, MSG91, Anthropic console, the domain registrar and email. No shared logins. (Planned: owner action.)
3. **Secrets never in code, chat, tickets or logs.** They live in environment configuration, rotate on the schedule in [secrets-management.md](secrets-management.md), and are scanned for in every pull request. (Scanning in place; rotation partly manual.)
4. **Customer data stays in production.** No production data on laptops, in screenshots or in test databases. Tests use fake data. Support views what the customer sees, nothing more. (Policy only.)
5. **Encrypt.** HTTPS only; stored credentials encrypted with `ENCRYPTION_KEY`; backups encrypted; disks encrypted on laptops and on the hosting provider's volumes. (App-level and backup encryption in place; laptop and disk settings are owner actions.)
6. **Changes go through review and CI.** No direct pushes to `main`, no skipping required checks, no hot edits on servers. ([change-management.md](change-management.md).)
7. **Patch on time.** Fix-time targets: critical 7 days, high 30, medium 90, low next release. ([vulnerability-management.md](vulnerability-management.md).)
8. **Log and watch.** Security-relevant events are recorded; someone reads the alerts on the calendar. ([logging-and-monitoring.md](logging-and-monitoring.md).)
9. **Back up and test the restore.** ([backup-and-recovery.md](backup-and-recovery.md).)
10. **Report fast.** Anyone who suspects a leak, a lost laptop or a phishing click tells [security owner] at once, any hour. Incidents follow [incident-response-plan.md](incident-response-plan.md); the CERT-In clock is 6 hours from noticing.
11. **Vendors.** A new service that receives customer data needs a line in the vendor register, the owner's approval, and its terms read for data use and location before launch.
12. **Devices.** Laptops used for work: disk encryption on, screen lock, automatic updates, no pirated software. Lost device: report it, then remove its access ([access-control-and-offboarding.md](access-control-and-offboarding.md)).
13. **Customer data rights.** Requests to see, export, correct or erase personal data are answered within [30] days using [retention-and-deletion.md](retention-and-deletion.md).
14. **Breaking the policy.** Report it; honest reports are not punished. Repeated or deliberate breaches are handled under the employment or contractor agreement.

## Roles

- **Security owner** [name]: owns this policy, the calendar, vendor register and incident response; decides exceptions in writing.
- **Engineering lead** [name]: code review, CI, dependency updates.
- **Founder / director** [name]: approves vendors and spending, signs regulator notices.
- Until the team grows, one person may hold all three; the written record still has to exist.

## Exceptions

An exception needs: what, why, compensating control, who approved, expiry date. Keep them in [location, e.g. a private repo issue]. Expired exceptions are closed or renewed at the quarterly review.

## Review

Yearly, after incidents, and when the product or hosting changes (for example the move to AWS).
