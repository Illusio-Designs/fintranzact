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
        "Lightweight status for the banners every member sees: the access state, whether the organisation is read-only, the trial countdown, the end of the past-due grace period and the active add-ons. Open to every member of the organisation (unlike the owner-only Billing overview), and it works while the organisation is read-only or suspended.",
      auth: "protected",
      input: [],
      output: {
        description:
          "`state` is one of `free`, `trialing`, `active`, `past_due_grace`, `halted`, `trial_expired`, `ended`, `suspended`. `reason` and `message` are set only while read-only or suspended. `canManageBilling` is true for owners (and platform superadmins): show a \"Choose a plan\" button to them and \"Ask your organisation owner\" to everyone else.",
        example: {
          state: "trial_expired",
          readOnly: true,
          reason: "read_only_trial_expired",
          message:
            "Your trial has ended. Choose a plan to keep creating and editing — you can still view, search, download PDFs and export your data.",
          trialEndsAt: "2026-09-30T18:29:59.000Z",
          trialDaysLeft: 0,
          graceUntil: null,
          addons: [],
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
        "Refusal shape over tRPC: HTTP 403, `error.data.code = \"FORBIDDEN\"` and `error.data.entitlement = { reason, upgradePath, addon? }`. `reason` is one of `read_only_halted`, `read_only_trial_expired`, `read_only_subscription_ended`, `plan_limit`, `addon_required`, `tenant_suspended`.",
        "Refusal shape over REST (`/api/...` routes): HTTP 403 with `{ \"error\": \"<message>\", \"entitlement\": { \"reason\": \"...\", \"upgradePath\": \"/settings?tab=billing\" } }`.",
        "A suspended organisation can only call `tenant.current` and `billing.status`.",
      ],
    },
  ],
};
