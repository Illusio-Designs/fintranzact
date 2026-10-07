# Pending: what the owner has to do, and how

Everything that can be built without you is built and merged. What is left needs
your accounts, your money, your CA or a live system. This page lists each task,
why it matters, and the exact steps. Do them roughly in this order; each section
says what it depends on.

Last updated: 6 October 2026. Code state: main at the Razorpay payments, store
checkout, delivery charge and mobile goods-receipt work.

---

## 0. The order of work (short version)

1. Back up the database.
2. Fill in `.env.production` and put the values on Railway (API) and Vercel (web).
3. Deploy the API. Migrations run on start.
4. Smoke check the live site.
5. Razorpay: platform webhook, then one test business with its own keys.
6. Live test pass in Razorpay Test Mode (payments, refund, store order).
7. Store policy pages: fill, check, give the links to Razorpay.
8. Sandbox: quote, test keys, smoke test, test-environment run.
9. CA sign-off.
10. Tidy the Upcoming board and delete old branches.
11. Go live (Razorpay and Sandbox live keys) only after 6 and 8 are clean.

---

## 1. Backup (do this first, every deploy)

- Take a snapshot of the Railway Postgres (Railway → the Postgres service →
  Backups, or `pg_dump` to a file you keep).
- Why: the release adds new tables and columns. The container runs the
  migrations on start and refuses to start if one fails, so your data is safe,
  but a snapshot is the way back.

## 2. Environment variables

Use the blank template at `.env.production` in the repo root (it is gitignored,
never commit it, never paste it in chat).

### 2.1 API (Railway → API service → Variables → Raw Editor)

| Variable | What to put | Notes |
|---|---|---|
| `DATABASE_URL` | Reference to the Railway Postgres `DATABASE_URL` | Fills itself when referenced |
| `NODE_ENV` | `production` | |
| `PORT` | `3000` | |
| `ENCRYPTION_KEY` | 64 hex characters | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Never change it later: saved Razorpay and e-invoice credentials become unreadable |
| `CORS_ORIGINS` | Your web address, e.g. `https://fintranzact-web.vercel.app` | |
| `APP_URL` | Same web address | Used for email links and for sending customers back after paying |
| `API_URL` | Your public API address, `https://fintranzact-production.up.railway.app` | Shown in the webhook URLs businesses copy |
| `STORE_URL` | Your public store address | Where shoppers return after paying in a store |
| `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD`, `PLATFORM_ADMIN_NAME` | Your admin login | Created at first start; change the password in the app afterwards |
| `RESEND_API_KEY`, `EMAIL_FROM`, `CONTACT_INBOX` | Resend key; a sender on a domain you verified in Resend | Without a key, emails only print to the log |
| `TRIAL_CLAIM_SALT` | Any long random string | Never change it later (it resets "one trial per business") |
| `FINVERA_GSTIN` | Finvera Solutions LLP's GSTIN | Prints on subscription invoices. `FINVERA_STATE_CODE` defaults to 24; `FINVERA_ADDRESS` optional |
| `SANDBOX_API_KEY`, `SANDBOX_API_SECRET` | Start with the **test** pair (`key_test_...`) | See section 7 |
| `SANDBOX_MONTHLY_QUOTA` | Your Sandbox plan's calls per month | Optional, for the 80% / 100% alerts |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | **Your** Razorpay account, for subscription billing only | Leave blank to keep the demo checkout. See section 4.1 |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret | Bot protection on the public store |
| `SHIPPING_WEBHOOK_SECRET` | Any long random string | Only if you use shipping carriers |
| `SMS_PROVIDER`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` | Only after section 6 | Leave out until then. Optional `MSG91_TEMPLATE_VARS` |
| `MULTI_TENANT`, `CONTROL_DATABASE_URL` | `false` and blank for a single database | Only for the multi-database cloud setup |

**Never set in production:** `TRIAL_CLAIMS=off`, `TRIAL_REMINDERS=off`,
`PAYMENT_REMINDERS=off`, `DISABLE_RATE_LIMIT=1`, `DEMO_PAYMENTS=true`. They are
test-only switches.

### 2.2 Web (Vercel → web project → Environment Variables)

Only public values go here; never a secret.

- `VITE_TURNSTILE_SITE_KEY`: the public Turnstile site key.
- `VITE_SITE_URL`: only if you use a custom domain (default is
  `https://fintranzact-web.vercel.app`).
- Redeploy the web project after changing a variable.
- The web app already forwards `/api/...` to
  `https://fintranzact-production.up.railway.app` (see `apps/web/vercel.json`).
  Webhooks are **not** under `/api`, so they must use the Railway address
  directly (section 4).

## 3. Deploy and first checks

1. Redeploy the API on Railway (it builds from the root `Dockerfile`).
2. Watch the deploy logs. You should see `Running database migrations...` then
   `Starting Fintranzact API server`. A migration error stops the start; copy the
   error text (not the variables) and send it to me.
3. Open `https://<your-api>/health`: it should answer OK.
4. Sign in as the platform admin. Open **Upcoming** once (this applies the
   roadmap ticks to the live board).
5. Sign up a throwaway account:
   - the form asks for a mobile number;
   - a 14-day Full Access Trial banner appears;
   - signing up again with the same number or email gives no second trial.
6. Open the public pricing page: plans and prices show, and **no add-ons** show.

Migrations that apply on this release (nothing manual): unified 0055 to 0064,
control 0018 to 0022, tenant up to 0038. Keep the API at **one copy** while the
migrations run.

## 4. Razorpay

There are two separate uses. Do not mix the keys.

### 4.1 Your own Razorpay account (subscription billing only)

Customers paying you for a plan.

1. Razorpay dashboard → Account & Settings → API Keys → generate keys (Test
   Mode first). Put `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` on Railway.
2. Settings → Webhooks → Add New Webhook:
   - URL: `https://fintranzact-production.up.railway.app/webhooks/razorpay`
   - Secret: a long random string; the same value goes in `RAZORPAY_WEBHOOK_SECRET`.
   - Events: `subscription.activated`, `subscription.charged`,
     `subscription.pending`, `subscription.halted`, `subscription.cancelled`,
     `subscription.completed`.
3. Redeploy the API. Subscribe a test organisation to a plan with a Razorpay
   test card: the plan should switch to active, and the delivery in Razorpay's
   webhook page should show 200.
4. For live: repeat with Live Mode keys and a Live Mode webhook. Test and live
   have separate keys and separate webhooks. Your Razorpay account must be
   activated for live payments.

### 4.2 Each business's own Razorpay (their customers paying them)

Money goes straight to the business's own Razorpay account and bank. Your keys
are never used for it. Each business does this once (you do it for a test
business first):

1. In the web app: Settings → Online payments. Paste the business's Razorpay
   key id, key secret and a webhook secret; click **Test connection**.
2. In **that business's** Razorpay dashboard: Settings → Webhooks → Add. Paste the
   webhook URL the app shows (it contains a private token), the same webhook
   secret, and tick these events: `payment_link.paid`,
   `payment_link.partially_paid`, `payment_link.cancelled`,
   `payment_link.expired`, `payment.captured`, `payment.failed`.
3. Optional: add a bank account of type Payment Gateway named "Razorpay" so the
   gateway charge is booked as an expense automatically.

### 4.3 Live test pass (Razorpay Test Mode), before any business uses it

Use a test business with a Razorpay **test** connection. Check each result in the
app (invoice, payment, bank/gateway entries) and in Razorpay's dashboard:

1. **Invoice payment link:** create an invoice, open it, click Pay online, pay
   with a test card/UPI. The invoice should become Paid and the payment appear
   once. Try a part payment: status Partial.
2. **Pay now on the share page:** open the invoice's share link signed out, click
   Pay now.
3. **Store order (online):** in a store with a delivery fee, place an order and
   pay online. The order and its invoice become paid; the confirmation email
   arrives.
4. **Failed payment and retry:** fail a payment on purpose; the order stays
   unpaid and "Pay again" works; the retry email is sent at most once per 6 hours.
5. **Refund:** cancel a paid order with a full refund, then another with a
   partial refund. Check the credit note, the order status (refunded or
   partially refunded) and the refund in Razorpay.
6. **Cash on delivery:** switch online payment off; the order is created as COD.
7. **Duplicates:** in Razorpay's webhook page, resend a payment event. The app
   must not record a second payment.
8. **Reminders:** turn payment reminders on for the test business and use "Send
   reminder now" to your own email; the message should carry the pay link.

Anything that does not match: send me the step and what you saw.

## 5. Store policy pages (needed by Razorpay before it approves online payments)

1. Web app → Settings → Online Store → Policy pages: open each of the five tabs
   (Terms, Refund, Shipping, Contact, Privacy). Click "Fill in my details" where
   text is missing. Set the Return Window (days). Save each page.
2. Copy the five links ("Copy all links"). Open each in a private window, signed
   out. You should see your business name, address, phone, email, and no leftover
   `{{ }}`.
3. Open your store as a shopper: the footer and the checkout page must link all
   five pages.
4. Give Razorpay the **plain page** links (`<API address>/store/<store>/policies/<page>`):
   they load without JavaScript, which a reviewer's tool may need. Paste them
   where Razorpay asks for your Terms, Refund, Privacy, Shipping and Contact
   pages when you add your website.
5. If Razorpay needs the pages on the store's own domain, tell me; I add a
   redirect rule (needs your live API address).
6. Tick "Public URLs per page for Razorpay review" on the Upcoming board.

Also set the **delivery fee** (and optional free-delivery threshold and note) in
Settings → Online Store, if the store ships.

## 6. SMS reminders (optional, needs your provider)

SMS is built but off until you have:

1. An MSG91 account and an India **DLT registration** (sender ID plus an approved
   message template). This takes days and is done by you with MSG91.
2. Then set `SMS_PROVIDER=msg91`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` (and
   `MSG91_TEMPLATE_VARS` if your template needs it) on Railway and redeploy.
3. The SMS checkbox in Settings → Payment reminders then becomes usable. The
   customer receives your DLT-approved template, not the wording shown in
   settings. Tell me when done and I tick the "SMS reminders" line.

## 7. Sandbox.co.in (e-invoice, e-way bill, GST returns, GSTIN and HSN lookup)

1. Send Sandbox the five questions and get the **written quote**.
2. Create the test account and keys in the Sandbox console. Put the `key_test_...`
   pair on Railway (`SANDBOX_API_KEY`, `SANDBOX_API_SECRET`). **Never paste the
   keys in chat.**
3. Run the smoke test against the test host from a machine that has the keys in
   its environment: `pnpm sandbox:smoke`. Send me the printed report (it never
   prints the keys).
4. Test-environment run of the flows with a test GSTIN: e-invoice, e-way bill,
   GSTR-1 and GSTR-3B filing (the wizard), GSTIN search when saving a party, HSN
   lookup. Note anything that fails.
5. Keep the wallet funded: when it is empty customers see a friendly "service
   unavailable" message and you get an hourly alert.
6. Send me the Sandbox docs pages for **GSTR-2B pull**, **Generate Taxpayer
   Session** and **GST Return Status** so I can build them.
7. Only after steps 3 and 4 are clean: Startup plan and the live keys.

## 8. CA (chartered accountant) sign-off

Give your CA `docs/GST-RETURNS-CA-VERIFICATION.md` and
`docs/SUBSCRIPTION-GST-CA-CHECKLIST.md`. For Payroll (before it is released), also
`docs/PAYROLL-CA-VERIFICATION.md`: every statutory default, rule and file layout
(PF, ESI, professional tax, LWF, TDS on salary, ECR, ESIC, Form 24Q, Form 16).
They need to confirm:

- TDS & TCS sections, rates and thresholds.
- GSTR-4 tables and due dates (composition dealers).
- GSTR-3B credit-use order and set-off.
- GST on the **store delivery charge** (the app reuses the invoice's charge
  treatment: the highest rate on the order's lines; the CA must confirm this).
- Subscription invoices from Finvera Solutions LLP: SAC 998315, place of supply
  rules, 18% GST on the plan price.

Tick the matching lines on the Upcoming board when confirmed.

## 9. Check the admin console once

- **Plans:** prices and limits are what you intend (Starter, Growth, Business).
- **Trial settings:** length 14 days, partner trial 30 days.
- **Partners:** payouts, if you run the partner programme.

## 10. Upcoming board (manual status changes)

The board applies ticks automatically (once, when an admin opens it after the
deploy) but it never moves an item that is already "In progress". Set these to
**Done** by hand once you have tested them: P3 Checkout (after the Razorpay live
pass), P4, P5, Two-factor authentication, Accountant (CA) access, HSN/SAC
verification, Online payments at store checkout (after 4.3), Store policy pages
(after section 5). Leave P2 open (add-on caps wait for the add-ons).

## 11. Branches

Only `main` and the working branch should remain. Delete the rest in GitHub →
Branches, or:

```
git push origin --delete claude/busy-thompson-nse8q2 claude/sandbox-smoke
```

Then GitHub → Settings → General → "Automatically delete head branches" so merged
branches clean themselves up.

## 12. Mobile app

The mobile screens (goods receipts, batch pickers, reminders, store order
payment details) need a **new mobile build**. After building, test on a phone:
create a goods receipt with a batch-tracked item, sell a batch-tracked item and
check the earliest-expiry-first picker and the expiry warnings, edit an invoice
that has batches, and open a reminder history.

## 13. Not built yet (so nothing for you to do)

- Payroll, the AI business assistant and Store Pro features. Their add-ons are
  hidden from sale until each feature exists (one switch per add-on re-enables
  it).
- Approvals (not on the Business plan until the approval workflow exists).
- GSTR-2B pull, Taxpayer Session, GST Return Status (waiting for the Sandbox
  pages in section 7).
- Batch-wise stock report on mobile; GRN edit screen and purchase-order link on
  mobile.
- Delivery by weight or zone, and shipping carrier rates.

## 14. If something goes wrong

- **API does not start:** read the deploy log; a migration error names the file.
  Restore the snapshot if needed, then send me the error text.
- **Webhook shows 401 or "signature" errors:** the webhook secret in the app (or
  in `RAZORPAY_WEBHOOK_SECRET`) does not match the one in Razorpay. Re-copy it
  without spaces.
- **Webhook shows 404 or timeout:** the URL is wrong or points at the web
  address. Webhooks must use the Railway API address.
- **A payment is in Razorpay but not in the app:** check the business has the
  webhook added in its own Razorpay dashboard with the six events ticked, and
  that the webhook secret matches.
- **Emails do not arrive:** check `RESEND_API_KEY`, and that the sender domain is
  verified in Resend.
- **Customers see "service unavailable" on GST filing:** the Sandbox wallet is
  empty or the quota is used.
