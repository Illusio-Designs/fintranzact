import { logger } from "./logger.js";

interface EnvCheck {
  key: string;
  required: boolean;
  condition?: () => boolean; // only required when condition returns true
  hint?: string;
}

const checks: EnvCheck[] = [
  { key: "DATABASE_URL", required: true, hint: "PostgreSQL connection string" },
  { key: "CORS_ORIGINS", required: true, hint: "Comma-separated allowed origins (e.g. https://app.fintranzact.com)" },
  { key: "APP_URL", required: false, hint: "Frontend URL for links in emails (email change, invitations) and where customers return after paying an invoice online" },
  { key: "STORE_URL", required: false, hint: "Origin of the public storefront (e.g. https://store.fintranzact.com). Shoppers are sent back to <STORE_URL>/<slug>/order/<id> after paying online, and order emails link there. Without it they stay on Razorpay's confirmation page" },
  { key: "API_URL", required: false, hint: "Public origin of this API server, shown in the Razorpay webhook URL businesses add in their own dashboard (defaults to the request host)" },
  {
    key: "ENCRYPTION_KEY",
    required: false,
    condition: () =>
      process.env.NODE_ENV === "production" ||
      process.env.MULTI_TENANT === "true",
    hint: "Required in production and multi-tenant mode for field-level encryption of sensitive credentials (e-invoice, carrier API keys). Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  },
  {
    key: "SANDBOX_API_KEY",
    required: false,
    hint: "Sandbox.co.in API key — enables e-invoice, e-way bill, GSTIN lookup and TDS/TCS filing (also set SANDBOX_API_SECRET)",
  },
  {
    key: "ANTHROPIC_API_KEY",
    required: false,
    hint: "Anthropic API key (console.anthropic.com) for the AI business assistant add-on. Without it the assistant says it is not configured. Optional AI_MODEL_FAST / AI_MODEL_STRONG pick the models. Never put it in code or logs",
  },
  {
    key: "SANDBOX_MONTHLY_QUOTA",
    required: false,
    hint: "Sandbox.co.in plan quota (successful calls per month). Raises an alert at 80% and 100% of this number; unset disables the alerts",
  },
  {
    key: "RESEND_API_KEY",
    required: false,
    condition: () => process.env.NODE_ENV === "production",
    hint: "Required for email sending in production (email change, invites)",
  },
  {
    key: "RAZORPAY_WEBHOOK_SECRET",
    required: false,
    // Fatal only in production: a live server without it silently never hears
    // about renewals or failed payments. In development it is just a warning —
    // webhooks cannot reach localhost anyway and checkout works without them.
    condition: () =>
      process.env.NODE_ENV === "production" &&
      !!(process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY),
    hint: "Razorpay keys are set but the webhook secret is not — renewals and payment failures will never reach the API",
  },
];

/**
 * Validate required environment variables at startup.
 * Logs warnings for missing optional vars, throws for required vars.
 */
export function validateEnv(): void {
  const errors: string[] = [];

  for (const check of checks) {
    const value = process.env[check.key];
    const isRequired = check.required || (check.condition ? check.condition() : false);

    if (!value) {
      if (isRequired) {
        errors.push(`${check.key} is required. ${check.hint || ""}`);
      } else if (check.hint) {
        logger.warn({ key: check.key }, `${check.key} not set — ${check.hint}`);
      }
    }
  }

  if (errors.length > 0) {
    for (const err of errors) logger.error(err);
    throw new Error(`Missing required environment variables:\n  ${errors.join("\n  ")}`);
  }

  logger.info("Environment validation passed");
}
