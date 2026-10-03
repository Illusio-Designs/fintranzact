import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";
import { PLANS, PLAN_LIMITS, formatPlanPrice, formatYearlyPlanPrice, limitsToStored } from "@fintranzact/shared";

// Built from the shared defaults so the example is always what a fresh server returns.
const planExample = PLANS.map((plan) => ({
  id: plan.id,
  name: plan.name,
  tagline: plan.tagline,
  monthlyPriceInr: plan.monthlyPriceInr,
  yearlyPriceInr: plan.yearlyPriceInr,
  features: plan.features,
  highlight: !!plan.highlight,
  price: formatPlanPrice(plan),
  yearlyPrice: formatYearlyPlanPrice(plan),
  limits: limitsToStored(PLAN_LIMITS[plan.id]),
}));

export const systemEndpoints: EndpointGroup = {
  id: "plans-system",
  title: "Plans & System Status",
  description: "Public, unauthenticated endpoints: the plan catalogue that the pricing page and sign-up plan picker render (the same limits the API enforces), and the maintenance banner status.",
  endpoints: [
    {
      id: "plan-list",
      method: "query",
      path: "plan.list",
      title: "List Plans",
      description: "The plans offered to new sign-ups, in display order, each with its display price and the limits the API enforces for it. There are three paid plans (`starter`, `growth`, `business`) and no free plan; a plan the platform team has hidden is not listed.",
      auth: "public",
      input: [],
      output: {
        description: "Array of plans. Prices are in whole rupees, before 18% GST: `monthlyPriceInr` and `yearlyPriceInr` (a year is normally ten months, two months free; `price` and `yearlyPrice` are the formatted strings). `null` means priced on request (shown as \"Custom\"). `highlight` marks the most popular plan. Besides the numeric limits, `limits` carries one boolean per feature (`eInvoicing`, `multiWarehouse`, `manufacturing`, ...); only `dataExport`, `onlineStore`, `pdfBranding` and `maxApiKeys` are enforced today, the rest describe the plan. Over tRPC (superjson) unlimited numeric limits arrive as `Infinity`; the REST endpoint sends `null` instead. `pdfBranding: true` (the default on all three plans, editable per plan) means PDFs show a small \"Powered by Fintranzact\" line; `auditRetentionDays: null` is unlimited.",
        example: planExample,
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/plan.list"`,
        javascript: `const plans = await trpc.plan.list.query();
const growth = plans.find((p) => p.id === "growth");
console.log(growth?.limits.maxBusinesses); // 3 (Infinity when unlimited)`,
      },
      gotchas: [
        "Public — no session or business header needed.",
        "Use `GET /api/plans` from non-tRPC clients: plain JSON, cacheable for 5 minutes.",
      ],
      relatedEndpoints: ["plans-rest", "tenant-update-plan"],
    },
    {
      id: "plans-rest",
      method: "query",
      path: "GET /api/plans",
      title: "List Plans (REST)",
      description: "Raw HTTP endpoint (not tRPC), no authentication. Same catalogue as `plan.list`, wrapped in `{ plans: [...] }`, with unlimited numeric limits sent as `null` because JSON has no Infinity. Sent with `Cache-Control: public, max-age=300`.",
      auth: "public",
      input: [],
      output: {
        description: "`{ plans }` — see `plan.list` for the fields.",
        example: { plans: planExample },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/plans"`,
        javascript: `const { plans } = await fetch("${API_BASE_URL}/api/plans").then((r) => r.json());`,
      },
      gotchas: [
        "A `null` numeric limit means unlimited — except that `auditRetentionDays: null` already means unlimited in both forms.",
      ],
      relatedEndpoints: ["plan-list"],
    },
    {
      id: "system-maintenance-status",
      method: "query",
      path: "system.maintenanceStatus",
      title: "Maintenance Status",
      description: "Whether maintenance mode is on, with the message and window the apps show in their banner. Maintenance is set by operators with the `maintenance` CLI in packages/api (there is no API mutation for it) and cached on each API instance for 30 seconds. A window can be scheduled (message and times set, `enabled: false`) before it is switched on.",
      auth: "public",
      input: [],
      output: {
        description: "`startsAt` / `endsAt` are ISO strings or `null`. When nothing is configured the default is `{ enabled: false, message: \"\", startsAt: null, endsAt: null }`.",
        example: {
          enabled: true,
          message: "Scheduled upgrade — billing will be read-only for about 20 minutes.",
          startsAt: "2026-10-04T20:30:00.000Z",
          endsAt: "2026-10-04T20:50:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/system.maintenanceStatus"`,
        javascript: `const status = await trpc.system.maintenanceStatus.query();
if (status.enabled) showBanner(status.message);`,
      },
      gotchas: [
        "Public — safe to poll from a signed-out screen. Changes can take up to 30 seconds to show on every API instance.",
        "While `enabled` is true, every procedure that needs an organization (tenant, business and all business-scoped routers) fails with PRECONDITION_FAILED carrying the maintenance message. Public procedures and sign-in (`auth.*` on protected procedures) keep working.",
      ],
    },
  ],
};
