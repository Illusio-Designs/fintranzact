# Logging and monitoring

Owner: [engineering lead]. Last reviewed: 2026-10-09. Next review: 2027-04-09.

**STATUS.** Application logging, a per-business audit log and a security events table exist. **Missing:** a guaranteed 180-day retention of the logs CERT-In asks for, confirmed NTP time sync on the hosts, central log storage, and any automatic alert on suspicious events. Today an incident would be noticed by a person, not by a rule.

## What is logged today

| Source | What | Where | Retention today |
|---|---|---|---|
| API request/application logs | `pino` JSON logs in production (level `LOG_LEVEL`, default info): errors, scheduler runs, rate-limit and auth failures as coded. Code avoids logging secrets and phone numbers (SMS code states this); driver errors that can echo parameters are not printed by the rotation tool. | Host log stream (Railway or the container runtime) | Whatever the host keeps (often days, not 180) |
| `audit_log` (tenant database) | Every audited mutation: business, user id, action (for example `invoice.create`), entity, metadata JSON, IP address, time. Written by `withAudit` in the routers. | Postgres | Kept indefinitely; no purge |
| `security_events` (control database) | `access.*` (invited, accepted, role changed, organisation opened, export, partner attributed), `2fa.*` (setup, enabled, disabled, verified, failed, locked, backup used, reset by admin, policy changed), with user, actor, tenant, IP, user agent. Recording never throws. | Postgres; owners/admins see the `access.*` events in the product's access log screen | Kept indefinitely; no purge |
| Sessions table | Active sessions with creation and expiry | Postgres | Expired rows deleted hourly |
| Razorpay / Sandbox / email events | Webhook receipts, Sandbox usage metering and quota alerts, email send results | Postgres and logs | As above |
| Vendor consoles | GitHub audit log, Railway/AWS activity, Vercel deploys, Razorpay dashboard | Vendor | Vendor default |
| CI | Action run logs (security scans, tests) | GitHub | 90 days by default |

## What CERT-In asks (2022 Directions) and where we stand

- **Keep logs of ICT systems for 180 days**, within India, and hand them over on request. Status: **planned**. The database tables above are kept longer, but application and host logs are not guaranteed. Action: ship API logs to a store in India (CloudWatch Logs in ap-south-1 or similar) with a 180-day retention rule, and keep the AWS CloudTrail and load balancer logs for 180 days too. Owner: [engineering lead].
- **Synchronise clocks with NTP** (NIC or NPL servers or servers traceable to them). Status: **unknown**. Managed hosts usually sync to their own time service; write down what yours does and, on AWS, use the Amazon Time Sync Service or NTP pool pointing to `time.nplindia.org` / `samay1.nic.in` per the Directions, and record it here: [source and date confirmed].
- **Report incidents within 6 hours.** See [incident-response-plan.md](incident-response-plan.md).

## What is missing (in priority order)

1. 180-day central log retention (above).
2. Alerts: repeated `2fa.failed`/`2fa.locked`, many failed sign-ins from one IP, `access.role_changed` to owner/admin outside business hours, a new platform admin, exports at odd times, 5xx spikes, backup job failures, Sandbox quota alerts (the quota alert exists for Sandbox only). A first version is a daily SQL query over `security_events` emailed to [security owner].
3. A health check and uptime monitor on the API and web app with a phone alert.
4. Failed-login counts are rate-limited but not recorded as `security_events`; consider recording them.
5. `audit_log` and `security_events` retention policy ([retention-and-deletion.md](retention-and-deletion.md)); tamper protection (append-only role or periodic export to write-once storage).
6. Log review is on the calendar ([calendar.md](calendar.md)): weekly skim of errors, monthly review of security events.

## Rules for developers

- Never log request bodies of credential, payment or payroll endpoints, tokens, full phone numbers, Aadhaar/PAN, or ciphertext. Log ids.
- Use the `logger`, not `console.log`, in the API.
- Errors shown to users carry no stack traces or SQL.
- New security-relevant action? Record a `security_events` row with a fixed, small metadata shape (see `lib/access-events.ts`).
