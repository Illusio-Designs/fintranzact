# Starter answers for security questionnaires

Owner: [security owner]. Last reviewed: 2026-10-09. Next review: each time before you send a questionnaire.

**STATUS.** Wording to copy and adapt. Each answer says honestly what exists **today**. Re-check against the [control status table](README.md#control-status) before sending, change "planned" lines when they become true, and never answer "Yes" to something only planned. Do not claim ISO 27001, SOC 2, PCI or any certification: none exists.

**Do you have an information security policy?** We have a written policy (information-security-policy.md) covering access, secrets, change control, incident response and vendors. It is approved by [name] and reviewed yearly. It has not been independently audited.

**Are you ISO 27001 / SOC 2 certified?** No. We follow the controls described in our security documents and can share them. We have not undergone a certification audit.

**Where is data hosted?** [Railway, region ...] today; moving to AWS [ap-south-1, Mumbai]. Backups [in the same provider and an encrypted copy elsewhere: confirm].

**Is data encrypted in transit?** Yes. HTTPS is required in production, with HSTS.

**Is data encrypted at rest?** Credentials we store on behalf of customers (their Razorpay keys, e-invoice and e-way bill logins, courier keys, two-factor secrets) are encrypted at application level with AES-256-GCM and a rotatable key. The database disks and backups are encrypted by [provider setting: confirm]. Some personal identifiers (for example employee PAN, Aadhaar and bank account numbers) are masked in the product but stored as ordinary database columns today; field-level encryption for them is planned.

**How are passwords stored? Do you support MFA?** Passwords are hashed with Argon2id. Users can enable authenticator-app two-factor authentication with backup codes, and an organisation owner can require it for admins or all members. SMS codes are not used.

**How do you control access to customer data?** Role-based permissions inside the product (owner, admin, accountant, HR, employee and others) with every query scoped to the customer's own business; staff access to production is limited to [two] named people with MFA and used only to support a customer who asked. Access reviews are quarterly (process; evidence available from [date]).

**Do you segregate customer data?** Logically: all data access is scoped by tenant and business, and a cross-tenant review was done (docs/security-cross-tenant-audit.md). In multi-tenant mode each organisation can have its own database.

**Do you do penetration tests?** Not yet by an independent party. One is planned before [date]. We run automated static analysis, dependency, secret and image scanning on every change.

**How do you manage vulnerabilities and patches?** Automated dependency audit failing on critical and high issues, Dependabot updates reviewed by a person, and fix targets of 7 days (critical), 30 (high), 90 (medium). Exceptions are time-limited (90 days) and recorded.

**Do you have an incident response plan? Breach notification?** Yes, written (incident-response-plan.md) but not yet exercised in a drill [update when done]. We commit to reporting cyber incidents to CERT-In within 6 hours of noticing, to notify affected customers [within 24 hours of confirmation], and, once the DPDP Rules take effect, to inform the Data Protection Board and send a detailed report within 72 hours.

**Backups and disaster recovery?** [Daily encrypted backups with N days retention.] RPO [..] and RTO [..] are targets we have not yet measured; a restore test is scheduled quarterly [from date]. Do not answer with numbers until a restore test has produced them.

**Do you log and monitor?** Business actions are recorded in an audit log, and sign-in security and access changes in a security event log. Application logs are kept by the host; a 180-day centralised retention and automatic alerting are planned.

**Do you use sub-processors / who gets our data?** See third-parties-and-data-flows.md: Razorpay, Sandbox.co.in, Resend, MSG91, Anthropic (only for the AI assistant, and only what the assistant's tools return), Cloudflare Turnstile, Vercel, Railway/AWS, GitHub. We will give 30 days' notice of changes [confirm with your terms].

**Do you use customer data to train AI models?** No. The AI assistant sends the question and the data its tools return to Anthropic's API to answer that question [confirm Anthropic's current API data-use terms and state them].

**Data retention and deletion?** Customers can export their books at any time. Attendance selfies are deleted automatically after a retention period the business sets (default 90 days). Deleting an organisation or a person's data on request is a documented manual process today, with a target of [30] days; backups age out after [30] days.

**DPDP Act readiness?** We have mapped the personal data we hold, the vendors and the retention rules, and have a plan for notice, consent, erasure and breach reporting. Notice and consent text is [pending legal review]. We do not claim compliance before the duties apply and have been reviewed.

**Payments / PCI?** We never see or store card or UPI details. Payments go through Razorpay's hosted pages; our server only creates payment links and verifies signed webhooks. Each business uses its own Razorpay account; the keys are encrypted at rest.

**Secure development?** All changes go through pull requests with required automated checks (tests, types, lint, licence scan, static analysis, secret scan, image scan). Dependencies are pinned in a lockfile.

**Physical security / HR screening?** We run no data centre; physical security is the cloud provider's. Staff screening and security training: [describe or state not yet formalised].

**Can we audit you / see your documents?** We can share the security documents and answer a call; a customer audit right is a contract matter for [legal].
