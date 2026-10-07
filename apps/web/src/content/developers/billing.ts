import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

export const billingEndpoints: EndpointGroup = {
  id: "billing",
  title: "Billing status",
  description:
    "What the organisation may do right now: free, trialing, active, payment overdue, read-only or suspended. While **read-only** (trial over, payment failed past the grace period, or plan ended) every read, search, PDF download and export still works, but anything that creates or edits data is refused with `FORBIDDEN` and a message starting `Choose a plan`. Clients branch on `error.data.entitlement.reason`, never on the message.",
  endpoints: [
    {
      id: "billing-status",
      method: "query",
      path: "billing.status",
      title: "Get Billing Status",
      description:
        "Lightweight status for the banners every member sees: the access state, whether the organisation is read-only, the trial countdown, the end of the past-due grace period, the active add-ons and the plan features in force. Open to every member of the organisation (unlike the owner-only Billing overview), and it works while the organisation is read-only or suspended.",
      auth: "protected",
      input: [],
      output: {
        description:
          "`state` is one of `free`, `trialing`, `active`, `past_due_grace`, `halted`, `trial_expired`, `ended`, `suspended`. `reason` and `message` are set only while read-only or suspended. `canManageBilling` is true for owners (and platform superadmins): show a \"Choose a plan\" button to them and \"Ask your organisation owner\" to everyone else. `trial` is the Full Access Trial: `active`, `ended`, `startedAt`, `endsAt`, `daysLeft` (whole days, rounded up, 0 when not active), `source` (`signup`, `partner`, `admin` or `none`), `totalDays` and, while active, `caps` = `{ aiQuestions, payrollEmployees, storePro: true }`. While it runs `effectivePlan` is `business` and `addons` has `ai_assistant`, `payroll` and `store_pro` on. `trialMessage` is set when there is no trial because one was already used. `plan` is the plan id, `features` maps every plan feature flag to true or false as enforced right now (an active trial has the top plan's features, a grandfathered organisation has all of them), `featureRequiredPlans` names the cheapest plan that has each flag in the current plan settings (null when no plan has it) and `topPlanName` is the highest plan, so a client can show a plan badge and a disabled button without guessing.",
        example: {
          state: "trial_expired",
          readOnly: true,
          reason: "read_only_trial_expired",
          message:
            "Your trial has ended. Choose a plan to continue. You can still view, search, download PDFs and export your data.",
          trialEndsAt: "2026-09-30T18:29:59.000Z",
          trialDaysLeft: 0,
          trial: {
            active: false,
            ended: true,
            startedAt: "2026-09-16T18:29:59.000Z",
            endsAt: "2026-09-30T18:29:59.000Z",
            daysLeft: 0,
            source: "signup",
            totalDays: 14,
            caps: null,
          },
          trialMessage: null,
          effectivePlan: "growth",
          graceUntil: null,
          addons: [],
          plan: "starter",
          features: { eInvoicing: false, multiWarehouse: false, bankReconciliation: false, manufacturing: false, pos: true },
          featureRequiredPlans: { eInvoicing: "Growth", manufacturing: "Business", pos: "Starter" },
          topPlanName: "Business",
          upgradePath: "/settings?tab=billing",
          canManageBilling: true,
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/billing.status" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const status = await trpc.billing.status.query();
if (status.readOnly) console.log(status.message);`,
        python: `import httpx

resp = httpx.get(
    "${API_BASE_URL}/api/trpc/billing.status",
    headers={"Authorization": f"Bearer {session_token}"},
)
print(resp.json()["result"]["data"]["json"]["state"])`,
      },
      gotchas: [
        "Organisations with no subscription and no trial report `free` and are never read-only.",
        "Refusal shape over tRPC: HTTP 403, `error.data.code = \"FORBIDDEN\"` and `error.data.entitlement = { reason, upgradePath, addon? }`. `reason` is one of `read_only_halted`, `read_only_trial_expired`, `read_only_subscription_ended`, `plan_limit`, `addon_required`, `feature_not_in_plan`, `tenant_suspended`.",
        "Feature refusal: a write (or feature entry point) for a feature the plan does not include answers `FORBIDDEN` with `error.data.entitlement = { reason: \"feature_not_in_plan\", code: \"feature_not_in_plan\", feature, featureName, requiredPlan, currentPlan, upgradePath }`, for example `{ feature: \"eInvoicing\", featureName: \"E-invoicing\", requiredPlan: \"Growth\", currentPlan: \"Starter\" }` with the message `E-invoicing is available on the Growth plan and above.` `requiredPlan` is the cheapest plan whose stored settings include the feature (null when none does), so it follows the admin's plan edits. Reads of existing data are never refused. A read-only organisation gets the read-only reason instead, and the same applies to API keys, the CLI and the MCP server.",
        "Refusal shape over REST (`/api/...` routes): HTTP 403 with `{ \"error\": \"<message>\", \"entitlement\": { \"reason\": \"...\", \"upgradePath\": \"/settings?tab=billing\" } }`.",
        "A suspended organisation can only call `tenant.current` and `billing.status`.",
        "Add-ons are sold only once the feature behind them exists. `billing.config` returns `addonAvailability` (`{ ai_assistant, ai_plus, payroll, store_pro }`, each a boolean) and `billing.overview` returns `available: boolean` on every entry of `addons`; when `available` is false, hide purchase controls. `billing.subscribeAddon` for an unavailable add-on answers `BAD_REQUEST` with the message \"This add-on is coming soon and cannot be purchased yet.\". An organisation that already holds the add-on (admin grant or earlier purchase) keeps it, and it still appears in `addonSubscriptions` and in the `addons` flags of `billing.status`. Extra AI question packs follow the same switch: `billing.config` returns `aiPackAvailable`, and `billing.buyAiPack` answers `BAD_REQUEST` with the same message while neither AI tier is on sale.",
      ],
    },
    {
      id: "billing-change-addon",
      method: "mutation",
      path: "billing.changeAddon",
      title: "Change an Add-on Tier",
      description:
        "Move between the tiers of one add-on (AI Assistant to AI Plus and back) or change its billing cycle. Owner only. Moving to a dearer tier applies now: the new subscription is bought and, once it is paid, the old tier is retired with a credit note for its unused time. Moving to a cheaper tier, or to another cycle of the same tier, is scheduled for the end of the paid period and applied on its own then. The organisation is never billed for both tiers. Refused with `BAD_REQUEST` while the add-on is not on sale.",
      auth: "protected",
      input: [
        { name: "addon", type: "string", required: true, description: "The tier to move to.", enumValues: ["ai_assistant", "ai_plus", "payroll", "store_pro"] },
        { name: "cycle", type: "string", required: true, description: "Billing cycle of the tier you move to.", enumValues: ["monthly", "yearly"] },
      ],
      output: {
        description:
          "`applied` is `now` or `at_period_end`. With Razorpay and `applied: now`, `checkout` carries the subscription to open in the Razorpay checkout (`subscriptionId`, `providerSubscriptionId`, `totalPaise`); confirm it with `billing.verifyCheckout`. The old tier keeps running until the new one is paid.",
        example: { applied: "now", checkout: { subscriptionId: "5d3c0d5e-3f0e-4b43-9d7c-0f3a8f7d9a11", providerSubscriptionId: "sub_Nx1234", totalPaise: 117882 } },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/billing.changeAddon" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"addon":"ai_plus","cycle":"monthly"}}'`,
        javascript: `const res = await trpc.billing.changeAddon.mutate({ addon: "ai_plus", cycle: "monthly" });`,
      },
      gotchas: [
        "`CONFLICT` for an add-on an admin granted (ask Fintranzact to change it) and for one set to end at the period end. `NOT_FOUND` when the organisation has no tier of that add-on to change: use `billing.subscribeAddon`.",
        "Unused time on the old tier becomes a credit note. With Razorpay the new subscription's first charge is the full price and the credit note stands for a manual refund, as with a plan upgrade.",
      ],
      relatedEndpoints: ["billing-status"],
    },
    {
      id: "billing-buy-ai-pack",
      method: "mutation",
      path: "billing.buyAiPack",
      title: "Buy Extra AI Question Packs",
      description:
        "Start a one-time purchase of extra AI question packs (100 questions each, 1 to 50 per order). Owner only. A pack is paid with a Razorpay order on the platform account, not a subscription, and the questions never expire. With the demo gateway the order is paid at once. With Razorpay it returns the order the Razorpay checkout needs; confirm it with `billing.verifyAiPackPayment`. The questions are granted when the payment is confirmed, once, whether by that call or by the `payment.captured` webhook, and a GST invoice is issued. The organisation needs an AI plan or a trial to buy (the questions are used by the assistant, which needs one). Refused with `BAD_REQUEST` while the AI add-on is not on sale.",
      auth: "protected",
      input: [{ name: "packs", type: "integer", required: true, description: "Number of packs, 1 to 50." }],
      output: {
        description:
          "`status` is `paid` (demo gateway) or `checkout`. For `checkout`, open the Razorpay checkout with `razorpayKeyId` and `providerOrderId`. `orderId` is our id, used by `billing.verifyAiPackPayment`.",
        example: { status: "checkout", orderId: "5d3c0d5e-3f0e-4b43-9d7c-0f3a8f7d9a11", providerOrderId: "order_Nx1234", razorpayKeyId: "rzp_live_xxxxxxxx", packs: 2, credits: 200, totalPaise: 46964 },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/billing.buyAiPack" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"packs":2}}'`,
        javascript: `const order = await trpc.billing.buyAiPack.mutate({ packs: 2 });`,
      },
      gotchas: [
        "`billing.config` returns `aiPackAvailable`, the pack price in `aiPack` and the add-on prices in `addonPrices`; `billing.overview` returns an `ai` block with the questions left, the next reset and the purchases.",
        "A pack refund takes back the questions that were not used yet.",
      ],
      relatedEndpoints: ["billing-verify-ai-pack-payment", "billing-change-addon"],
    },
    {
      id: "billing-verify-ai-pack-payment",
      method: "mutation",
      path: "billing.verifyAiPackPayment",
      title: "Confirm an AI Pack Payment",
      description:
        "The Razorpay checkout callback for a pack order. Owner only. The server checks Razorpay's signature (HMAC-SHA256 of `<order id>|<payment id>` with the platform key secret) before it grants anything; a wrong signature answers `BAD_REQUEST`. Safe to call twice, and safe if the webhook got there first: the questions are granted once per payment.",
      auth: "protected",
      input: [
        { name: "orderId", type: "string (UUID)", required: true, description: "The `orderId` from `billing.buyAiPack`." },
        { name: "razorpayPaymentId", type: "string", required: true, description: "`razorpay_payment_id` from the checkout." },
        { name: "razorpaySignature", type: "string", required: true, description: "`razorpay_signature` from the checkout." },
      ],
      output: {
        description: "`credits` is the number of questions the order added; `alreadyApplied` is true when the payment had already been applied.",
        example: { status: "paid", credits: 200, alreadyApplied: false },
      },
      codeExamples: {
        curl: `curl -X POST "${API_BASE_URL}/api/trpc/billing.verifyAiPackPayment" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"orderId":"5d3c0d5e-3f0e-4b43-9d7c-0f3a8f7d9a11","razorpayPaymentId":"pay_Nx1234","razorpaySignature":"..."}}'`,
        javascript: `await trpc.billing.verifyAiPackPayment.mutate({ orderId, razorpayPaymentId, razorpaySignature });`,
      },
      gotchas: ["`NOT_FOUND` for an order of another organisation."],
      relatedEndpoints: ["billing-buy-ai-pack"],
    },
  ],
};
