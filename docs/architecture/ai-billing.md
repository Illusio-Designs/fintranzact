# AI add-on billing: AI Assistant, AI Plus and extra question packs

How an organisation pays for the AI add-ons. It extends the **existing** billing machinery (subscriptions, GST invoices from Finvera Solutions LLP, the Razorpay webhook, the lazy grace period, the admin console); nothing here is a parallel system. The assistant itself is described in [`ai-assistant.md`](ai-assistant.md); entitlement rules are in [`../ENTITLEMENTS.md`](../ENTITLEMENTS.md).

**Release switch.** `ADDON_FEATURES.ai_assistant.implemented` and `ADDON_FEATURES.ai_plus.implemented` (`packages/shared/src/entitlements.ts`) **ship `false`**. While they are false nothing about the AI add-ons or the packs can be bought, on any surface and on the server. The owner releases them later with a deliberate one-line change per flag (see [`../PENDING-OWNER-TASKS.md`](../PENDING-OWNER-TASKS.md), section 16). Everything below is built and tested for the flag being true: tests turn it on through the existing seam (mutating `ADDON_FEATURES` and restoring it) and one test asserts the shipped values are false.

## What exists, and what was reused

| Need | How it works | New or reused |
|---|---|---|
| Subscribe, monthly or yearly | `billing.subscribeAddon` creates a **separate Razorpay subscription per add-on** (the existing design: add-ons are not lines on the plan's subscription), a `billing_subscriptions` row of kind `addon`, and on activation a captured `billing_payments` row that is the GST invoice | Reused |
| Yearly = "2 months free" | `cycleAmount` / `planCheckoutAmount`: ten months' price; an optional explicit yearly price | Reused |
| Editable prices | New: `billing.addon_prices` in `system_config` (admin console, Plans view, "Add-on prices"), with `getAddonPrices` (30 s cache) and pure `effectiveAddonPrice` / `addonCycleAmount` in shared. Plans have `plan_settings`; add-ons had no override at all, so this is the add-on equivalent. It covers every add-on, plus the pack price (`ai_pack`). A bad stored value falls back to the built-in price | New, same idea |
| AI Plus replaces AI Assistant | `ADDONS[].group = "ai"` already made `startCheckout` refuse a second tier ("cancel it first"). New: `billing.changeAddon` for the switch, see below | Extended |
| GST and invoices | `recordPayment`, `billing_invoice_seq` (FIN-00001 series), `invoice-pdf.ts`; CGST+SGST or IGST by `billingPlaceOfSupply`; SAC is the one the existing subscription invoices print (`998315`, flagged "verify with the CA" in the code; the task brief said 998314, so this is a question for the CA, not a code change) | Reused |
| Grace period, unpaid | `recordRenewalFailure` (past_due + 7 days), `applyLazyTransitions` (halted on the next read), `deriveAccess` (add-on live while active, or past_due inside grace) | Reused; one fix, below |
| One-off platform charge | None existed. New: Razorpay **Orders** on the platform keys (`gateway.createOrder`), `ai_pack_orders`, signature check and `payment.captured` webhook | New, smallest correct |
| Admin grants an add-on free | Only a database insert existed (`grantAddon` test fixture). New: `platform.grantAddon` / `revokeAddon` (a `billing_subscriptions` row with provider `admin`, price 0, no period end) | New |
| MRR and subscription views | `platform.subscriptions` / `billingSummary` already list every add-on row; an admin grant has price 0, so it is counted but adds no revenue | Reused |
| Receipt email | There was no subscription receipt email. The pack purchase sends one with `emailService.sendNotice` (to the billing email, else the owner) | New |

**The Razorpay model is unchanged.** Subscriptions and pack orders use the PLATFORM keys (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`). A business's own Razorpay keys (`razorpay_connections`) are for its customers and are never read here. Without platform keys the demo gateway runs exactly as before (`DEMO_PAYMENTS` rule unchanged): a subscription activates at once and a pack order is paid at once, with a real invoice and grant.

## Prices (ex-GST, editable in admin)

| Item | Built-in | Notes |
|---|---|---|
| AI Assistant | ₹399 a month, 150 questions | yearly: 10 x 399 = ₹3,990 |
| AI Plus | ₹999 a month, 500 questions | yearly: 10 x 999 = ₹9,990 |
| Extra pack | ₹199 for 100 questions, one-time | 1 to 50 packs per order; GST is taken on the order total |

18% GST is added (`gstOnPaise`). Examples: AI Assistant monthly 39,900 + 7,182 = 47,082 paise; one pack 19,900 + 3,582 = 23,482; three packs 59,700 + 10,746 = 70,446. A price edit affects new purchases only: the price is frozen in `billing_subscriptions.base_paise` and `ai_pack_orders.base_paise`, and the gateway mints a new Razorpay plan per amount (`ensureRazorpayPlan`), so running subscriptions keep their price.

## Tier changes (never billed for both)

`billing.changeAddon({ addon, cycle })` (owner only), `lib/billing/addon-service.ts`:

- **Upgrade** (another tier that costs more per month, so Assistant to Plus): applies now. `startCheckout` creates the new subscription with `replaces_subscription_id` pointing at the live one. The old tier is **not** touched until the new one is paid: `activateSubscription` (which both the Razorpay callback and the webhook go through) calls `retireReplacedAddon`, which cancels the old Razorpay subscription immediately, marks the row cancelled and records a **credit note** for the unused time (`prorationCreditPaise`). The new subscription's first invoice is the full price; with Razorpay the credit note stands for a manual refund, exactly as plan upgrades are documented (`changePlan`). A gateway failure while cancelling the old subscription is recorded (`subscription.replace_cancel_failed`) and never thrown, because the money for the new tier is already taken. With the demo gateway the swap happens in the same call. If a Razorpay checkout is abandoned the old tier simply keeps running.
- **Downgrade** (Plus to Assistant) and **cycle change** on the same tier: scheduled for the period end (`scheduled_addon`, `scheduled_cycle`; the old gateway subscription is cancelled at cycle end). `applyLazyTransitions` ends it and starts the new one when the period is over; demo activates it, Razorpay creates the checkout the owner completes (the same limitation plan downgrades have).
- A new purchase of a tier while another is live is still refused (`CONFLICT`), so there is no way to hold both. `cancelSubscription` clears a scheduled switch.
- An add-on granted by an admin (provider `admin`) cannot be cancelled or switched by the owner (`CONFLICT`: ask us); the admin revokes it.

## Extra question packs (one-time)

`billing.buyAiPack({ packs })` then `billing.verifyAiPackPayment({ orderId, razorpayPaymentId, razorpaySignature })`, `lib/billing/ai-packs.ts`. Table `ai_pack_orders` (control, unique `provider_order_id`, unique `provider_payment_id`).

```
owner ─ buyAiPack ─▶ price (packs x pack price, then GST) ─▶ Razorpay POST /orders (platform keys)
                     ai_pack_orders row `created`            demo: paid at once
owner ─ Razorpay Checkout (order_id) ─▶ payment
        ├─ verifyAiPackPayment: HMAC-SHA256("<order_id>|<payment_id>", key secret) checked on the SERVER
        └─ webhook payment.captured / order.paid (signature-checked like every Razorpay webhook)
                     └─▶ fulfilPackPayment (idempotent): lock the order row FOR UPDATE; if unpaid:
                          billing_payments `captured` (GST invoice, FIN series) + ai_credit_grants row
                          (source "purchase", reason "purchase", payment_id, order_id) + order `paid`
                          + billing_events `ai_pack.paid`, one transaction; then the receipt email
```

- **Idempotent by order.** The row lock makes a webhook racing the callback, a redelivery, a second event id for the same payment, or a replayed callback grant **once** (tested with six concurrent calls). `ai_credit_grants.payment_id` and `ai_pack_orders.provider_payment_id` are unique, so the same payment can never pay two orders or grant twice even if the code were wrong.
- **Amount check.** The webhook carries the amount captured; if it is not the order's total nothing is granted, the event is acknowledged (a retry would fail the same way) and `ai_pack.payment_rejected` records it with the error.
- **Pack events are not deduplicated by event id up front** (subscription events are). The audit row is written after the work succeeds, so a delivery that failed half way is simply handled again on redelivery.
- **Failed payment** (`payment.failed`): the order becomes `failed`, nothing is granted, no invoice number is used. A later successful payment on the same Razorpay order still fulfils it (Razorpay allows retries on one order); a late failure notice never undoes a paid order.
- **Refund** (`refund.processed`): the **unused** credits are taken back (all of them for a full refund; the refunded share, capped at the unused ones, for a partial one), questions already asked are not recovered, a numbered credit note is recorded, a full refund marks the order `refunded`. Idempotent per refund id. A refund therefore never leaves credits granted.
- **Credits do not expire** in Phase 1. They are used after the monthly included questions, oldest pack first (the existing `consumeQuestion`).
- **Who can buy.** Billing is the **organisation owner's** in this codebase (`PLAN_MANAGER_ROLES = owner, superadmin`, `requirePlanManagerTenant`); an admin cannot buy, which matches `subscribeAddon`. The request said "owner/admin"; the existing rule was followed. Refused while the add-ons are not on sale (`BAD_REQUEST`, the coming-soon message) and for an organisation with no AI access (an AI plan, an admin grant or a trial is needed, because the questions are used by the assistant, which needs one).
- **Placement**: the REST webhook is the existing `POST /webhooks/razorpay` (policy `exempt-webhook`, unchanged); no new REST route.

## Unpaid and lapsed (grace behaviour)

1. A renewal fails: `past_due`, grace until +7 days (`recordRenewalFailure`). The add-on keeps working during grace.
2. Grace over: the next read flips the add-on to `halted` (`applyLazyTransitions`; no scheduler). `deriveAccess` turns the add-on off, so `requireAddon` refuses with the existing `addon_required` message ("This feature needs an add-on. Add it from Settings, Billing."). A halted **add-on** does not make the organisation read-only (only a halted plan does).
3. **Chats stay readable and nothing is deleted.** Fix in `lib/ai/access.ts`: for an organisation that **ever held** an AI add-on, `ai.conversations` / `ai.conversation` keep working after it lapses (before, only a read-only organisation could read; an organisation that never had the add-on is still refused, so the existing tests are unchanged). Asking, and deleting a chat, need the add-on again. The chat panel shows its add-on notice instead of the history while the add-on is off (a screen for reading old chats while inactive is not built).
4. **Purchased credits stay, unused and unusable.** `loadAiAccount` returns no account without an AI tier, so no question can consume them; they wait. Buying more is refused while there is no AI access. Buying the add-on again (`startCheckout` retires a halted add-on of the same group, as a halted plan is retired) brings the assistant and the saved credits back.
5. A read-only plan (halted plan subscription) turns every add-on off, as before.

## Admin console (`platform.*`, platform admins only)

| Procedure | What |
|---|---|
| `addonPrices`, `saveAddonPrices` | Price rows for every add-on (monthly and optional yearly) and the AI pack price. Entries equal to the built-in price are not stored; an empty yearly price means ten months |
| `grantAddon`, `revokeAddon` | Give an add-on free (provider `admin`, price 0, no end date) or take the grant back. Refused with `CONFLICT` while another tier of the same add-on is live, so an organisation is never on both; a halted or half-finished row gives way to the grant. A paid subscription is never touched by a revoke |
| `aiPurchases` | The organisation's live add-ons and its pack orders with credits bought, credits left and the GST invoice number; shown next to the existing credits section on the organisation page |
| existing `aiCredits`, `grantAiCredits`, `aiUsage`, `aiPrices`, `saveAiPrices` | Unchanged (a purchased grant now shows `source: "purchase"`) |

Every state change writes a `billing_events` row (the billing audit trail; the tenant audit log is business-scoped and cannot hold organisation billing): `checkout.started`, `subscription.activated`, `subscription.addon_upgrade_started`, `subscription.addon_switched`, `subscription.addon_downgrade_scheduled`, `subscription.addon_downgraded`, `subscription.cancel_scheduled`, `ai_pack.order_created`, `ai_pack.paid`, `ai_pack.failed`, `ai_pack.refunded`, `ai_pack.payment_rejected`, `platform.addon_granted`, `platform.addon_revoked`, `platform.addon_prices_changed`, each with the acting user where one exists.

## Partner commission

The partner program (`lib/partner-program.ts`) counts only **plan** subscriptions and plan prices; the code takes no commission or badge credit on **any** add-on today, including Payroll (the Payroll roadmap text says commission applies to Payroll, but the code does not do it). AI follows the code: no commission or badge credit on AI add-ons or packs yet. Adding add-on revenue to `getPartnerStats` would cover Payroll, Store Pro and AI together; it is left as a decision for the owner.

## Data model (control database)

Migrations: unified `0068_ai_billing`, control `0024_ai_billing`; no tenant tables, so no tenant migration, data-audit or self-export change.

| Change | Why |
|---|---|
| `ai_pack_orders` (tenant, packs, credits, base and total paise, provider, provider order id, provider payment id, status, payment id, grant id, failure reason, created by) | The one-time order; unique order id and payment id |
| `ai_credit_grants.payment_id` (unique where set), `order_id` | Links a purchased grant to its invoice row and order; one payment grants once |
| `billing_subscriptions.scheduled_addon`, `replaces_subscription_id` | A scheduled tier switch, and the tier an upgrade retires when it activates |
| `system_config` key `billing.addon_prices` | The editable add-on and pack prices |

## Web

Settings, Billing: `components/settings/AiBillingSection.tsx` (tier, used / included, extra credits left, next reset, subscribe / upgrade / switch / cancel, a quantity stepper for packs, the purchases list). Hidden while neither tier is on sale, unless the organisation already holds the add-on (then it shows the allowance with a "coming soon" note and no buy controls). Checkout opens through the existing `openRazorpayCheckout` (extended with `orderId`); the demo path buys at once. Chat panel: when the questions run out and packs are on sale, the owner sees "Buy more questions" (to Settings, Billing) and everyone else "Ask your owner". Pricing page: the existing add-ons section already hides unreleased add-ons; it now reads the prices in force from `billing.config` and mentions the pack. Admin: `components/platform/AddonBillingAdmin.tsx` (`AddonPriceEditor` in the Plans view, `AiPurchasesSection` on the organisation page).

## Tests

Shared (`__tests__/ai-billing.test.ts`): prices, GST, pack amounts and limits, overrides, reset date, availability flags. API integration (`integration/ai-billing.test.ts`, real Postgres, fake Razorpay behind a stubbed `fetch`, no network): shipped state refuses everything; subscribe monthly and yearly; Razorpay mode; tier upgrade and downgrade and never two live; gateway failure on retire; pack purchase on demo and Razorpay (valid and invalid signature, another organisation's order, duplicate and racing confirmations, same payment id twice, wrong amount, failed then paid, full and partial refund); webhook signature rejection over HTTP; credits used after the included questions; grace and lapse (blocked, chats readable, credits kept, re-buy); owner-only; admin prices, grants, purchases view and MRR; audit events; the receipt email; the invoice PDF and the CGST/SGST/IGST split. Web: `AiBillingSection.test.tsx`, `AiAssistantPanel.test.tsx` (buy-more action), `addon-billing-admin.test.tsx`. No test calls Razorpay or the network.

## Not built

- Live verification with a real Razorpay account (needs your keys, test mode; see the owner checklist).
- A screen to read old chats while the add-on is lapsed (the server allows it).
- Partner commission and badge credit on add-ons (see above).
- Payroll's per-employee metering: not part of this work; the admin price editor covers Payroll's and Store Pro's flat prices too.
