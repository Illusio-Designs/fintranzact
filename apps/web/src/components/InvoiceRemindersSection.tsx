/**
 * "Payment reminders" block for an invoice's detail panel: the reminders sent
 * so far (automatic and by hand, with who/when/channel/outcome), buttons to
 * send one now by email or SMS, and the ready-to-send WhatsApp link.
 */
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { StatusBadge } from "@/components/ui/StatusBadge";

const CHANNEL_LABEL: Record<string, string> = { email: "Email", sms: "SMS", whatsapp: "WhatsApp" };
const KIND_LABEL: Record<string, string> = {
  before_due: "Before the due date",
  on_due: "On the due date",
  after_due: "Overdue follow-up",
  manual: "Sent by hand",
};

export function reminderStatusBadge(status: string): { status: string; label: string } {
  if (status === "sent") return { status: "sent", label: "Sent" };
  if (status === "failed") return { status: "overdue", label: "Failed" };
  if (status === "link_opened") return { status: "open", label: "Link opened" };
  return { status: "partial", label: "Sending" };
}

function formatWhen(value: Date | string): string {
  const d = new Date(value);
  const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${formatDate(d)}, ${time}`;
}

export function InvoiceRemindersSection({ invoiceId }: { invoiceId: string }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.reminder.getForInvoice.useQuery({ invoiceId });

  const send = trpc.reminder.sendNow.useMutation({
    onSuccess: (res) => {
      void utils.reminder.getForInvoice.invalidate({ invoiceId });
      if (res.channel !== "whatsapp") toast.success(res.channel === "email" ? "Email reminder sent" : "SMS reminder sent");
    },
    onError: (err) => {
      void utils.reminder.getForInvoice.invalidate({ invoiceId });
      toast.error("Could not send the reminder", err.message);
    },
  });

  if (isLoading || !data) return null;

  const { channels, history } = data;
  const nothingToSend = data.blockedReason !== null;

  return (
    <div data-testid="invoice-reminders">
      <p className="text-2xs font-medium text-text-tertiary uppercase tracking-wide mb-2">Payment reminders</p>
      <div className="card p-3 space-y-3">
        <p className="text-xs text-text-secondary" data-testid="reminder-state">
          {data.doNotRemind
            ? "This customer is marked Do not remind, so no reminders are sent."
            : data.remindersEnabled
              ? "Automatic reminders are on. They stop when the invoice is paid."
              : "Automatic reminders are off. Turn them on in Settings, Payment reminders."}
        </p>

        {!nothingToSend ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={!channels.email.available || send.isPending}
              title={channels.email.reason ?? "Email a reminder to the customer"}
              onClick={() => send.mutate({ invoiceId, channel: "email" })}
            >
              Send email reminder
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={!channels.sms.available || send.isPending}
              title={channels.sms.reason ?? "Send an SMS reminder to the customer"}
              onClick={() => send.mutate({ invoiceId, channel: "sms" })}
            >
              Send SMS reminder
            </button>
            {channels.whatsapp.available && channels.whatsapp.url ? (
              <a
                href={channels.whatsapp.url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 transition-colors"
                onClick={() => send.mutate({ invoiceId, channel: "whatsapp" })}
              >
                Send on WhatsApp
              </a>
            ) : (
              <span className="text-xs text-text-tertiary" title={channels.whatsapp.reason ?? undefined}>
                WhatsApp: {channels.whatsapp.reason ?? "not available"}
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-text-tertiary" data-testid="reminder-blocked">{data.blockedReason}</p>
        )}
        {!nothingToSend && (channels.email.reason || channels.sms.reason) && (
          <ul className="text-2xs text-text-tertiary space-y-0.5">
            {channels.email.reason && <li>Email: {channels.email.reason}</li>}
            {channels.sms.reason && <li>SMS: {channels.sms.reason}</li>}
          </ul>
        )}

        {history.length === 0 ? (
          <p className="text-xs text-text-tertiary" data-testid="reminder-history-empty">No reminders sent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="reminder-history">
              <thead>
                <tr className="text-left text-text-tertiary">
                  <th className="py-1 pr-3 font-medium">When</th>
                  <th className="py-1 pr-3 font-medium">Channel</th>
                  <th className="py-1 pr-3 font-medium">What</th>
                  <th className="py-1 pr-3 font-medium">By</th>
                  <th className="py-1 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {history.map((h) => {
                  const badge = reminderStatusBadge(h.status);
                  return (
                    <tr key={h.id}>
                      <td className="py-1.5 pr-3 whitespace-nowrap text-text-secondary">{formatWhen(h.createdAt)}</td>
                      <td className="py-1.5 pr-3 text-text-secondary">
                        {CHANNEL_LABEL[h.channel] ?? h.channel}
                        {h.recipient && <span className="block text-2xs text-text-tertiary">{h.recipient}</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-text-secondary">{KIND_LABEL[h.kind] ?? h.kind}</td>
                      <td className="py-1.5 pr-3 text-text-secondary">{h.trigger === "auto" ? "Automatic" : (h.sentByName ?? "Team member")}</td>
                      <td className="py-1.5">
                        <StatusBadge status={badge.status} label={badge.label} size="sm" />
                        {h.error && <span className="block text-2xs text-red-600 mt-0.5">{h.error}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
