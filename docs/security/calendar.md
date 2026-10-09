# Security calendar

Owner: [security owner]. Last reviewed: 2026-10-09. Next review: 2027-04-09.

**STATUS.** A checklist only: nothing reminds you. Put these in a shared calendar with [name] as the assignee, and keep the evidence in [one folder, e.g. a private drive "security-evidence/YYYY"]. A routine with no evidence did not happen when a customer or auditor asks.

| When | Routine | Evidence to keep |
|---|---|---|
| **Daily** (5 min) | Look at: failed deploy or red `main`, Railway/AWS alerts, backup job result (email or log line), uptime monitor, security mailbox (`security@fintranzact.com`), vendor security emails | A one-line note in the ops log if anything was off |
| **Weekly** (30 min, Monday) | Read the `Security` workflow run (weekly schedule runs Monday 03:30 UTC); review open Dependabot PRs and merge or comment; skim error logs; check Sandbox wallet/quota alerts; confirm last backup exists and its size is sane | Link to the workflow run; list of PRs merged |
| **Biweekly** | Triage open vulnerabilities against the fix-time targets (critical 7 days, high 30); renew or remove allowlist entries expiring within 30 days (`security/audit-allowlist.json`, `.trivyignore`) | Updated allowlist PR or a "nothing due" note |
| **Monthly** (1 hour) | Review `security_events` for odd role changes, 2FA resets, exports; review failed-login and rate-limit logs; confirm MFA still on for admins; check that the 180-day log retention rule is still applied (once it exists); skim the platform-admin list | Short written summary with date |
| **Quarterly** (half a day) | Access review ([access-control-and-offboarding.md](access-control-and-offboarding.md)); **restore test** ([backup-and-recovery.md](backup-and-recovery.md)) with measured time; review vendor list for changes; review exceptions and open risks; review branch protection settings | Access review sheet; restore test note with time and result |
| **Every 6 months** | Incident-response **tabletop**; review this policy pack for drift against the product; check the CERT-In contact details and the point-of-contact designation; test that on-call phone numbers work | Tabletop record; changed-pages list |
| **Yearly** | **Rotate `ENCRYPTION_KEY`** and other secrets ([key-rotation.md](key-rotation.md), [secrets-management.md](secrets-management.md)); independent **penetration test** and fix report; policy approval by management; vendor terms re-read (DPA, region, sub-processors); DPDP notice/consent text re-check with the lawyer; app-store data-safety forms re-check; AWS account review (root MFA, IAM users, keys, CloudTrail, GuardDuty findings); renew domain, certificates, vendor plans | Rotation record (date, verification line); pen-test report and fix status; signed policy page |
| **After every incident or major change** | Review, update this pack, add a calendar item for each action | Incident review |

Dates to put in the calendar now: audit allowlist expiry 2027-01-07 (four Expo build-tool advisories); DPDP main duties around May 2027 (finish retention/erasure work, notice text and vendor terms by March 2027).
