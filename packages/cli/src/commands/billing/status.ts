import { FintranzactClient, FintranzactApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";
import { buildBillingUrl, BILLING_UPGRADE_PATH } from "../../plan.js";

interface StatusOpts {
  json?: boolean;
}

/** Show the organisation's plan state: trial countdown, read-only status, add-ons. Works while read-only. */
export async function billingStatusCommand(opts: StatusOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new FintranzactClient(cfg);

  try {
    const s = await client.billing.status();
    const url = buildBillingUrl({ reason: "plan_limit", upgradePath: s.upgradePath || BILLING_UPGRADE_PATH }, cfg.apiUrl);

    if (opts.json) {
      outputJSON({ ...s, upgradeUrl: url });
      return;
    }

    const lines = [`Plan state:  ${s.state}${s.readOnly ? " (read-only)" : ""}`];
    if (s.trialDaysLeft !== null && s.trialDaysLeft !== undefined) lines.push(`Trial:       ${s.trialDaysLeft} day(s) left`);
    if (s.graceUntil) lines.push(`Grace until: ${new Date(s.graceUntil).toLocaleDateString()}`);
    if (s.addons?.length) lines.push(`Add-ons:     ${s.addons.join(", ")}`);
    if (s.message) lines.push("", s.message);
    if (s.trialMessage) lines.push(s.trialMessage);
    if (s.readOnly || s.state === "trialing") lines.push("", `Choose a plan (organisation owner): ${url}`);
    process.stdout.write(lines.join("\n") + "\n");
  } catch (e) {
    if (e instanceof FintranzactApiError) {
      const err = e.fintranzactError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: fintranzact login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
