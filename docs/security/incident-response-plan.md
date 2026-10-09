# Incident response plan

Owner: [security owner]. Last reviewed: 2026-10-09. Next review: 2027-04-09, and after every incident or tabletop.

**STATUS.** Written, **never exercised**. The product records the evidence you will need (security events, audit log, request logs) but has no automatic alerting on it yet ([logging-and-monitoring.md](logging-and-monitoring.md)), so detection is mostly by people, customer reports and vendor emails. CERT-In and Data Protection Board duties below are our reading of the rules; a lawyer must confirm the exact triggers. The Board's duties start only when the DPDP Rules come fully into force (expected around May 2027); the CERT-In 6-hour duty applies now.

## Roles (fill in before you need them)

| Role | Name | Phone (24x7) | Backup |
|---|---|---|---|
| Incident lead (decides, owns the clock) | [name] | [number] | [name] |
| Technical lead (contain, investigate) | [name] | [number] | [name] |
| Communications (customers, regulators) | [name] | [number] | [name] |
| Legal adviser | [name / firm] | [number] | |

If you are one person, you hold every role: still write down each decision and its time.

## Severity

| Level | Meaning | Examples | Response start |
|---|---|---|---|
| **SEV1** | Customer data or credentials exposed or very likely exposed; production down for everyone; a regulator-reportable event | Database or backup leaked, `ENCRYPTION_KEY` or Razorpay/Sandbox keys leaked, attacker with admin access, ransomware | Immediately, any hour |
| **SEV2** | Serious weakness being exploited, or limited exposure, or a large outage | One organisation's data seen by another, a stolen laptop with access, credential-stuffing wave | Within 1 hour |
| **SEV3** | Contained, no data exposed | Failed attack, vulnerability found by a researcher, minor outage | Same working day |

When unsure, treat it as one level higher until proven otherwise.

## The two clocks (start both at the moment someone first notices)

1. **CERT-In: report within 6 hours of noticing** a reportable cyber incident (the 2022 Directions list types such as data breach, data leak, unauthorised access to systems or data, attacks on servers/applications, compromise of critical systems, identity theft or spoofing, ransomware). Report to incident@cert-in.org.in (also the phone and web form on cert-in.org.in; confirm the current channels) using the form there; send what you know and follow up. Do not wait to finish investigating.
2. **Data Protection Board of India (once the DPDP duties apply):** intimate the Board **without delay** of a personal data breach and send a **detailed report within 72 hours** (nature, extent, timing, location, likely impact, mitigation, findings about who caused it, remedial steps, notice given to those affected). Also tell each affected person (in practice, through the business customer that owns the data, and directly for our own account holders) clearly and without delay.
3. **Customers.** As processor we tell each affected business customer promptly [target: within 24 hours of confirming] so they can meet their own duties.

Write the noticed-at time on the incident record first.

## Steps

1. **Detect and record.** Open a private incident record [location]: who noticed, when (with time zone), what, how. Page the incident lead.
2. **Triage.** Set the severity. Decide: is personal data or credentials involved? Which organisations? Is it still happening? Start the clocks if it is reportable.
3. **Contain.** Stop the harm first, keep evidence. Typical actions: revoke sessions (`DELETE FROM sessions` for affected users or all), disable an organisation, block an IP at the edge, rotate the exposed secrets ([secrets-management.md](secrets-management.md); `ENCRYPTION_KEY` via [key-rotation.md](key-rotation.md)), disable a compromised vendor key, put the site in maintenance mode (`pnpm --filter @fintranzact/api maintenance`), take a database snapshot first.
4. **Preserve evidence.** Before restarting or deleting anything: snapshot the database and volumes; export Railway/AWS logs, `security_events` and `audit_log` for the period; save the Actions run logs and vendor emails; record hashes of exported files; keep a timeline with times. Do not log in as the attacker or alter their artefacts. Keep logs at least 180 days (CERT-In).
5. **Investigate.** Entry point, accounts and data touched, time window, whether data left. Use `security_events` (`access.*`, `2fa.*`), `audit_log`, host logs, vendor consoles (Razorpay, Sandbox, Resend, GitHub audit log). Decide the affected organisations and the kinds of data.
6. **Notify.** CERT-In (6 hours), Board (when applicable), customers, affected individuals, Razorpay if payment credentials or flows are involved, and the police or cyber-crime portal if there was a crime. Use the templates below. All outside statements are approved by the incident lead and, for regulator filings, the legal adviser.
7. **Recover.** Remove the attacker's access, patch the cause, restore from a clean backup if integrity is in doubt ([backup-and-recovery.md](backup-and-recovery.md)), re-enable service, watch closely for 7 days, rotate anything that was exposed even if you are unsure.
8. **Learn.** Within 5 working days write a blameless review: timeline, root cause, what worked, actions with owners and dates. Update this plan, the calendar and the vulnerability list. File the 72-hour detailed report and any CERT-In follow-up.

## Template: CERT-In report (fill the official form with these facts)

```
Reporter: [name, role, organisation: Fintranzact / [legal entity], contact phone and email]
Time incident occurred: [date time IST, or "unknown, earliest evidence"]
Time noticed: [date time IST]
Type of incident: [data breach / unauthorised access / ... ]
Systems affected: [API on Railway/AWS region ..., PostgreSQL database, ...]
Symptoms and how it was noticed: [...]
Data involved: [categories, e.g. business books, employee records, credentials; approximate number of organisations and people; not yet known]
IP addresses / indicators: [...]
Actions taken so far: [contained at HH:MM by ..., secrets rotated, ...]
Impact and next steps: [...]
Logs preserved: [yes, location, retention 180 days]
```

## Template: notice to a business customer

```
Subject: Security incident affecting your Fintranzact data

On [date] at [time IST] we found [one-sentence description]. It affected [what data of yours, for what period].
What we know: [facts]. What we do not know yet: [open questions].
What we have done: [containment, rotation, reporting to CERT-In on [date]].
What we suggest you do: [reset passwords for [users]; rotate your Razorpay keys and e-invoice password; tell affected employees/customers if you decide it is needed].
We will update you by [time]. Contact: [name, phone, email]. Incident reference: [id].
```

## Tabletop exercise

Twice a year (and after a major change): 45 minutes, a made-up scenario, read the plan aloud and walk each step, time the notification drafts. Scenarios to rotate: leaked Razorpay key in a log; stolen laptop with a logged-in GitHub; one organisation sees another's invoices; ransomware on the database host; an employee's selfies exposed. Record date, people, what failed, fixes. **Status: none held yet.**

## Contacts

| Who | Contact | Notes |
|---|---|---|
| CERT-In | incident@cert-in.org.in; cert-in.org.in | confirm current phone and form |
| Data Protection Board of India | [channel to be published when it is operating] | |
| Cyber-crime portal | cybercrime.gov.in, 1930 | for fraud and crime |
| Razorpay support | [account manager / support contact] | |
| Sandbox.co.in | [support contact] | |
| Hosting (Railway / AWS) | [support plan link, account id] | |
| GitHub / Vercel / Resend / MSG91 | [support links] | |
| Legal adviser | [name, phone] | |
| Insurance (if any) | [policy, 24x7 line] | |
| Our security mailbox | security@fintranzact.com (see `SECURITY.md`) | monitored by [name] |
