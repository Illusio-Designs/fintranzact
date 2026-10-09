# Third parties and data flows

Owner: [security owner]. Last reviewed: 2026-10-09. Next review: 2027-04-09 (and whenever a vendor is added).

**STATUS.** The "what data" column was checked against the code on the review date. Vendor terms, data-processing agreements, storage regions and the relationship owner are **not collected yet**: fill the bracketed cells. Links are the vendors' public terms pages as of writing; confirm them.

| Vendor | What data goes there (from the code) | Purpose | Where it is stored / by whom | Terms | Relationship owner |
|---|---|---|---|---|---|
| **Razorpay** | (1) Fintranzact's own account: subscription and add-on billing (amount, plan, the paying organisation's name and contact). (2) Each business's **own** Razorpay account: that business's key id and secret (stored encrypted by us) are used server-side to create payment links/orders for its invoices and store orders (amount, invoice number, customer name, phone, email) and to receive signed webhooks. Card and UPI details are entered on Razorpay's pages, never on ours or in our database. | Collect payments | Razorpay (India); we keep ids, status, masked key | razorpay.com/terms | [owner] |
| **Sandbox.co.in** | GSTINs for lookup; e-invoice and e-way bill payloads (invoice data: parties' GSTINs, addresses, items, values, vehicle details); GST return data (GSTR-1, 3B), TDS/TCS filing data; taxpayer session OTP and PAN for e-filing; HSN codes lookup | Government API gateway for GST/TDS | Sandbox; government portals (GSTN, NIC IRP) | sandbox.co.in terms and privacy [verify] | [owner] |
| **Resend** | Recipient email addresses, subject and body of invoices, reminders, invitations, sign-in and verification emails; PDF attachments of documents (invoice PDF); sender display name | Send email | Resend (US) [verify region]; delivery logs | resend.com/legal | [owner] |
| **MSG91** | Recipient mobile number and the template variables of a payment-reminder SMS (customer name, invoice number, amount, due date, business name); phone-verification OTP for the store | Send SMS (DLT template) | MSG91 (India) | msg91.com/terms [verify] | [owner] |
| **Anthropic** | For the AI assistant only: the person's question, the conversation so far, and **what the assistant's tools return** from the business's books to answer it (figures, document summaries, party names as needed). Nothing is sent unless someone uses the assistant. Browser speech recognition for voice input runs in the browser vendor's service and is not our data flow. | Language model for the AI assistant | Anthropic (US) [verify retention terms for the API / zero-retention option] | anthropic.com/legal | [owner] |
| **Cloudflare Turnstile** | The visitor's challenge token, IP address and browser signals (sent from the browser to Cloudflare; we send the token and IP to verify) | Bot protection on sign-up, contact and store forms | Cloudflare | cloudflare.com/website-terms | [owner] |
| **Vercel** | The web app's static files; browsers and the `/api` proxy requests pass through Vercel's network (so request bodies, including business data, transit it); access logs | Host the web app and proxy to the API | Vercel (global edge) | vercel.com/legal | [owner] |
| **Railway** (today) / **AWS** (planned) | Everything: the API, PostgreSQL database(s), backups, application logs | Hosting | Railway region [verify] / AWS region [ap-south-1 Mumbai recommended] | railway.com/legal; aws.amazon.com/service-terms | [owner] |
| **Backup storage** (R2/S3, if configured) | Encrypted database dumps | Offsite backups | Cloudflare R2 or AWS S3 [verify] | cloudflare.com / aws.amazon.com terms | [owner] |
| **GitHub** | Source code, issues, CI logs (no customer data; secret scanning keeps secrets out) | Code hosting and CI | GitHub (US) | docs.github.com/site-policy | [owner] |
| **Google Fonts** | The browser requests fonts from Google when a page loads (visitor IP) | Typography | Google | policies.google.com | [owner] |
| **Courier APIs** (if a business enables them) | Shipment details using that business's own credentials | Shipping labels and tracking | The courier | per courier | the business |

Notes

- Data leaves our systems only through the rows above. A new integration, a new field sent to an existing vendor, or analytics/error-tracking tools need a new row **before** release, and a line in the customer-facing privacy notice.
- Business customers use their own Razorpay, Sandbox and courier accounts or ours: when the business supplies its own credentials, the contract for that service is between the business and the vendor.
- For DPDP, vendors that process personal data for us are "data processors": we need written terms with them, a list of where the data is stored, and the ability to delete on request. Collect these [owner, by 2027-03].
- The `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `SANDBOX_API_KEY` and `MSG91_AUTH_KEY` are Restricted secrets ([secrets-management.md](secrets-management.md)).
