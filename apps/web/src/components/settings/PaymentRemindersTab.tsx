/**
 * Settings, Payment reminders: switch automatic reminders on, choose when they
 * go out (days before the due date, on it, then every N days, at most M),
 * which channels to use, and the wording of each message with a live preview.
 */
import { useMemo, useState } from "react";
import {
  DEFAULT_PAYMENT_REMINDER_SETTINGS,
  REMINDER_PLACEHOLDERS,
  REMINDER_SEND_FROM_HOUR_IST,
  REMINDER_SEND_UNTIL_HOUR_IST,
  paymentReminderSettingsSchema,
  renderReminderLine,
  renderReminderTemplate,
  sampleReminderVariables,
  type PaymentReminderSettings,
} from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        checked ? "bg-brand-600" : "bg-border-light dark:bg-surface-3",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <span className={cn("pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-5" : "translate-x-0")} />
    </button>
  );
}

type TemplateKey = keyof PaymentReminderSettings["templates"];

const TEMPLATE_FIELDS: Array<{ key: TemplateKey; label: string; rows: number; single?: boolean }> = [
  { key: "emailSubject", label: "Email subject", rows: 1, single: true },
  { key: "email", label: "Email message", rows: 9 },
  { key: "sms", label: "SMS message", rows: 3, single: true },
  { key: "whatsapp", label: "WhatsApp message", rows: 6 },
];

export function PaymentRemindersTab({ biz }: { biz?: { name?: string | null; legalName?: string | null } | null }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.reminder.getSettings.useQuery();
  const [draft, setDraft] = useState<PaymentReminderSettings | null>(null);

  const save = trpc.reminder.updateSettings.useMutation({
    onSuccess: () => {
      toast.success("Payment reminder settings saved");
      setDraft(null);
      void utils.reminder.getSettings.invalidate();
    },
    onError: (err) => toast.error("Could not save the settings", err.message),
  });

  const businessName = biz?.legalName || biz?.name || "Your business";
  const sample = useMemo(() => sampleReminderVariables(businessName), [businessName]);

  if (isLoading || !data) {
    return (
      <div className="card p-6" aria-busy="true">
        <div className="skeleton h-5 w-40 mb-4" />
        <div className="skeleton h-32 w-full" />
      </div>
    );
  }

  const current = draft ?? data.settings;
  const dirty = draft !== null;
  const edit = (patch: Partial<PaymentReminderSettings>) => setDraft({ ...current, ...patch });
  const editTemplate = (key: TemplateKey, value: string) => setDraft({ ...current, templates: { ...current.templates, [key]: value } });
  const num = (v: string, fallback: number) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  };

  const parsed = paymentReminderSettingsSchema.safeParse(current);
  const problem = parsed.success ? null : "Check the numbers and wording: every message needs some text, and days must be within range.";

  function onSave() {
    if (!parsed.success) return;
    save.mutate(parsed.data);
  }

  return (
    <div className="space-y-6" data-testid="payment-reminders-tab">
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Payment reminders</h3>
            <p className="text-xs text-text-tertiary mt-1 max-w-xl">
              Remind customers about unpaid invoices automatically. Reminders stop as soon as an invoice is paid, and never go to a customer you marked
              Do not remind. They go out between {REMINDER_SEND_FROM_HOUR_IST}:00 and {REMINDER_SEND_UNTIL_HOUR_IST}:00 India time. Nothing is sent until you switch this on.
            </p>
          </div>
          <Switch checked={current.enabled} onChange={(v) => edit({ enabled: v })} label="Send payment reminders automatically" />
        </div>
      </div>

      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-text-primary">Schedule</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Days before the due date
            <input
              className="input"
              type="number"
              min={0}
              max={30}
              value={current.daysBefore}
              onChange={(e) => edit({ daysBefore: num(e.target.value, 0) })}
              aria-label="Days before the due date"
            />
            <span className="text-2xs text-text-tertiary">0 for no reminder before the due date</span>
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Repeat every (days) after the due date
            <input
              className="input"
              type="number"
              min={0}
              max={60}
              value={current.repeatEveryDays}
              onChange={(e) => edit({ repeatEveryDays: num(e.target.value, 0) })}
              aria-label="Repeat every days after the due date"
            />
            <span className="text-2xs text-text-tertiary">0 for no repeats</span>
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Most reminders per invoice
            <input
              className="input"
              type="number"
              min={1}
              max={20}
              value={current.maxReminders}
              onChange={(e) => edit({ maxReminders: num(e.target.value, 1) })}
              aria-label="Most reminders per invoice"
            />
            <span className="text-2xs text-text-tertiary">Counted for each channel, all kinds together</span>
          </label>
        </div>
        <label className="flex items-center gap-3 text-sm text-text-primary">
          <Switch checked={current.onDueDate} onChange={(v) => edit({ onDueDate: v })} label="Remind on the due date" />
          Remind on the due date
        </label>
      </div>

      <div className="card p-6 space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">Channels</h3>
        <label className="flex items-start gap-3 text-sm text-text-primary">
          <input
            type="checkbox"
            className="mt-0.5 rounded"
            checked={current.channels.email}
            onChange={(e) => edit({ channels: { ...current.channels, email: e.target.checked } })}
          />
          <span>
            Email
            <span className="block text-xs text-text-tertiary">Sent from your business name; replies go to your business email when you have set one.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm text-text-primary">
          <input
            type="checkbox"
            className="mt-0.5 rounded"
            checked={current.channels.sms}
            disabled={!data.smsAvailable && !current.channels.sms}
            onChange={(e) => edit({ channels: { ...current.channels, sms: e.target.checked } })}
          />
          <span>
            SMS
            <span className="block text-xs text-text-tertiary" data-testid="sms-note">
              {data.smsAvailable
                ? "Sent through the SMS provider set up for this server."
                : "Not available on this server yet. SMS needs an SMS provider account and a DLT-registered message template; see the Payment reminders help page."}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm text-text-primary">
          <input
            type="checkbox"
            className="mt-0.5 rounded"
            checked={current.channels.whatsapp}
            onChange={(e) => edit({ channels: { ...current.channels, whatsapp: e.target.checked } })}
          />
          <span>
            WhatsApp link
            <span className="block text-xs text-text-tertiary">
              Messages are not sent automatically. Each invoice shows a Send on WhatsApp button that opens WhatsApp with the message filled in.
            </span>
          </span>
        </label>
      </div>

      <div className="card p-6 space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Message wording</h3>
          <p className="text-xs text-text-tertiary mt-1">
            Use placeholders in double braces; they are filled in for each invoice. A line with the payment link is left out when the invoice has no link.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Placeholders">
            {REMINDER_PLACEHOLDERS.map((p) => (
              <li key={p.key} title={p.label} className="text-2xs font-mono px-2 py-0.5 rounded bg-surface-2 text-text-secondary">
                {`{{${p.key}}}`}
              </li>
            ))}
          </ul>
        </div>
        {TEMPLATE_FIELDS.map((f) => {
          const value = current.templates[f.key];
          const rendered = f.single ? renderReminderLine(value, sample) : renderReminderTemplate(value, sample);
          const isDefault = value === DEFAULT_PAYMENT_REMINDER_SETTINGS.templates[f.key];
          return (
            <div key={f.key} data-testid={`template-${f.key}`}>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor={`tpl-${f.key}`} className="label mb-0">{f.label}</label>
                {!isDefault && (
                  <button
                    type="button"
                    className="text-xs text-brand-600 hover:text-brand-700"
                    onClick={() => editTemplate(f.key, DEFAULT_PAYMENT_REMINDER_SETTINGS.templates[f.key])}
                  >
                    Use the standard wording
                  </button>
                )}
              </div>
              <textarea
                id={`tpl-${f.key}`}
                className="input font-mono text-xs"
                rows={f.rows}
                value={value}
                maxLength={f.key === "emailSubject" ? 150 : 1000}
                onChange={(e) => editTemplate(f.key, e.target.value)}
              />
              <p className="text-2xs font-medium text-text-tertiary uppercase tracking-wide mt-2 mb-1">Preview</p>
              <div className="rounded-lg border border-border-light bg-surface-1 p-3 text-xs text-text-secondary whitespace-pre-wrap" data-testid={`preview-${f.key}`}>
                {rendered}
              </div>
            </div>
          );
        })}
        {!data.smsAvailable && (
          <p className="text-xs text-text-tertiary">
            When SMS goes through MSG91, the words customers receive are your DLT-approved template; the SMS wording above is the preview and the history text.
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        {problem && <p className="text-xs text-red-600">{problem}</p>}
        {dirty && (
          <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
            Discard changes
          </button>
        )}
        <button type="button" className="btn-primary" onClick={onSave} disabled={!dirty || !parsed.success || save.isPending}>
          {save.isPending ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}
