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

- Store Pro, and the later phases of Payroll and the AI business assistant.
  Their add-ons are hidden from sale until each feature is released (one switch
  per add-on, `ADDON_FEATURES[...].implemented`, re-enables it). Payroll Phase 1
  and the AI assistant Phases 1 and 2 (questions, then actions with a confirmation card) are built but stay hidden
  from sale until you release them; section 15 is what the AI assistant needs.
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

## 15. AI assistant (before you release the AI add-ons)

The AI assistant (Phase 1: ask questions about your business) is built and gated
but the add-ons are not on sale (`ADDON_FEATURES.ai_assistant` and `ai_plus`
`implemented` stay false until you decide). Organisations in the Full Access Trial
(50 questions) and organisations you grant the add-on to can use it, but only once
the server has an Anthropic API key.

### 15.1 Get an Anthropic API key and set it

1. Create an account at https://console.anthropic.com and add billing.
2. Create an API key (Settings, API keys). Name it for this app. **Never paste it
   in chat or commit it.**
3. Railway, API service, Variables: add `ANTHROPIC_API_KEY` with the key.
   Redeploy. Until then the assistant answers "not configured" and counts nothing.
4. Optional: `AI_MODEL_FAST` (default `claude-haiku-4-5-20251001`, used for simple
   questions) and `AI_MODEL_STRONG` (default `claude-sonnet-5-5`, used for
   comparisons and multi-step questions). Leave them unset unless you want to
   change a model.
5. **Set a monthly spend limit** in the Anthropic console (Settings, Limits) so a
   surprise cannot cost more than you decided. The assistant has its own quotas
   (150 / 500 questions a month, 50 in the trial), but the console limit is your
   safety net.
6. In the admin console (Organisations, "AI assistant usage and cost") check the
   **price table** is right for the exchange rate you want: it holds rupees per
   million tokens for each model and is only used to estimate cost. The defaults
   are estimates at about 85 rupees to the dollar.
7. Try it: open an organisation in a trial, click "Ask AI", ask "How much do
   customers owe me?" and a Hinglish question. Then check the admin usage table
   shows the question and an estimated cost.
8. Try the actions (Phase 2): ask it to "Create an invoice for <one of your
   customers>: 2 <one of your items>", look at the confirmation card, tap Edit to
   change a quantity, then Confirm. Check the invoice exists, and that Settings,
   Account, Activity log shows the invoice and the assistant's steps as "via AI
   assistant". Also try a WhatsApp payment reminder (the card shows the message;
   confirming only gives you a link, nothing is sent). Actions are **on by
   default** for every role that can do the action on the normal screens; you can
   switch them off for the organisation or per role in Settings, Team, AI
   assistant ("Allow the assistant to prepare actions"). These were only tested
   with a scripted model, so please watch how well the real model follows the
   rules (it should ask when a name matches several parties, and never say
   something is saved before you confirm).

### 15.2 Confirm the provider's data-use terms and the privacy wording

The privacy policy now has an "AI assistant" paragraph: data sent to the AI
provider is limited to what is needed to answer, and we do not use it to train
models. That is **our commitment**; it says nothing about the provider's own
terms. Before you release the add-ons:

- Read Anthropic's current commercial terms and data-use policy for the API and
  confirm they allow what the paragraph says (for example how long they keep API
  inputs and that they do not train on API data by default), and whether you need
  a zero-data-retention arrangement.
- Have your CA or lawyer confirm the wording in `apps/web/src/routes/privacy.tsx`
  (section "AI assistant") and tell me if it should change. If you name the
  provider in the policy, add it to the "Sharing" list too.
- The "Privacy policy: data not used for training" line on the Upcoming board is
  already ticked because the page text is in; only set the whole AI Phase 1 item
  to Done after this confirmation.

### 15.3 When you release it

Flip `ADDON_FEATURES.ai_assistant.implemented` (and `ai_plus`) to `true` in
`packages/shared/src/entitlements.ts` only after the checklist in section 16
(the AI add-on billing is built; it needs a live test in Razorpay Test Mode first).
Platform admins can grant the add-on and extra questions from the organisation's
page in the admin console before then.

## 16. AI add-on billing (how to release the AI add-ons)

The billing for the AI add-ons is built and tested with fake gateways: AI Assistant
(₹399 a month, 150 questions), AI Plus (₹999 a month, 500), monthly or yearly with
two months free, and extra packs (₹199 for 100 questions, one-time), all before 18%
GST, with a GST invoice from Finvera Solutions LLP and a receipt email. Nothing is on
sale yet: `ADDON_FEATURES.ai_assistant.implemented` and `ADDON_FEATURES.ai_plus.implemented`
are **false**, so no buy button appears anywhere and the server refuses every purchase.
How it works: [`architecture/ai-billing.md`](architecture/ai-billing.md).

### 16.1 Before you flip the flags (all of these)

1. **Anthropic key set** and the data-use terms confirmed: section 15.1 and 15.2.
2. **Razorpay Test Mode, your own account** (section 4.1): `RAZORPAY_KEY_ID`,
   `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` set. Check the webhook of
   the platform account sends these events (Razorpay Dashboard, Webhooks, the same
   URL as subscriptions: `/webhooks/razorpay`): `subscription.activated`,
   `subscription.charged`, `subscription.pending`, `subscription.halted`,
   `subscription.cancelled`, `subscription.completed` **and the new ones for packs**:
   `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`.
3. **Try it for real, in test mode**, on a test organisation (temporarily flip the
   two flags on a test deployment, not production):
   - subscribe to AI Assistant monthly: the Razorpay checkout opens, pay with a test
     card, the organisation shows "Active" in Settings, Billing, AI Assistant, and
     the invoice appears with a FIN number;
   - upgrade to AI Plus: the new subscription is paid, AI Assistant ends, you get a
     credit note for the unused time (it stands for a manual refund, like a plan
     upgrade: refund it in Razorpay if you want to honour it), you are never charged
     for both;
   - buy one pack, then three packs: the questions are added, the invoice is
     numbered, the receipt email arrives. Close the browser right after paying once
     and confirm the questions still arrive (the webhook);
   - refund a pack payment in the Razorpay dashboard: the unused questions are
     taken back and a credit note appears;
   - a failed test card on a pack grants nothing;
   - in the admin console: Organisations, then Plans, "Add-on prices" (edit and
     reset a price), and on an organisation "AI add-on and purchases" (grant free,
     revoke, see the purchases and invoices).
4. **Check the GST invoice with your CA**: the SAC code (the invoices print `998315`,
   the same as plan invoices, marked "verify with the CA" in the code; confirm it is
   right for online software/AI services, or tell me the right one), the 18% rate,
   the CGST/SGST versus IGST split by place of supply, and the wording of the pack
   line ("AI question packs, N x 100 questions").
5. **Confirm the prices and the rules**: ₹399 / ₹999 / ₹199 and "2 months free"
   yearly (they are editable in the admin console, no code needed), that packs do
   not expire, that they can only be bought while an AI plan or trial is active,
   and that a refund takes back the unused questions.
6. **Partner commission**: the partner program pays on plan subscriptions only,
   for every add-on (not just AI). Decide if that is what you want; adding add-on
   revenue is a small change, to be done for all add-ons together.

### 16.2 The flip

In `packages/shared/src/entitlements.ts`, in `ADDON_FEATURES`, change
`ai_assistant: { ..., implemented: false }` and `ai_plus: { ..., implemented: false }`
to `true` (a deliberate one-line change each) and deploy. That puts both tiers and the
extra packs on sale everywhere at once: the pricing page, Settings, Billing, the chat
panel's "Buy more questions", `billing.subscribeAddon`, `billing.changeAddon` and
`billing.buyAiPack`. Flip both together: the packs are on sale as soon as either is.
Then update the roadmap card for the AI item in the admin console.

To pull it back, set them to `false` again: new purchases stop, organisations that
already have the add-on keep it, and renewals, webhooks and cancellation keep working.

## 17. Payroll Phase 3: employee check-in, camera and location (before you release Payroll)

Payroll Phase 3 is built and gated; `ADDON_FEATURES.payroll.implemented` is still
false, so none of it is on sale. Design: `docs/architecture/payroll-self-service.md`.
What needs a person, not code:

1. **Mobile build and device test.** The employee screens need a new mobile build
   (new native modules: `expo-camera`, `expo-location`, `expo-image-manipulator`).
   Test on a real Android phone and a real iPhone: invite an employee, accept the
   link, accept the consent, check in with a selfie inside and outside a work
   location (try the Record, Warn and Block rules), deny the camera and location and
   see the messages, check out, open a payslip and a released Form 16, apply for and
   cancel leave. No camera, GPS or biometric hardware was available when this was
   built, so none of this has been run on a device.
2. **Store review for camera and location.** Apple and Google ask why the app uses
   the camera and location. The wording is in `apps/mobile/app.json` (plugins
   `expo-camera` and `expo-location`): camera for the attendance selfie, location
   once at check-in, **foreground only, never in the background**. Fill in the
   privacy "nutrition label" (Apple) and the Data safety form (Google): photos and
   precise location, collected for attendance, linked to the user, not used for
   tracking or advertising. Read the wording and change it if it is not how you
   describe the app.
3. **Privacy policy wording.** The help page "Attendance photos and location:
   privacy" states what is collected, who sees it, 90-day selfie retention by
   default and that nothing goes to the AI assistant. The privacy policy page
   (`apps/web/src/routes/privacy.tsx`) has **not** been changed. Have the policy
   reviewed and add a sentence such as: "If your employer uses FinTranzact
   attendance, we process the selfie, one location reading and the time of each
   check-in on your employer's behalf, show them only to your employer's
   authorised staff, and delete selfies after the retention period your employer
   sets." This needs your confirmation before it is published.
4. **CA or legal review of attendance-photo consent.** The consent text
   (`ATTENDANCE_CONSENT_VERSION` in `packages/shared/src/payroll-self.ts`) is a
   plain-language notice, not legal advice. Have a CA or lawyer check it against
   employment and data-protection requirements for photographing and locating
   employees. If the wording changes, change the version so everyone is asked again.
5. **Biometric devices.** Only file import and the push endpoint are built. Try one
   real device export (and, if the vendor supports it, a push to
   `POST /api/attendance/push` with a device key) and tell us if the column layout
   is not recognised.

## 18. Payroll Phase 4: bonus, gratuity, full and final, loans (before you release Payroll)

Payroll Phase 4 is built and gated; `ADDON_FEATURES.payroll.implemented` is still
false, so none of it is on sale. Design and every assumption:
`docs/architecture/payroll-phase-4.md`. What needs a person, not code:

1. **Have your CA confirm bonus and gratuity** (the roadmap line "CA verification of
   bonus and gratuity rules" is deliberately NOT ticked). Give the CA the Phase 4
   section of `docs/PAYROLL-CA-VERIFICATION.md`: it lists every rule, rounding and
   assumption (the bonus calculation wage and eligibility tests, the 8.33 to 20
   percent range, the gratuity formula and the Contract-means-fixed-term assumption,
   leave encashment, the order of a full and final settlement, loan interest and EMI
   rounding, the 50 percent recovery cap, and that TDS on a settlement and tax on
   gratuity are NOT calculated).
2. **Enter the bonus figures for each financial year.** The eligibility ceiling, the
   calculation ceiling and the minimum wage ship EMPTY on purpose (Payroll, Statutory
   settings, Bonus and gratuity). A bonus run refuses to calculate until they are set.
   Fill the "last verified" note once your CA has confirmed them.
3. **Check the accounts.** Phase 4 creates these accounts in each business the first
   time they are needed: 1260 Loans and Advances to Employees, 4110 Interest on Staff
   Loans, 2440 Bonus Payable, 2441 Gratuity Provision, 2442 Full and Final Settlements
   Payable, 5205 Salary - Gratuity. If a business already used one of those codes for
   something else, a "P"-prefixed code (for example P1260) is made instead. Ask your CA
   whether the account names and the gratuity provision policy suit your books.
4. **Legal wording.** The relieving letter wording and the registers are working
   copies. Have a lawyer or CA check the letter text, and arrange the registers in the
   form your state requires (Shops and Establishments, Contract Labour...). Nothing is
   digitally signed.
5. **Try it in a browser.** The screens were tested with component tests only, never
   in a real browser: run a bonus year, a loan, and a settlement end to end once.
