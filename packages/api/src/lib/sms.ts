/**
 * SMS sending behind one interface. A provider is chosen by environment and,
 * when none is configured, SMS is simply off: the reminder job skips the
 * channel and a manual send says "SMS is not set up on this server".
 *
 * Provider: MSG91 (SMS_PROVIDER=msg91), Flow API. In India a transactional SMS
 * must use a DLT-registered template, so MSG91 is not sent free text: the
 * owner of the deployment registers the sender ID and a template with DLT,
 * creates the matching Flow in MSG91, and puts the Flow's template id in
 * MSG91_TEMPLATE_ID. The reminder values are passed as the template variables
 * (MSG91_TEMPLATE_VARS names them; default: customerName, invoiceNumber,
 * amount, dueDate, businessName). The business's SMS wording in Settings is
 * the preview and the history text; the words that reach the customer are the
 * DLT template's.
 *
 *   SMS_PROVIDER         msg91 | (unset = SMS off)
 *   MSG91_AUTH_KEY       MSG91 auth key
 *   MSG91_TEMPLATE_ID    DLT-approved Flow template id
 *   MSG91_TEMPLATE_VARS  optional comma list of template variable names
 *
 * Nothing here logs a phone number or the auth key.
 */

import type { ReminderVariables } from "@fintranzact/shared";

export interface SmsMessage {
  /** Number with country code, e.g. 919876543210. */
  to: string;
  /** The reminder text (for providers that send free text). */
  body: string;
  /** The reminder values (for template-based providers). */
  variables: ReminderVariables;
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<void>;
}

export interface Msg91Config {
  authKey: string;
  templateId: string;
  variableNames: string[];
}

export const MSG91_FLOW_URL = "https://control.msg91.com/api/v5/flow/";
export const DEFAULT_MSG91_VARS = ["customerName", "invoiceNumber", "amount", "dueDate", "businessName"] as const;

/** The HTTP request MSG91's Flow API wants for one SMS (pure; no network). */
export function buildMsg91Request(
  cfg: Msg91Config,
  message: SmsMessage,
): { url: string; init: { method: "POST"; headers: Record<string, string>; body: string } } {
  const recipient: Record<string, string> = { mobiles: message.to };
  for (const name of cfg.variableNames) {
    recipient[name] = (message.variables as unknown as Record<string, string>)[name] ?? "";
  }
  return {
    url: MSG91_FLOW_URL,
    init: {
      method: "POST",
      headers: { authkey: cfg.authKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ template_id: cfg.templateId, short_url: "0", recipients: [recipient] }),
    },
  };
}

export function createMsg91Provider(cfg: Msg91Config, fetchImpl: typeof fetch = fetch): SmsProvider {
  return {
    name: "msg91",
    async send(message) {
      const req = buildMsg91Request(cfg, message);
      const res = await fetchImpl(req.url, req.init);
      // MSG91 answers 200 with {type: "success"|"error", message}; only the type is kept.
      let type: string | undefined;
      try {
        type = ((await res.json()) as { type?: string }).type;
      } catch {
        type = undefined;
      }
      if (!res.ok || type === "error") {
        throw new Error(`SMS provider refused the message (HTTP ${res.status})`);
      }
    },
  };
}

/** The provider the environment configures, or null when SMS is off or half-configured. */
export function createSmsProvider(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): SmsProvider | null {
  const name = (env.SMS_PROVIDER ?? "").trim().toLowerCase();
  if (name !== "msg91") return null;
  const authKey = env.MSG91_AUTH_KEY?.trim();
  const templateId = env.MSG91_TEMPLATE_ID?.trim();
  if (!authKey || !templateId) return null;
  const names = (env.MSG91_TEMPLATE_VARS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return createMsg91Provider(
    { authKey, templateId, variableNames: names.length > 0 ? names : [...DEFAULT_MSG91_VARS] },
    fetchImpl,
  );
}

export function smsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return createSmsProvider(env) !== null;
}

let override: SmsProvider | null | undefined;
/** Tests: replace (or with null disable) the provider; undefined restores the environment's. */
export function setSmsProviderForTests(provider: SmsProvider | null | undefined): void {
  override = provider;
}

/** The provider to use now. */
export function getSmsProvider(): SmsProvider | null {
  return override !== undefined ? override : createSmsProvider();
}
