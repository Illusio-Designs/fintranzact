import type { EndpointGroup } from "./types";
import { API_BASE_URL } from "./api-base";

const planExample = [
  {
    id: "forever_free",
    name: "Forever Free",
    tagline: "Unlimited for life",
    monthlyPriceInr: 0,
    features: [
      "Unlimited invoices, parties, and payments",
      "Unlimited businesses and team members",
      "Unlimited API access",
      "No branding or paywall",
    ],
    highlight: true,
    price: "₹0",
    limits: {
      maxOwnedOrgs: null,
      maxBusinesses: null,
      maxTeamMembers: null,
      maxConcurrentSessions: null,
      maxApiKeys: null,
      recurringRunsPerMonth: null,
      auditRetentionDays: null,
      dataExport: true,
      onlineStore: true,
      pdfBranding: false,
    },
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Best for growing teams",
    monthlyPriceInr: null,
    features: ["Advanced automation and workflows", "Priority support", "Expanded collaboration"],
    price: "Custom",
    limits: {
      maxOwnedOrgs: 3,
      maxBusinesses: 5,
      maxTeamMembers: 15,
      maxConcurrentSessions: 10,
      maxApiKeys: 3,
      recurringRunsPerMonth: null,
      auditRetentionDays: 365,
      dataExport: true,
      onlineStore: true,
      pdfBranding: false,
    },
  },
];

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
      description: "The plans offered to new sign-ups, in display order, each with its display price and the limits the API enforces for it. Legacy plans that are no longer offered (such as `free`) and custom plans (`enterprise`) are not listed.",
      auth: "public",
      input: [],
      output: {
        description: "Array of plans. `monthlyPriceInr` is 0 for free and `null` for priced-on-request plans (shown as `price: \"Custom\"`). Over tRPC (superjson) unlimited numeric limits arrive as `Infinity`; the REST endpoint sends `null` instead. `pdfBranding: true` means PDFs show \"Powered by Fintranzact\"; `auditRetentionDays: null` is unlimited.",
        example: planExample,
      },
      codeExamples: {
        curl: `curl "${API_BASE_URL}/api/trpc/plan.list"`,
        javascript: `const plans = await trpc.plan.list.query();
const pro = plans.find((p) => p.id === "pro");
console.log(pro?.limits.maxBusinesses); // 5 (Infinity when unlimited)`,
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
