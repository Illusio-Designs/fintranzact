/**
 * Billing tools — read-only plan status.
 *
 * Tools registered:
 *   billing_status — plan state, trial countdown, read-only flag, add-ons
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FintranzactClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";
import { buildBillingUrl, BILLING_UPGRADE_PATH } from "../lib/plan.js";

export function registerBillingTools(server: McpServer, client: FintranzactClient) {
  server.tool(
    "billing_status",
    [
      "Get the organisation's plan status: access state (free, trialing, active, past_due_grace, halted, trial_expired, ended, suspended),",
      "whether it is read-only, trial days left, grace period end and active add-ons.",
      "Read-only: it changes nothing and works even while the organisation is read-only or suspended.",
      "When read-only, creating and editing are refused but reads, search and exports still work;",
      "only the organisation owner can choose a plan, at the returned upgradeUrl.",
    ].join(" "),
    {},
    wrapTool(async () => {
      const status = await client.billing.status();
      const upgradeUrl = buildBillingUrl(
        { reason: "plan_limit", upgradePath: status.upgradePath || BILLING_UPGRADE_PATH },
        client.apiUrl,
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ...status, upgradeUrl }, null, 2) }],
      };
    }),
  );
}
